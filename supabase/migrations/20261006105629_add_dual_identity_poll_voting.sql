-- Follow-up to the already applied account-voting migration. Do not rewrite
-- 20261005142934. Existing rows, legacy voter IDs, aggregates and 3-argument
-- account RPCs are preserved. New server code always calls the 4-argument
-- account overloads explicitly (NO defaults, avoiding overload ambiguity).
--
-- user_id comes from server-verified Auth. guest_id_hash is a vote-domain HMAC
-- of the existing server-managed HttpOnly cookie, never a raw UUID/IP or a
-- client-controlled identity. Retain it after claim to block logout duplicates.
-- Apply this migration BEFORE deploying the dual-identity server code.

do $$
declare
  existing_type text;
begin
  if not exists (select 1 from information_schema.columns as c
    where c.table_schema = 'public' and c.table_name = 'poll_votes'
      and c.column_name = 'user_id' and c.data_type = 'uuid'
      and c.is_nullable = 'YES') then
    raise exception using errcode = '42804', message = 'Apply account-voting schema before dual-identity voting.';
  end if;
  select c.data_type into existing_type from information_schema.columns as c
  where c.table_schema = 'public' and c.table_name = 'poll_votes'
    and c.column_name = 'guest_id_hash';
  if existing_type is not null and existing_type <> 'text' then
    raise exception using errcode = '42804', message = 'poll_votes.guest_id_hash must be text.';
  end if;
  if exists (select 1 from information_schema.columns as c
    where c.table_schema = 'public' and c.table_name = 'poll_votes'
      and c.column_name = 'guest_id_hash'
      and (c.is_nullable <> 'YES' or c.column_default is not null)) then
    raise exception using errcode = '42804', message = 'poll_votes.guest_id_hash must be nullable without a default.';
  end if;
end;
$$;

alter table public.poll_votes add column if not exists guest_id_hash text;
do $$
begin
  if exists (select 1 from pg_constraint as c
    where c.conrelid = 'public.poll_votes'::regclass
      and c.conname = 'poll_votes_guest_hash_check'
      and (c.contype <> 'c' or pg_get_expr(c.conbin, c.conrelid)
        <> '((guest_id_hash IS NULL) OR (guest_id_hash ~ ''^[0-9a-f]{64}$''::text))')) then
    raise exception using errcode = '42804', message = 'Guest vote hash check definition conflicts.';
  end if;
  if not exists (select 1 from pg_constraint as c
    where c.conrelid = 'public.poll_votes'::regclass
      and c.conname = 'poll_votes_guest_hash_check') then
    alter table public.poll_votes add constraint poll_votes_guest_hash_check
      check (guest_id_hash is null or guest_id_hash ~ '^[0-9a-f]{64}$') not valid;
  end if;
end;
$$;
alter table public.poll_votes validate constraint poll_votes_guest_hash_check;

-- A claimed account row retains its hash, so this backstop also applies after
-- login/logout. No rows are deleted and no historical aggregates are recounted.
create unique index if not exists poll_votes_poll_guest_unique
on public.poll_votes (poll_id, guest_id_hash) where guest_id_hash is not null;
do $$
begin
  if not exists (
    select 1 from pg_index as i
    where i.indexrelid = 'public.poll_votes_poll_guest_unique'::regclass
      and i.indrelid = 'public.poll_votes'::regclass and i.indisunique
      and i.indisvalid and i.indnkeyatts = 2
      and i.indkey[0] = (select a.attnum from pg_attribute as a
        where a.attrelid = 'public.poll_votes'::regclass and a.attname = 'poll_id')
      and i.indkey[1] = (select a.attnum from pg_attribute as a
        where a.attrelid = 'public.poll_votes'::regclass and a.attname = 'guest_id_hash')
      and pg_get_expr(i.indpred, i.indrelid) = '(guest_id_hash IS NOT NULL)'
  ) then
    raise exception using errcode = '42804', message = 'Guest vote unique index definition conflicts.';
  end if;
end;
$$;
comment on column public.poll_votes.guest_id_hash is
  'Server-only vote-domain guest HMAC, retained on account claim for browser continuity; never publicly returned.';

alter table public.poll_votes enable row level security;
revoke all on table public.poll_votes from public, anon, authenticated;
grant select on table public.poll_votes to service_role;
grant insert (poll_id, voter_id, option_index, user_id, guest_id_hash)
on public.poll_votes to service_role;
grant update (option_index, user_id, guest_id_hash) on public.poll_votes to service_role;
revoke all on sequence public.poll_votes_id_seq from public, anon, authenticated;
grant usage on sequence public.poll_votes_id_seq to service_role;

create or replace function public.cast_authenticated_poll_vote(
  p_poll_id text,
  p_option_index integer,
  p_user_id uuid,
  p_guest_id_hash text
)
returns table (id text, votes jsonb, participants integer, option_index integer)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_poll public.polls%rowtype;
  option_count integer;
  selected_vote_count integer;
  new_votes jsonb;
begin
  if current_user <> 'service_role' or p_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200
    or p_option_index is null or p_option_index < 0
    or (p_guest_id_hash is not null and p_guest_id_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;

  -- Shared boundary with legacy votes, owner structural edits and moderation.
  -- The poll is always locked before any ledger row, avoiding lock inversion.
  select p.* into current_poll from public.polls as p
  where p.id = p_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;
  if current_poll.is_hidden then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;

  if current_poll.options is null or jsonb_typeof(current_poll.options) <> 'array'
    or current_poll.votes is null or jsonb_typeof(current_poll.votes) <> 'array'
    or current_poll.participants is null or current_poll.participants < 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  option_count := jsonb_array_length(current_poll.options);
  if option_count < 2 or jsonb_array_length(current_poll.votes) <> option_count
    or p_option_index >= option_count then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.options) as item(value)
    where jsonb_typeof(item.value) <> 'string')
    or exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
      where jsonb_typeof(item.value) <> 'number'
        or (item.value #>> '{}') !~ '^(0|[1-9][0-9]*)$') then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
    where (item.value #>> '{}')::numeric > 2147483647) then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;

  if exists (select 1 from public.poll_votes as pv
    where pv.poll_id = p_poll_id and (pv.user_id = p_user_id
      or (p_guest_id_hash is not null and pv.guest_id_hash = p_guest_id_hash))) then
    raise exception using errcode = '23505', message = 'POLL_ALREADY_VOTED';
  end if;
  selected_vote_count := (current_poll.votes ->> p_option_index)::integer;
  if selected_vote_count >= 2147483647 or current_poll.participants >= 2147483647 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;

  -- The random UUID only satisfies the retained legacy NOT NULL/UUID/unique
  -- constraints. It is never derived from, returned to or trusted as a user ID.
  -- The FK independently rejects IDs not present in auth.users. Any later error
  -- rolls this insertion back together with the aggregate update.
  insert into public.poll_votes (poll_id, voter_id, option_index, user_id, guest_id_hash)
  values (p_poll_id, gen_random_uuid()::text, p_option_index, p_user_id, p_guest_id_hash);

  new_votes := jsonb_set(current_poll.votes, array[p_option_index::text],
    to_jsonb(selected_vote_count + 1), false);
  update public.polls as p
  set votes = new_votes, participants = current_poll.participants + 1
  where p.id = p_poll_id;
  return query select p_poll_id, new_votes, current_poll.participants + 1, p_option_index;
end;
$$;

create or replace function public.claim_authenticated_poll_vote(
  p_poll_id text,
  p_legacy_voter_id text,
  p_user_id uuid,
  p_guest_id_hash text
)
returns table (id text, votes jsonb, participants integer, option_index integer)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_poll public.polls%rowtype;
  current_vote public.poll_votes%rowtype;
  option_count integer;
begin
  if current_user <> 'service_role' or p_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200
    or (p_legacy_voter_id is not null and (
      char_length(p_legacy_voter_id) <> 36
      or p_legacy_voter_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ))
    or (p_guest_id_hash is not null and p_guest_id_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;

  select p.* into current_poll from public.polls as p
  where p.id = p_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;
  if current_poll.is_hidden then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;
  if current_poll.options is null or jsonb_typeof(current_poll.options) <> 'array'
    or current_poll.votes is null or jsonb_typeof(current_poll.votes) <> 'array'
    or current_poll.participants is null or current_poll.participants < 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  option_count := jsonb_array_length(current_poll.options);
  if option_count < 2 or jsonb_array_length(current_poll.votes) <> option_count then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.options) as item(value)
    where jsonb_typeof(item.value) <> 'string')
    or exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
      where jsonb_typeof(item.value) <> 'number'
        or (item.value #>> '{}') !~ '^(0|[1-9][0-9]*)$') then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
    where (item.value #>> '{}')::numeric > 2147483647) then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;

  -- Existing account identity always wins. Never merge/delete historical rows
  -- or recalculate aggregate counts, which may include pre-ledger votes.
  select pv.* into current_vote from public.poll_votes as pv
  where pv.poll_id = p_poll_id and pv.user_id = p_user_id for update;
  if found then
    -- Attach an unused browser identity once, without overriding the identity
    -- of a historical guest row or the account's earlier browser. A scalar
    -- hash cannot remember all devices; account uniqueness still spans them.
    if current_vote.guest_id_hash is null and p_guest_id_hash is not null
      and not exists (select 1 from public.poll_votes as pv
        where pv.poll_id = p_poll_id and pv.guest_id_hash = p_guest_id_hash) then
      update public.poll_votes as pv set guest_id_hash = p_guest_id_hash
      where pv.id = current_vote.id;
    end if;
  else
    -- A guest row claimed by another account must not be stolen or skipped in
    -- favor of a different legacy token: the current browser already voted.
    select pv.* into current_vote from public.poll_votes as pv
    where pv.poll_id = p_poll_id and pv.guest_id_hash = p_guest_id_hash for update;
    if found then
      if current_vote.user_id is not null then
        raise exception using errcode = '42501', message = 'VOTE_REQUIRES_ACCOUNT';
      end if;
    else
      select pv.* into current_vote from public.poll_votes as pv
      where pv.poll_id = p_poll_id and pv.voter_id = lower(p_legacy_voter_id)
        and pv.user_id is null and pv.guest_id_hash is null for update;
      if not found then return; end if;
    end if;
    if current_vote.option_index < 0 or current_vote.option_index >= option_count then
      raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
    end if;
    update public.poll_votes as pv set user_id = p_user_id,
      guest_id_hash = coalesce(pv.guest_id_hash, p_guest_id_hash)
    where pv.id = current_vote.id and pv.user_id is null;
  end if;
  if current_vote.option_index < 0 or current_vote.option_index >= option_count then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  return query select p_poll_id, current_poll.votes, current_poll.participants, current_vote.option_index;
end;
$$;

create or replace function public.cast_guest_poll_vote(
  p_poll_id text,
  p_option_index integer,
  p_guest_id_hash text
)
returns table (id text, votes jsonb, participants integer, option_index integer)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_poll public.polls%rowtype;
  option_count integer;
  selected_vote_count integer;
  new_votes jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200
    or p_option_index is null or p_option_index < 0
    or p_guest_id_hash is null or p_guest_id_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;

  -- Shared boundary with legacy votes, owner structural edits and moderation.
  -- The poll is always locked before any ledger row, avoiding lock inversion.
  select p.* into current_poll from public.polls as p
  where p.id = p_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;
  if current_poll.is_hidden then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;

  if current_poll.options is null or jsonb_typeof(current_poll.options) <> 'array'
    or current_poll.votes is null or jsonb_typeof(current_poll.votes) <> 'array'
    or current_poll.participants is null or current_poll.participants < 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  option_count := jsonb_array_length(current_poll.options);
  if option_count < 2 or jsonb_array_length(current_poll.votes) <> option_count
    or p_option_index >= option_count then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.options) as item(value)
    where jsonb_typeof(item.value) <> 'string')
    or exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
      where jsonb_typeof(item.value) <> 'number'
        or (item.value #>> '{}') !~ '^(0|[1-9][0-9]*)$') then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
    where (item.value #>> '{}')::numeric > 2147483647) then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;

  if exists (select 1 from public.poll_votes as pv
    where pv.poll_id = p_poll_id and pv.guest_id_hash = p_guest_id_hash) then
    raise exception using errcode = '23505', message = 'POLL_ALREADY_VOTED';
  end if;
  selected_vote_count := (current_poll.votes ->> p_option_index)::integer;
  if selected_vote_count >= 2147483647 or current_poll.participants >= 2147483647 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;

  -- Random legacy UUID preserves the historical voter-id constraint only.
  insert into public.poll_votes (poll_id, voter_id, option_index, guest_id_hash)
  values (p_poll_id, gen_random_uuid()::text, p_option_index, p_guest_id_hash);

  new_votes := jsonb_set(current_poll.votes, array[p_option_index::text],
    to_jsonb(selected_vote_count + 1), false);
  update public.polls as p
  set votes = new_votes, participants = current_poll.participants + 1
  where p.id = p_poll_id;
  return query select p_poll_id, new_votes, current_poll.participants + 1, p_option_index;
end;
$$;

create or replace function public.change_guest_poll_vote(
  p_poll_id text,
  p_new_option_index integer,
  p_guest_id_hash text
)
returns table (id text, votes jsonb, participants integer, option_index integer, changed boolean)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_poll public.polls%rowtype;
  current_vote public.poll_votes%rowtype;
  option_count integer;
  previous_option_index integer;
  previous_vote_count integer;
  new_vote_count integer;
  new_votes jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200
    or p_new_option_index is null or p_new_option_index < 0
    or p_guest_id_hash is null or p_guest_id_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;

  select p.* into current_poll from public.polls as p
  where p.id = p_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;
  if current_poll.is_hidden then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;
  if current_poll.options is null or jsonb_typeof(current_poll.options) <> 'array'
    or current_poll.votes is null or jsonb_typeof(current_poll.votes) <> 'array'
    or current_poll.participants is null or current_poll.participants < 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  option_count := jsonb_array_length(current_poll.options);
  if option_count < 2 or jsonb_array_length(current_poll.votes) <> option_count
    or p_new_option_index >= option_count then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.options) as item(value)
    where jsonb_typeof(item.value) <> 'string')
    or exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
      where jsonb_typeof(item.value) <> 'number'
        or (item.value #>> '{}') !~ '^(0|[1-9][0-9]*)$') then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
    where (item.value #>> '{}')::numeric > 2147483647) then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;

  select pv.* into current_vote from public.poll_votes as pv
  where pv.poll_id = p_poll_id and pv.guest_id_hash = p_guest_id_hash for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'EXISTING_VOTE_NOT_FOUND';
  end if;
  if current_vote.user_id is not null then
    raise exception using errcode = '42501', message = 'VOTE_REQUIRES_ACCOUNT';
  end if;
  previous_option_index := current_vote.option_index;
  if previous_option_index < 0 or previous_option_index >= option_count then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if previous_option_index = p_new_option_index then
    return query select p_poll_id, current_poll.votes, current_poll.participants,
      previous_option_index, false;
    return;
  end if;

  previous_vote_count := (current_poll.votes ->> previous_option_index)::integer;
  new_vote_count := (current_poll.votes ->> p_new_option_index)::integer;
  if previous_vote_count <= 0 or new_vote_count >= 2147483647 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  new_votes := jsonb_set(current_poll.votes, array[previous_option_index::text],
    to_jsonb(previous_vote_count - 1), false);
  new_votes := jsonb_set(new_votes, array[p_new_option_index::text],
    to_jsonb(new_vote_count + 1), false);
  update public.polls as p set votes = new_votes where p.id = p_poll_id;
  update public.poll_votes as pv set option_index = p_new_option_index
  where pv.id = current_vote.id and pv.user_id is null;
  return query select p_poll_id, new_votes, current_poll.participants, p_new_option_index, true;
end;
$$;

create or replace function public.claim_guest_poll_vote(
  p_poll_id text,
  p_legacy_voter_id text,
  p_guest_id_hash text
)
returns table (id text, votes jsonb, participants integer, option_index integer)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_poll public.polls%rowtype;
  current_vote public.poll_votes%rowtype;
  option_count integer;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200
    or p_guest_id_hash is null or p_guest_id_hash !~ '^[0-9a-f]{64}$'
    or (p_legacy_voter_id is not null and (
      char_length(p_legacy_voter_id) <> 36
      or p_legacy_voter_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )) then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;

  select p.* into current_poll from public.polls as p
  where p.id = p_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;
  if current_poll.is_hidden then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;
  if current_poll.options is null or jsonb_typeof(current_poll.options) <> 'array'
    or current_poll.votes is null or jsonb_typeof(current_poll.votes) <> 'array'
    or current_poll.participants is null or current_poll.participants < 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  option_count := jsonb_array_length(current_poll.options);
  if option_count < 2 or jsonb_array_length(current_poll.votes) <> option_count then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.options) as item(value)
    where jsonb_typeof(item.value) <> 'string')
    or exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
      where jsonb_typeof(item.value) <> 'number'
        or (item.value #>> '{}') !~ '^(0|[1-9][0-9]*)$') then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if exists (select 1 from jsonb_array_elements(current_poll.votes) as item(value)
    where (item.value #>> '{}')::numeric > 2147483647) then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;


  -- Existing browser identity wins. If already claimed, this is a read-only
  -- selection response: change_guest_poll_vote rejects all account-owned rows.
  select pv.* into current_vote from public.poll_votes as pv
  where pv.poll_id = p_poll_id and pv.guest_id_hash = p_guest_id_hash for update;
  if not found then
    select pv.* into current_vote from public.poll_votes as pv
    where pv.poll_id = p_poll_id and pv.voter_id = lower(p_legacy_voter_id)
      and pv.user_id is null and pv.guest_id_hash is null for update;
    if not found then return; end if;
    if current_vote.option_index < 0 or current_vote.option_index >= option_count then
      raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
    end if;
    update public.poll_votes as pv set guest_id_hash = p_guest_id_hash
    where pv.id = current_vote.id and pv.user_id is null and pv.guest_id_hash is null;
  end if;
  if current_vote.option_index < 0 or current_vote.option_index >= option_count then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  return query select p_poll_id, current_poll.votes, current_poll.participants, current_vote.option_index;
end;
$$;

revoke all on function public.cast_authenticated_poll_vote(text, integer, uuid, text)
from public, anon, authenticated;
grant execute on function public.cast_authenticated_poll_vote(text, integer, uuid, text) to service_role;

revoke all on function public.claim_authenticated_poll_vote(text, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.claim_authenticated_poll_vote(text, text, uuid, text) to service_role;

revoke all on function public.cast_guest_poll_vote(text, integer, text)
from public, anon, authenticated;
grant execute on function public.cast_guest_poll_vote(text, integer, text) to service_role;

revoke all on function public.change_guest_poll_vote(text, integer, text)
from public, anon, authenticated;
grant execute on function public.change_guest_poll_vote(text, integer, text) to service_role;

revoke all on function public.claim_guest_poll_vote(text, text, text)
from public, anon, authenticated;
grant execute on function public.claim_guest_poll_vote(text, text, text) to service_role;

comment on function public.cast_authenticated_poll_vote(text, integer, uuid, text) is
  'Service-only atomic account/browser vote. Server verifies Auth and vote-domain guest HMAC.';
comment on function public.claim_authenticated_poll_vote(text, text, uuid, text) is
  'Service-only guest/legacy account claim. Account wins conflicts; keep historical rows, browser hash and aggregate counts.';
comment on function public.cast_guest_poll_vote(text, integer, text) is
  'Service-only atomic browser vote; HMAC is server-derived, never client supplied.';
comment on function public.change_guest_poll_vote(text, integer, text) is
  'Service-only atomic guest change; same option is no-op; account-claimed rows require login.';
comment on function public.claim_guest_poll_vote(text, text, text) is
  'Service-only legacy/browser claim; no recount, deletion or account-row ownership transfer.';

notify pgrst, 'reload schema';
