-- Apply manually before deploying profile/authorship APIs. Existing content,
-- votes, reactions, owner tokens and edit-lock RPCs are not rewritten.
-- No Auth users are changed: the backfill inserts missing public profiles only.

create schema if not exists askio_private;
revoke all on schema askio_private from public, anon, authenticated;
grant usage on schema askio_private to service_role;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  onboarding_completed boolean not null default false,
  constraint profiles_nickname_format_check check (
    nickname = btrim(nickname)
    and char_length(nickname) between 2 and 16
    and nickname ~ '^[A-Za-z0-9_가-힣ㄱ-ㅎㅏ-ㅣ]+$'
  ),
  constraint profiles_nickname_reserved_check check (
    lower(nickname) not in (
      'admin', 'administrator', 'askio', '운영자', '관리자', '공식', 'official'
    )
  ),
  constraint profiles_avatar_url_check check (
    avatar_url is null or (
      char_length(avatar_url) <= 2048
      and avatar_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>]*)?$'
    )
  )
);

create unique index if not exists profiles_nickname_lower_unique
on public.profiles (lower(nickname));

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated, service_role;
grant select, insert, update on table public.profiles to service_role;
-- Public identity is returned by a server response, never by enumerating users.
grant select on table public.profiles to authenticated;
grant update (nickname, onboarding_completed) on table public.profiles to authenticated;

drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles
for select to authenticated using (
  (select auth.uid()) = id
  and not coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false)
);

drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles
for update to authenticated using (
  (select auth.uid()) = id
  and not coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false)
) with check (
  (select auth.uid()) = id
  and not coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false)
);

-- Keep the ownership boundary even if a permissive policy is added later.
drop policy if exists "Profiles own access boundary" on public.profiles;
create policy "Profiles own access boundary" on public.profiles
as restrictive for all to authenticated using (
  (select auth.uid()) = id
  and not coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false)
) with check (
  (select auth.uid()) = id
  and not coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false)
);

create or replace function askio_private.normalize_profile_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.nickname ~ '[[:cntrl:]]' then
    raise exception using errcode = '23514', message = 'INVALID_PROFILE_NICKNAME';
  end if;
  new.nickname := btrim(new.nickname);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function askio_private.normalize_profile_write()
from public, anon, authenticated;

drop trigger if exists profiles_normalize_before_write on public.profiles;
create trigger profiles_normalize_before_write
before insert or update on public.profiles
for each row execute function askio_private.normalize_profile_write();

create or replace function askio_private.random_profile_nickname()
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  adjectives constant text[] := array[
    '느긋한', '파란', '졸린', '다정한', '밝은', '즐거운', '차분한', '용감한',
    '수줍은', '신나는', '따뜻한', '작은', '가벼운', '푸른', '호기심많은', '씩씩한'
  ];
  animals constant text[] := array[
    '펭귄', '여우', '수달', '고양이', '강아지', '토끼', '판다', '고래',
    '사슴', '다람쥐', '코알라', '돌고래', '두루미', '참새', '곰', '사자',
    '오리', '호랑이', '물개', '기린'
  ];
begin
  return adjectives[1 + floor(random() * array_length(adjectives, 1))::integer]
    || animals[1 + floor(random() * array_length(animals, 1))::integer]
    || lpad(floor(random() * 10000)::integer::text, 4, '0');
end;
$$;

revoke all on function askio_private.random_profile_nickname()
from public, anon, authenticated;
grant execute on function askio_private.random_profile_nickname() to service_role;

-- Auth's dedicated database role cannot insert public profiles, and the service
-- role cannot read auth.users. This private, non-Data-API function therefore
-- uses DEFINER only for that specific boundary. The callable public wrappers
-- below remain service-only INVOKER functions. User metadata is never used for
-- authorization or nickname selection; only a sanitized optional avatar is read.
create or replace function askio_private.ensure_user_profile_internal(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  profile_row public.profiles%rowtype;
  imported_avatar text;
  candidate text;
  attempt integer;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_PROFILE_USER';
  end if;

  select coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
  into imported_avatar
  from auth.users as u
  where u.id = p_user_id and not coalesce(u.is_anonymous, false);
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_USER_NOT_FOUND';
  end if;

  select p.* into profile_row from public.profiles as p where p.id = p_user_id;
  if found then
    return to_jsonb(profile_row);
  end if;

  if imported_avatar is not null and (
    char_length(imported_avatar) > 2048
    or imported_avatar !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>]*)?$'
  ) then
    imported_avatar := null;
  end if;

  for attempt in 1..100 loop
    candidate := askio_private.random_profile_nickname();
    begin
      insert into public.profiles (id, nickname, avatar_url)
      values (p_user_id, candidate, imported_avatar)
      on conflict (id) do nothing;

      select p.* into profile_row from public.profiles as p where p.id = p_user_id;
      if found then
        return to_jsonb(profile_row);
      end if;
    exception when unique_violation then
      -- A concurrent signup reserved this nickname. Retry inside a subtransaction.
      null;
    end;
  end loop;
  raise exception using errcode = 'P0001', message = 'PROFILE_NICKNAME_GENERATION_FAILED';
end;
$$;

revoke all on function askio_private.ensure_user_profile_internal(uuid)
from public, anon, authenticated;
grant execute on function askio_private.ensure_user_profile_internal(uuid) to service_role;

create or replace function askio_private.create_profile_after_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not coalesce(new.is_anonymous, false) then
    perform askio_private.ensure_user_profile_internal(new.id);
  end if;
  return new;
end;
$$;

revoke all on function askio_private.create_profile_after_auth_signup()
from public, anon, authenticated, service_role;

drop trigger if exists askio_create_profile_after_signup on auth.users;
create trigger askio_create_profile_after_signup
after insert on auth.users for each row
execute function askio_private.create_profile_after_auth_signup();

-- Preserve every existing Auth user and any existing profile. No content rows
-- are assigned to accounts, and no public display name comes from OAuth names.
do $$
declare
  existing_user record;
begin
  for existing_user in
    select u.id from auth.users as u
    where not coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.profiles as p where p.id = u.id)
  loop
    perform askio_private.ensure_user_profile_internal(existing_user.id);
  end loop;
end;
$$;

create or replace function public.ensure_user_profile(p_user_id uuid)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $$
  select askio_private.ensure_user_profile_internal(p_user_id);
$$;

revoke all on function public.ensure_user_profile(uuid) from public, anon, authenticated;
grant execute on function public.ensure_user_profile(uuid) to service_role;

create or replace function public.recommend_user_profile_nickname(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  profile_row public.profiles%rowtype;
  candidate text;
  attempt integer;
begin
  perform public.ensure_user_profile(p_user_id);
  select p.* into profile_row from public.profiles as p where p.id = p_user_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_USER_NOT_FOUND';
  end if;

  for attempt in 1..100 loop
    candidate := askio_private.random_profile_nickname();
    if candidate = profile_row.nickname then
      continue;
    end if;
    begin
      update public.profiles as p set nickname = candidate
      where p.id = p_user_id returning p.* into profile_row;
      return to_jsonb(profile_row);
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception using errcode = 'P0001', message = 'PROFILE_NICKNAME_GENERATION_FAILED';
end;
$$;

revoke all on function public.recommend_user_profile_nickname(uuid)
from public, anon, authenticated;
grant execute on function public.recommend_user_profile_nickname(uuid) to service_role;

alter table public.polls
  add column if not exists author_user_id uuid references auth.users(id) on delete set null,
  add column if not exists is_anonymous boolean not null default false;
create index if not exists polls_author_user_id_idx
on public.polls (author_user_id) where author_user_id is not null;

alter table public.comments
  add column if not exists is_anonymous boolean not null default false;

comment on column public.polls.author_user_id is
  'Verified Auth author of new questions; historical/seed content is never backfilled.';
comment on column public.polls.is_anonymous is
  'Public identity is hidden only; authenticated authorship and owner tokens remain private.';
comment on column public.comments.is_anonymous is
  'Anonymous posting still records the verified Auth user_id for moderation.';

create or replace function askio_private.protect_anonymous_comment_name()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.is_anonymous then
    if tg_op = 'INSERT' and new.user_id is null then
      raise exception using errcode = '22023', message = 'ANONYMOUS_COMMENT_REQUIRES_USER';
    end if;
    new.user_name := '익명';
  end if;
  return new;
end;
$$;

revoke all on function askio_private.protect_anonymous_comment_name()
from public, anon, authenticated;
grant execute on function askio_private.protect_anonymous_comment_name() to service_role;

drop trigger if exists comments_anonymous_name_before_write on public.comments;
create trigger comments_anonymous_name_before_write
before insert or update of user_name, user_id, is_anonymous on public.comments
for each row execute function askio_private.protect_anonymous_comment_name();

-- RLS restricts rows, not columns. Replacing whole-table SELECT is necessary:
-- revoking user_id alone would leave the existing whole-table grant effective.
-- Supabase Realtime also filters its payload using has_column_privilege, so
-- these grants protect account IDs there as well as direct REST/GraphQL reads.
revoke select on table public.polls, public.comments from public, anon, authenticated;
revoke select (author_user_id) on table public.polls from public, anon, authenticated;
revoke select (user_id) on table public.comments from public, anon, authenticated;

grant select (
  id, title, category, options, votes, participants, created_at, official_fact,
  option_image_paths, edit_lock_mode, edit_lock_minutes, edit_lock_participants,
  is_hidden, hidden_at, is_anonymous
) on table public.polls to anon, authenticated;
grant select (
  id, poll_id, parent_id, text, user_name, created_at, is_hidden, hidden_at, is_anonymous
) on table public.comments to anon, authenticated;

-- Keep the original creation overloads intact. The server passes a verified
-- session user ID, and content, owner token hash and authorship commit together.
create or replace function public.create_owned_poll_with_author(
  p_poll_id text,
  p_title text,
  p_category text,
  p_options jsonb,
  p_votes jsonb,
  p_participants integer,
  p_official_fact text,
  p_option_image_paths jsonb,
  p_owner_token_hash text,
  p_edit_lock_mode text,
  p_edit_lock_minutes integer,
  p_edit_lock_participants integer,
  p_author_user_id uuid,
  p_is_anonymous boolean
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  created_id text;
begin
  if p_author_user_id is null or p_is_anonymous is null then
    raise exception using errcode = '22023', message = 'INVALID_POLL_AUTHOR';
  end if;
  perform public.ensure_user_profile(p_author_user_id);

  created_id := public.create_owned_poll(
    p_poll_id, p_title, p_category, p_options, p_votes, p_participants,
    p_official_fact, p_option_image_paths, p_owner_token_hash,
    p_edit_lock_mode, p_edit_lock_minutes, p_edit_lock_participants
  );
  update public.polls as p
  set author_user_id = p_author_user_id, is_anonymous = p_is_anonymous
  where p.id = created_id;
  return created_id;
end;
$$;

revoke all on function public.create_owned_poll_with_author(
  text, text, text, jsonb, jsonb, integer, text, jsonb, text, text, integer, integer, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.create_owned_poll_with_author(
  text, text, text, jsonb, jsonb, integer, text, jsonb, text, text, integer, integer, uuid, boolean
) to service_role;

-- Profiles must never appear in the public Realtime publication. Fail closed
-- if an ALL TABLES publication would expose this private account table.
do $$
declare
  publication_row record;
begin
  for publication_row in
    select p.pubname, p.puballtables
    from pg_catalog.pg_publication as p
    join pg_catalog.pg_publication_tables as pt on pt.pubname = p.pubname
    where pt.schemaname = 'public' and pt.tablename = 'profiles'
  loop
    if publication_row.puballtables then
      raise exception 'Profiles must not belong to an ALL TABLES publication.';
    end if;
    execute format('alter publication %I drop table public.profiles', publication_row.pubname);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
