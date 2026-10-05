-- Manual application only, after the profiles/authorship migration. No content
-- backfill, deletes, vote changes or guest-to-account linking is performed.
alter table public.profiles add column if not exists show_avatar boolean not null default false;
grant update (show_avatar) on table public.profiles to authenticated;

alter table public.comments
  add column if not exists guest_id_hash text,
  add column if not exists anonymous_alias text;

alter table public.comments add constraint comments_guest_identity_check check (
  guest_id_hash is null or (
    guest_id_hash ~ '^[0-9a-f]{64}$' and user_id is null
    and is_anonymous and anonymous_alias is not null
  )
);
alter table public.comments add constraint comments_anonymous_alias_check check (
  anonymous_alias is null or (is_anonymous and anonymous_alias ~ '^익명 [가-힣]{1,8} [0-9]{2}$')
);
create index if not exists comments_guest_created_idx
on public.comments (guest_id_hash, created_at desc) where guest_id_hash is not null;
create index if not exists comments_account_created_idx
on public.comments (user_id, created_at desc) where user_id is not null;

-- Whole-table SELECT would override a column-level revoke. Restore only the
-- safe projection; identity columns remain server-only, including Realtime.
revoke select on table public.comments from public, anon, authenticated;
revoke select (user_id, guest_id_hash) on table public.comments from public, anon, authenticated;
grant select (
  id, poll_id, parent_id, text, user_name, created_at, is_hidden, hidden_at,
  is_anonymous, anonymous_alias
) on table public.comments to anon, authenticated;

create or replace function askio_private.protect_anonymous_comment_name()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.is_anonymous then
    -- Existing legacy anonymous rows remain unchanged on moderation updates.
    if tg_op = 'INSERT' and (new.anonymous_alias is null
      or ((new.user_id is null) = (new.guest_id_hash is null))) then
      raise exception using errcode = '22023', message = 'INVALID_COMMENT_IDENTITY';
    end if;
    new.user_name := coalesce(new.anonymous_alias, '익명');
  end if;
  return new;
end;
$$;
revoke all on function askio_private.protect_anonymous_comment_name() from public, anon, authenticated;
grant execute on function askio_private.protect_anonymous_comment_name() to service_role;

-- One transaction per comment. Guest advisory lock serializes speed/duplicate
-- checks across server instances. The existing comment/moderation triggers and
-- shared poll lock remain in force. No voting function is changed.
create or replace function public.create_comment_with_identity(
  p_poll_id text, p_text text, p_parent_id text, p_user_id uuid,
  p_guest_id_hash text, p_is_anonymous boolean, p_anonymous_alias text, p_user_name text
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare
  current_time_stamp timestamptz;
  result_row public.comments%rowtype;
begin
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200
    or p_text is null or char_length(btrim(p_text)) not between 1 and 2000
    or p_is_anonymous is null
    or ((p_user_id is null) = (p_guest_id_hash is null))
    or (p_guest_id_hash is not null and (p_guest_id_hash !~ '^[0-9a-f]{64}$' or not p_is_anonymous))
    or (p_is_anonymous and (p_anonymous_alias is null or p_anonymous_alias !~ '^익명 [가-힣]{1,8} [0-9]{2}$'))
    or (not p_is_anonymous and (p_anonymous_alias is not null or p_user_name is null)) then
    raise exception using errcode = '22023', message = 'INVALID_COMMENT_INPUT';
  end if;

  if p_guest_id_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_guest_id_hash, 0));
  end if;
  current_time_stamp := clock_timestamp();
  if p_guest_id_hash is not null then
    if exists (select 1 from public.comments as c where c.guest_id_hash = p_guest_id_hash
      and c.created_at > current_time_stamp - interval '10 seconds') then
      raise exception using errcode = 'P0001', message = 'GUEST_COMMENT_TOO_FAST';
    end if;
    if exists (select 1 from public.comments as c where c.guest_id_hash = p_guest_id_hash
      and c.poll_id = p_poll_id and c.text = btrim(p_text)
      and c.created_at > current_time_stamp - interval '10 minutes') then
      raise exception using errcode = 'P0001', message = 'GUEST_COMMENT_DUPLICATE';
    end if;
  end if;

  perform 1 from public.polls as p where p.id = p_poll_id and not p.is_hidden for key share;
  if not found then raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND'; end if;
  if p_parent_id is not null then
    perform 1 from public.comments as c
    where c.id::text = p_parent_id and c.poll_id = p_poll_id and not c.is_hidden for key share;
    if not found then raise exception using errcode = 'P0002', message = 'COMMENT_NOT_FOUND'; end if;
  end if;
  if p_user_id is not null then perform public.ensure_user_profile(p_user_id); end if;

  insert into public.comments (poll_id, parent_id, text, user_id, guest_id_hash,
    is_anonymous, anonymous_alias, user_name, created_at)
  values (p_poll_id, p_parent_id, btrim(p_text), p_user_id, p_guest_id_hash,
    p_is_anonymous, p_anonymous_alias,
    case when p_is_anonymous then p_anonymous_alias else p_user_name end, current_time_stamp)
  returning * into result_row;
  return jsonb_build_object('id', result_row.id, 'poll_id', result_row.poll_id,
    'parent_id', result_row.parent_id, 'text', result_row.text, 'user_name', result_row.user_name,
    'created_at', result_row.created_at, 'is_anonymous', result_row.is_anonymous,
    'anonymous_alias', result_row.anonymous_alias);
end;
$$;
revoke all on function public.create_comment_with_identity(text, text, text, uuid, text, boolean, text, text)
from public, anon, authenticated;
grant execute on function public.create_comment_with_identity(text, text, text, uuid, text, boolean, text, text)
to service_role;

notify pgrst, 'reload schema';
