-- Follow-up only: deployed voting/reconciliation migrations are immutable.
-- No table schema, ledger identities, historical rows, aggregate backfill or
-- public table privileges are changed by applying this migration.
--
-- The server must derive p_user_id from Auth getUser() and p_guest_id_hash from
-- its HttpOnly guest cookie / vote-domain HMAC. Browser participation continues
-- after an account claim without transferring user_id to another account.
-- Account ownership takes precedence over a different browser-linked ballot.
-- p_expected_vote_id is server-resolved after validating its opaque management
-- token. Recheck it under the poll lock: a retry must never drift to another
-- ballot after cancellation or after a cancel/recast lifecycle.

do $$
begin
  if to_regprocedure('public.cast_authenticated_poll_vote(text,integer,uuid,text)') is null
    or to_regprocedure('public.claim_authenticated_poll_vote(text,text,uuid,text)') is null
    or to_regprocedure('public.cast_guest_poll_vote(text,integer,text)') is null
    or not has_table_privilege('service_role', 'public.poll_votes', 'SELECT')
    or not has_table_privilege('service_role', 'public.poll_votes', 'DELETE')
    or not has_column_privilege('service_role', 'public.poll_votes', 'option_index', 'UPDATE') then
    raise exception using errcode = '42804',
      message = 'Apply account/dual-identity voting and service-role ledger privileges first.';
  end if;
end;
$$;

create or replace function public.change_managed_poll_vote(
  p_poll_id text,
  p_new_option_index integer,
  p_user_id uuid,
  p_guest_id_hash text,
  p_expected_vote_id bigint
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
    or p_expected_vote_id is null or p_expected_vote_id <= 0
    or (p_user_id is null and p_guest_id_hash is null)
    or (p_guest_id_hash is not null and p_guest_id_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;

  -- Same lock order as casts, claims, structural edits and moderation:
  -- poll first, then the selected ledger row. No outside calls under this lock.
  select p.* into current_poll from public.polls as p
  where p.id = p_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;
  if current_poll.is_hidden is distinct from false then
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
  if p_new_option_index >= option_count then
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

  if p_user_id is not null then
    select pv.* into current_vote from public.poll_votes as pv
    where pv.poll_id = p_poll_id and pv.user_id = p_user_id for update;
  end if;
  if current_vote.id is null then
    select pv.* into current_vote from public.poll_votes as pv
    where pv.poll_id = p_poll_id and pv.guest_id_hash = p_guest_id_hash for update;
  end if;
  if current_vote.id is null or current_vote.id <> p_expected_vote_id then
    raise exception using errcode = 'P0001', message = 'VOTE_MANAGEMENT_CONFLICT';
  end if;
  previous_option_index := current_vote.option_index;
  if previous_option_index is null or previous_option_index < 0
    or previous_option_index >= option_count or current_poll.participants <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  previous_vote_count := (current_poll.votes ->> previous_option_index)::integer;
  if previous_vote_count <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  if previous_option_index = p_new_option_index then
    return query select p_poll_id, current_poll.votes, current_poll.participants,
      previous_option_index, false;
    return;
  end if;

  new_vote_count := (current_poll.votes ->> p_new_option_index)::integer;
  if new_vote_count >= 2147483647 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  new_votes := jsonb_set(current_poll.votes, array[previous_option_index::text],
    to_jsonb(previous_vote_count - 1), false);
  new_votes := jsonb_set(new_votes, array[p_new_option_index::text],
    to_jsonb(new_vote_count + 1), false);
  update public.polls as p set votes = new_votes where p.id = p_poll_id;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  -- Never transfer/rebind identities, timestamps or row IDs for management.
  update public.poll_votes as pv set option_index = p_new_option_index
  where pv.id = current_vote.id;
  if not found then
    raise exception using errcode = 'P0001', message = 'VOTE_MANAGEMENT_CONFLICT';
  end if;
  return query select p_poll_id, new_votes, current_poll.participants, p_new_option_index, true;
end;
$$;

create or replace function public.cancel_managed_poll_vote(
  p_poll_id text,
  p_user_id uuid,
  p_guest_id_hash text,
  p_expected_vote_id bigint
)
returns table (id text, votes jsonb, participants integer)
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
  new_votes jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200
    or p_expected_vote_id is null or p_expected_vote_id <= 0
    or (p_user_id is null and p_guest_id_hash is null)
    or (p_guest_id_hash is not null and p_guest_id_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'INVALID_VOTE_INPUT';
  end if;

  select p.* into current_poll from public.polls as p
  where p.id = p_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;
  if current_poll.is_hidden is distinct from false then
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

  if p_user_id is not null then
    select pv.* into current_vote from public.poll_votes as pv
    where pv.poll_id = p_poll_id and pv.user_id = p_user_id for update;
  end if;
  if current_vote.id is null then
    select pv.* into current_vote from public.poll_votes as pv
    where pv.poll_id = p_poll_id and pv.guest_id_hash = p_guest_id_hash for update;
  end if;
  -- The expected ledger row is pinned by the server's validated opaque token.
  -- Missing/mismatch includes retries, precedence drift and cancel/recast ABA.
  if current_vote.id is null or current_vote.id <> p_expected_vote_id then
    raise exception using errcode = 'P0001', message = 'VOTE_MANAGEMENT_CONFLICT';
  end if;
  previous_option_index := current_vote.option_index;
  if previous_option_index is null or previous_option_index < 0
    or previous_option_index >= option_count or current_poll.participants <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  previous_vote_count := (current_poll.votes ->> previous_option_index)::integer;
  if previous_vote_count <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;

  -- Apply one delta to the historical aggregate; never clamp or reconstruct
  -- from the ledger, which may not include older recorded votes.
  new_votes := jsonb_set(current_poll.votes, array[previous_option_index::text],
    to_jsonb(previous_vote_count - 1), false);
  update public.polls as p
  set votes = new_votes, participants = current_poll.participants - 1
  where p.id = p_poll_id;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
  end if;
  delete from public.poll_votes as pv where pv.id = current_vote.id;
  if not found then
    raise exception using errcode = 'P0001', message = 'VOTE_MANAGEMENT_CONFLICT';
  end if;
  return query select p_poll_id, new_votes, current_poll.participants - 1;
end;
$$;

revoke all on function public.change_managed_poll_vote(text, integer, uuid, text, bigint)
from public, anon, authenticated;
grant execute on function public.change_managed_poll_vote(text, integer, uuid, text, bigint)
to service_role;

revoke all on function public.cancel_managed_poll_vote(text, uuid, text, bigint)
from public, anon, authenticated;
grant execute on function public.cancel_managed_poll_vote(text, uuid, text, bigint)
to service_role;

comment on function public.change_managed_poll_vote(text, integer, uuid, text, bigint) is
  'Service-only account-first/browser-proof management. Change one existing ballot without transferring identity or changing participant count.';
comment on function public.cancel_managed_poll_vote(text, uuid, text, bigint) is
  'Service-only account-first/browser-proof cancellation. Atomically remove one ballot and decrement one option and participant, preserving historical totals.';

notify pgrst, 'reload schema';
