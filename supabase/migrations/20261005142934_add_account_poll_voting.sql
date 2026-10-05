-- Migration first, then deploy the account-only vote API. Historical ledger
-- rows, voter IDs, aggregate counts and the legacy RPCs remain untouched.
-- user_id is supplied ONLY by a server that validated the session with getUser.
-- None of these RPCs or raw ledger rows is accessible to public clients.

do $$
declare
  existing_type text;
begin
  select c.data_type into existing_type
  from information_schema.columns as c
  where c.table_schema = 'public' and c.table_name = 'poll_votes'
    and c.column_name = 'user_id';
  if existing_type is not null and existing_type <> 'uuid' then
    raise exception using errcode = '42804', message = 'poll_votes.user_id must be uuid.';
  end if;
  if exists (select 1 from information_schema.columns as c
    where c.table_schema = 'public' and c.table_name = 'poll_votes'
      and c.column_name = 'user_id' and c.is_nullable <> 'YES') then
    raise exception using errcode = '42804', message = 'poll_votes.user_id must be nullable.';
  end if;
end;
$$;

alter table public.poll_votes add column if not exists user_id uuid;

do $$
begin
  if exists (
    select 1 from pg_constraint as c
    where c.conrelid = 'public.poll_votes'::regclass
      and c.conname = 'poll_votes_user_id_fkey'
      and (c.contype <> 'f' or c.confrelid <> 'auth.users'::regclass
        or c.confdeltype <> 'n'
        or c.conkey <> array[(select a.attnum from pg_attribute as a
          where a.attrelid = 'public.poll_votes'::regclass and a.attname = 'user_id')]
        or c.confkey <> array[(select a.attnum from pg_attribute as a
          where a.attrelid = 'auth.users'::regclass and a.attname = 'id')])
  ) then
    raise exception using errcode = '42804', message = 'poll_votes.user_id foreign key definition conflicts.';
  end if;
  if not exists (
    select 1 from pg_constraint as c
    where c.conrelid = 'public.poll_votes'::regclass
      and c.conname = 'poll_votes_user_id_fkey'
  ) then
    alter table public.poll_votes
      add constraint poll_votes_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end;
$$;

-- NULL is intentional for legacy votes and accounts subsequently removed.
-- This is the account invariant, separate from the retained voter-id unique.
create unique index if not exists poll_votes_poll_user_unique
on public.poll_votes (poll_id, user_id) where user_id is not null;

-- IF NOT EXISTS must not silently accept an unrelated/non-unique index with
-- the expected name on a partially deployed database.
do $$
begin
  if not exists (
    select 1 from pg_index as i
    where i.indexrelid = 'public.poll_votes_poll_user_unique'::regclass
      and i.indrelid = 'public.poll_votes'::regclass and i.indisunique
      and i.indisvalid and i.indnkeyatts = 2
      and i.indkey[0] = (select a.attnum from pg_attribute as a
        where a.attrelid = 'public.poll_votes'::regclass and a.attname = 'poll_id')
      and i.indkey[1] = (select a.attnum from pg_attribute as a
        where a.attrelid = 'public.poll_votes'::regclass and a.attname = 'user_id')
      and pg_get_expr(i.indpred, i.indrelid) = '(user_id IS NOT NULL)'
  ) then
    raise exception using errcode = '42804', message = 'Account vote unique index definition conflicts.';
  end if;
end;
$$;

comment on column public.poll_votes.user_id is
  'Server-verified Auth voter. Legacy rows remain null; account removal preserves vote history and aggregates.';

alter table public.poll_votes enable row level security;
revoke all on table public.poll_votes from public, anon, authenticated;
-- INVOKER needs ledger INSERT and only these two mutable columns. Existing
-- SELECT and owner-reset DELETE grants are retained; no public RLS is added.
grant select on table public.poll_votes to service_role;
grant insert (poll_id, voter_id, option_index, user_id)
on public.poll_votes to service_role;
grant update (option_index, user_id) on public.poll_votes to service_role;
revoke all on sequence public.poll_votes_id_seq from public, anon, authenticated;
grant usage on sequence public.poll_votes_id_seq to service_role;

create or replace function public.cast_authenticated_poll_vote(
  p_poll_id text,
  p_option_index integer,
  p_user_id uuid
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
    or p_option_index is null or p_option_index < 0 then
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
    where pv.poll_id = p_poll_id and pv.user_id = p_user_id) then
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
  insert into public.poll_votes (poll_id, voter_id, option_index, user_id)
  values (p_poll_id, gen_random_uuid()::text, p_option_index, p_user_id);

  new_votes := jsonb_set(current_poll.votes, array[p_option_index::text],
    to_jsonb(selected_vote_count + 1), false);
  update public.polls as p
  set votes = new_votes, participants = current_poll.participants + 1
  where p.id = p_poll_id;
  return query select p_poll_id, new_votes, current_poll.participants + 1, p_option_index;
end;
$$;

create or replace function public.change_authenticated_poll_vote(
  p_poll_id text,
  p_new_option_index integer,
  p_user_id uuid
)
returns table (id text, votes jsonb, participants integer, option_index integer, changed boolean)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_poll public.polls%rowtype;
  option_count integer;
  previous_option_index integer;
  previous_vote_count integer;
  new_vote_count integer;
  new_votes jsonb;
begin
  if current_user <> 'service_role' or p_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200
    or p_new_option_index is null or p_new_option_index < 0 then
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

  select pv.option_index into previous_option_index from public.poll_votes as pv
  where pv.poll_id = p_poll_id and pv.user_id = p_user_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'EXISTING_VOTE_NOT_FOUND';
  end if;
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
  where pv.poll_id = p_poll_id and pv.user_id = p_user_id;
  return query select p_poll_id, new_votes, current_poll.participants, p_new_option_index, true;
end;
$$;

create or replace function public.claim_authenticated_poll_vote(
  p_poll_id text,
  p_legacy_voter_id text,
  p_user_id uuid
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

  -- Existing account identity always wins. Never merge/delete historical rows
  -- or recalculate aggregate counts, which may include pre-ledger votes.
  select pv.* into current_vote from public.poll_votes as pv
  where pv.poll_id = p_poll_id and pv.user_id = p_user_id for update;
  if not found then
    select pv.* into current_vote from public.poll_votes as pv
    where pv.poll_id = p_poll_id and pv.voter_id = lower(p_legacy_voter_id)
      and pv.user_id is null for update;
    if not found then return; end if;
    if current_vote.option_index < 0 or current_vote.option_index >= option_count then
      raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
    end if;
    update public.poll_votes as pv set user_id = p_user_id
    where pv.id = current_vote.id and pv.user_id is null;
  end if;
  if current_vote.option_index < 0 or current_vote.option_index >= option_count then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  return query select p_poll_id, current_poll.votes, current_poll.participants, current_vote.option_index;
end;
$$;

revoke all on function public.cast_authenticated_poll_vote(text, integer, uuid)
from public, anon, authenticated;
grant execute on function public.cast_authenticated_poll_vote(text, integer, uuid) to service_role;
revoke all on function public.change_authenticated_poll_vote(text, integer, uuid)
from public, anon, authenticated;
grant execute on function public.change_authenticated_poll_vote(text, integer, uuid) to service_role;
revoke all on function public.claim_authenticated_poll_vote(text, text, uuid)
from public, anon, authenticated;
grant execute on function public.claim_authenticated_poll_vote(text, text, uuid) to service_role;

comment on function public.cast_authenticated_poll_vote(text, integer, uuid) is
  'Service-only atomic account vote; user ID must originate from server-verified Auth, never request data.';
comment on function public.change_authenticated_poll_vote(text, integer, uuid) is
  'Service-only atomic account vote change; retains participant count and ledger row.';
comment on function public.claim_authenticated_poll_vote(text, text, uuid) is
  'Service-only legacy claim; existing account vote takes precedence; aggregate counts never change.';

notify pgrst, 'reload schema';
