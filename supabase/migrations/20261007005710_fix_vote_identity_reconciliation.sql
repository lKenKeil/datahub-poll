-- Patch only the already deployed 4-argument claim RPC. Existing account
-- and dual-identity migrations are immutable. No row migration/backfill,
-- insert, delete, merge, aggregate or participant update is performed here.
--
-- Account vote has precedence. A browser ballot owned by another account is
-- still participation, not an identity error: return its existing selection.
-- The server derives canChangeVote from a private account-first lookup after
-- this RPC and never returns user_id/guest_id_hash to public clients.

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
        -- The browser already participated, but this account does not own
        -- that ballot. Return its selection as a normal read-only result.
        -- Never transfer another account's row or fall through to legacy/cast.
        if current_vote.option_index < 0 or current_vote.option_index >= option_count then
          raise exception using errcode = '22023', message = 'INVALID_POLL_VOTE_DATA';
        end if;
        return query select p_poll_id, current_poll.votes, current_poll.participants,
          current_vote.option_index;
        return;
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

revoke all on function public.claim_authenticated_poll_vote(text, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.claim_authenticated_poll_vote(text, text, uuid, text)
to service_role;

comment on function public.claim_authenticated_poll_vote(text, text, uuid, text) is
  'Service-only reconciliation: account vote first; other-account browser participation returns read-only selection without reassigning identity or changing aggregates.';

notify pgrst, 'reload schema';
