-- Apply only after checking the existing ownership and creation contracts.
-- Enrollment and conversion of any already-published polls are separate,
-- explicitly reviewed operations. This migration registers no accounts.
begin;

create table public.official_poll_publishers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null
);
alter table public.official_poll_publishers enable row level security;
revoke all on table public.official_poll_publishers from public, anon, authenticated, service_role;
grant select on table public.official_poll_publishers to service_role;

-- An existing ownership row with a NULL hash permanently uses account
-- management. A missing ownership row still means there is no owner grant.
-- Older app versions also reject a NULL hash instead of accepting a token.
alter table public.poll_ownership alter column owner_token_hash drop not null;

create function askio_private.prevent_poll_token_restore()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '23514', message = 'ACCOUNT_MANAGED_POLL_CANNOT_RESTORE_TOKEN';
end;
$$;
revoke all on function askio_private.prevent_poll_token_restore() from public, anon, authenticated;
grant execute on function askio_private.prevent_poll_token_restore() to service_role;
create trigger prevent_poll_token_restore
before update of owner_token_hash on public.poll_ownership
for each row when (old.owner_token_hash is null and new.owner_token_hash is not null)
execute function askio_private.prevent_poll_token_restore();

create function askio_private.protect_official_poll_ownership()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  publisher_active boolean;
begin
  select p.active into publisher_active
  from public.official_poll_publishers as p
  where p.user_id = new.author_user_id;
  if not found then
    return new;
  end if;
  if not publisher_active then
    raise exception using errcode = '42501', message = 'OFFICIAL_PUBLISHER_INACTIVE';
  end if;

  update public.poll_ownership
  set owner_token_hash = null
  where poll_id = new.id;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_OWNERSHIP_NOT_FOUND';
  end if;
  return new;
end;
$$;
revoke all on function askio_private.protect_official_poll_ownership() from public, anon, authenticated;
grant execute on function askio_private.protect_official_poll_ownership() to service_role;

-- The existing create RPC inserts the ownership row before setting authorship.
-- Keep this protection even when rolling back to an app calling the older RPC.
create trigger protect_official_poll_ownership
after update of author_user_id on public.polls
for each row when (new.author_user_id is not null and new.author_user_id is distinct from old.author_user_id)
execute function askio_private.protect_official_poll_ownership();

create function public.create_poll_with_management(
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
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  created_id text;
  account_managed boolean;
begin
  created_id := public.create_owned_poll_with_author(
    p_poll_id, p_title, p_category, p_options, p_votes, p_participants,
    p_official_fact, p_option_image_paths, p_owner_token_hash, p_edit_lock_mode,
    p_edit_lock_minutes, p_edit_lock_participants, p_author_user_id, p_is_anonymous
  );
  select o.owner_token_hash is null into strict account_managed
  from public.poll_ownership as o where o.poll_id = created_id;
  return account_managed;
end;
$$;
revoke all on function public.create_poll_with_management(
  text, text, text, jsonb, jsonb, integer, text, jsonb, text, text, integer, integer, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.create_poll_with_management(
  text, text, text, jsonb, jsonb, integer, text, jsonb, text, text, integer, integer, uuid, boolean
) to service_role;

notify pgrst, 'reload schema';
commit;
