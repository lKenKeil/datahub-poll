-- LOCAL DISPOSABLE DATABASE ONLY. Never run against Production, even with
-- ROLLBACK: sequences and external Auth hooks are not transactionally restored.
-- Apply the migrations to a local test database first, then run as its owner:
-- PGOPTIONS='-c askio_test.account_voting=local-disposable' psql -X \
--   -v ON_ERROR_STOP=1 -f supabase/tests/account_poll_voting.sql <local URL>
-- This suite verifies real PostgreSQL privileges, unique/FK constraints,
-- transaction rollback, historical aggregates and dual-identity mutation RPCs.
-- A true two-connection concurrency run must be performed separately, ONLY on
-- a disposable local DB: session A locks a fixture poll row FOR UPDATE and
-- casts the guest vote without committing; session B casts with the same hash
-- and must wait. Commit A; B must fail with POLL_ALREADY_VOTED. Assert one row,
-- one aggregate increment and participants=1. Repeat for account casts, and
-- claim-vs-change in both orders. No Production/rollback-only workaround.

begin;
do $$
begin
  if current_setting('askio_test.account_voting', true) is distinct from 'local-disposable'
    or (inet_server_addr() is not null and inet_server_addr()::text not in ('127.0.0.1', '::1')) then
    raise exception 'Refusing fixtures: enable explicitly on a local disposable database only.';
  end if;
end;
$$;

do $$
declare
  voter_user uuid := gen_random_uuid();
  second_user uuid := gen_random_uuid();
  removed_user uuid := gen_random_uuid();
begin
  perform set_config('askio_test.user_one', voter_user::text, true);
  perform set_config('askio_test.user_two', second_user::text, true);
  perform set_config('askio_test.removed_user', removed_user::text, true);
  perform set_config('askio_test.poll_prefix', 'account_voting_sql_test_' || gen_random_uuid()::text, true);
  insert into auth.users (id, aud, role, email, is_anonymous)
  values
    (voter_user, 'authenticated', 'authenticated', voter_user::text || '@example.invalid', false),
    (second_user, 'authenticated', 'authenticated', second_user::text || '@example.invalid', false),
    (removed_user, 'authenticated', 'authenticated', removed_user::text || '@example.invalid', false);
end;
$$;

-- Failure injection happens strictly inside this rollback-only test transaction.
create function public.askio_test_reject_account_vote_aggregate()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_setting('askio_test.reject_aggregate', true) = 'yes'
    and new.id like current_setting('askio_test.poll_prefix') || '%' then
    raise exception using errcode = 'P0001', message = 'TEST_AGGREGATE_FAILURE';
  end if;
  return new;
end;
$$;
create trigger askio_test_reject_account_vote_aggregate
before update on public.polls for each row
execute function public.askio_test_reject_account_vote_aggregate();

create function public.askio_test_reject_account_vote_ledger()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_setting('askio_test.reject_ledger', true) = 'yes'
    and new.poll_id like current_setting('askio_test.poll_prefix') || '%' then
    raise exception using errcode = 'P0001', message = 'TEST_LEDGER_FAILURE';
  end if;
  return new;
end;
$$;
create trigger askio_test_reject_account_vote_ledger
before update on public.poll_votes for each row
execute function public.askio_test_reject_account_vote_ledger();

set local role service_role;
do $$
declare
  prefix text := current_setting('askio_test.poll_prefix');
  u1 uuid := current_setting('askio_test.user_one')::uuid;
  u2 uuid := current_setting('askio_test.user_two')::uuid;
  u3 uuid := current_setting('askio_test.removed_user')::uuid;
  legacy_id text := gen_random_uuid()::text;
  conflict_legacy_id text := gen_random_uuid()::text;
  guest_hash text := repeat('a', 64);
  second_guest_hash text := repeat('b', 64);
  legacy_guest_hash text := repeat('c', 64);
  guest_row_id bigint;
  claimed_row_id bigint;
  account_row_id bigint;
  row_result record;
  current_poll public.polls%rowtype;
begin
  insert into public.polls (id, title, category, options, votes, participants)
  values
    (prefix || '_account', 'Account voting SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0),
    (prefix || '_legacy', 'Legacy claim SQL fixture', '커뮤니티', '["A","B"]', '[15,3]', 18),
    (prefix || '_conflict', 'Legacy conflict SQL fixture', '커뮤니티', '["A","B"]', '[4,7]', 11),
    (prefix || '_failure', 'Atomic rollback SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0),
    (prefix || '_invalid', 'Invalid aggregate SQL fixture', '커뮤니티', '["A","B"]', '[0,"bad"]', 0),
    (prefix || '_hidden', 'Hidden vote SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0),
    (prefix || '_removed', 'Removed user SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0),
    (prefix || '_guest', 'Guest voting SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0),
    (prefix || '_guest_claim', 'Guest account claim SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0),
    (prefix || '_guest_conflict', 'Guest conflict SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0),
    (prefix || '_guest_legacy', 'Guest legacy SQL fixture', '커뮤니티', '["A","B"]', '[12,4]', 16),
    (prefix || '_account_browser', 'Account browser SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0);

  select * into row_result from public.cast_authenticated_poll_vote(prefix || '_account', 0, u1, null);
  if row_result.votes <> '[1,0]'::jsonb or row_result.participants <> 1 or row_result.option_index <> 0 then
    raise exception 'Initial account vote did not increment once';
  end if;
  select pv.id into account_row_id from public.poll_votes as pv
  where pv.poll_id = prefix || '_account' and pv.user_id = u1;

  begin
    perform public.cast_authenticated_poll_vote(prefix || '_account', 1, u1, null);
    raise exception 'Duplicate account vote was accepted';
  exception when unique_violation then
    if sqlerrm <> 'POLL_ALREADY_VOTED' then raise; end if;
  end;
  select p.* into current_poll from public.polls as p where p.id = prefix || '_account';
  if current_poll.votes <> '[1,0]'::jsonb or current_poll.participants <> 1
    or (select count(*) from public.poll_votes as pv where pv.poll_id = prefix || '_account') <> 1 then
    raise exception 'Duplicate changed ledger or aggregate';
  end if;
  -- The partial unique index is a backstop even for a direct privileged write.
  begin
    insert into public.poll_votes (poll_id, voter_id, option_index, user_id)
    values (prefix || '_account', gen_random_uuid()::text, 1, u1);
    raise exception 'Partial account unique constraint is absent';
  exception when unique_violation then null;
  end;

  perform public.cast_authenticated_poll_vote(prefix || '_account', 1, u2, null);
  select * into row_result from public.change_authenticated_poll_vote(prefix || '_account', 1, u1);
  if row_result.votes <> '[0,2]'::jsonb or row_result.participants <> 2 or not row_result.changed
    or (select pv.id from public.poll_votes as pv where pv.poll_id = prefix || '_account' and pv.user_id = u1) <> account_row_id then
    raise exception 'Vote change modified participants or replaced the ledger row';
  end if;
  -- Neither aggregate nor ledger UPDATE is allowed for a no-op selection.
  perform set_config('askio_test.reject_aggregate', 'yes', true);
  perform set_config('askio_test.reject_ledger', 'yes', true);
  select * into row_result from public.change_authenticated_poll_vote(prefix || '_account', 1, u1);
  if row_result.votes <> '[0,2]'::jsonb or row_result.participants <> 2 or row_result.changed then
    raise exception 'Same-option change was not a no-op';
  end if;
  perform set_config('askio_test.reject_aggregate', 'no', true);
  perform set_config('askio_test.reject_ledger', 'no', true);

  -- Missing users are independently rejected by the Auth FK, not just the API.
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_failure', 0, gen_random_uuid(), null);
    raise exception 'Nonexistent account was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_failure', 0, null, null);
    raise exception 'Null account was accepted';
  exception when insufficient_privilege then null;
  end;

  -- INSERT precedes aggregate UPDATE. An injected aggregate failure must undo
  -- the INSERT as well, rather than leave an uncounted account vote.
  perform set_config('askio_test.reject_aggregate', 'yes', true);
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_failure', 0, u1, null);
    raise exception 'Expected aggregate failure did not occur';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'TEST_AGGREGATE_FAILURE' then raise; end if;
  end;
  perform set_config('askio_test.reject_aggregate', 'no', true);
  select p.* into current_poll from public.polls as p where p.id = prefix || '_failure';
  if current_poll.votes <> '[0,0]'::jsonb or current_poll.participants <> 0
    or exists (select 1 from public.poll_votes as pv where pv.poll_id = prefix || '_failure') then
    raise exception 'Failed cast left a partially applied vote';
  end if;

  -- Aggregate UPDATE precedes ledger UPDATE for changes. If ledger UPDATE
  -- fails, the aggregate delta must roll back too.
  perform set_config('askio_test.reject_ledger', 'yes', true);
  begin
    perform public.change_authenticated_poll_vote(prefix || '_account', 0, u1);
    raise exception 'Expected ledger failure did not occur';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'TEST_LEDGER_FAILURE' then raise; end if;
  end;
  perform set_config('askio_test.reject_ledger', 'no', true);
  select p.* into current_poll from public.polls as p where p.id = prefix || '_account';
  if current_poll.votes <> '[0,2]'::jsonb or current_poll.participants <> 2
    or (select pv.option_index from public.poll_votes as pv where pv.id = account_row_id) <> 1 then
    raise exception 'Failed change left a partially applied vote';
  end if;

  -- Historical aggregates intentionally do not equal ledger count. Claim must
  -- preserve them exactly, retain the same ledger ID and be idempotent.
  insert into public.poll_votes (poll_id, voter_id, option_index)
  values (prefix || '_legacy', legacy_id, 0) returning id into claimed_row_id;
  select * into row_result from public.claim_authenticated_poll_vote(prefix || '_legacy', upper(legacy_id), u1, null);
  if row_result.votes <> '[15,3]'::jsonb or row_result.participants <> 18 or row_result.option_index <> 0
    or (select pv.user_id from public.poll_votes as pv where pv.id = claimed_row_id) <> u1
    or (select count(*) from public.poll_votes as pv where pv.poll_id = prefix || '_legacy') <> 1 then
    raise exception 'Legacy claim changed aggregate counts or replaced a row';
  end if;
  perform public.claim_authenticated_poll_vote(prefix || '_legacy', legacy_id, u1, null);
  if exists (select 1 from public.claim_authenticated_poll_vote(prefix || '_legacy', legacy_id, u2, null)) then
    raise exception 'A legacy vote already claimed by another account was stolen';
  end if;
  if exists (select 1 from public.claim_authenticated_poll_vote(prefix || '_failure', gen_random_uuid()::text, u1, null)) then
    raise exception 'Unmatched legacy claim unexpectedly created a vote';
  end if;

  insert into public.poll_votes (poll_id, voter_id, option_index, user_id)
  values (prefix || '_conflict', gen_random_uuid()::text, 1, u1);
  insert into public.poll_votes (poll_id, voter_id, option_index)
  values (prefix || '_conflict', conflict_legacy_id, 0);
  select * into row_result from public.claim_authenticated_poll_vote(prefix || '_conflict', conflict_legacy_id, u1, null);
  if row_result.option_index <> 1 or row_result.votes <> '[4,7]'::jsonb or row_result.participants <> 11
    or (select count(*) from public.poll_votes as pv where pv.poll_id = prefix || '_conflict') <> 2
    or not exists (select 1 from public.poll_votes as pv where pv.poll_id = prefix || '_conflict'
      and pv.voter_id = conflict_legacy_id and pv.user_id is null) then
    raise exception 'Account/legacy conflict did not preserve both historical rows';
  end if;
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_conflict', 0, u1, null);
    raise exception 'Conflict accepted a third vote';
  exception when unique_violation then null;
  end;

  begin
    perform public.cast_authenticated_poll_vote(prefix || '_invalid', 0, u1, null);
    raise exception 'Malformed aggregate was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_failure', 2, u1, null);
    raise exception 'Out-of-range option was accepted';
  exception when invalid_parameter_value then null;
  end;
  update public.polls as p set is_hidden = true where p.id = prefix || '_hidden';
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_hidden', 0, u1, null);
    raise exception 'Hidden poll accepted a vote';
  exception when no_data_found then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    perform public.claim_authenticated_poll_vote(prefix || '_hidden', legacy_id, u1, null);
    raise exception 'Hidden poll accepted a claim';
  exception when no_data_found then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    perform public.change_authenticated_poll_vote(prefix || '_hidden', 0, u1);
    raise exception 'Hidden poll accepted a change';
  exception when no_data_found then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  perform public.cast_authenticated_poll_vote(prefix || '_removed', 0, u3, null);

  -- Guest identity: one row/one increment; POST retry cannot add another vote.
  select * into row_result from public.cast_guest_poll_vote(prefix || '_guest', 0, guest_hash);
  select pv.id into guest_row_id from public.poll_votes as pv
  where pv.poll_id = prefix || '_guest' and pv.guest_id_hash = guest_hash;
  if row_result.votes <> '[1,0]'::jsonb or row_result.participants <> 1
    or row_result.option_index <> 0
    or (select pv.user_id from public.poll_votes as pv where pv.id = guest_row_id) is not null then
    raise exception 'Guest vote did not increment once with an anonymous ledger';
  end if;
  begin
    perform public.cast_guest_poll_vote(prefix || '_guest', 1, guest_hash);
    raise exception 'Guest duplicate was accepted';
  exception when unique_violation then
    if sqlerrm <> 'POLL_ALREADY_VOTED' then raise; end if;
  end;
  begin
    insert into public.poll_votes (poll_id, voter_id, option_index, guest_id_hash)
    values (prefix || '_guest', gen_random_uuid()::text, 1, guest_hash);
    raise exception 'Guest partial unique index is absent';
  exception when unique_violation then null;
  end;
  select * into row_result from public.change_guest_poll_vote(prefix || '_guest', 1, guest_hash);
  if row_result.votes <> '[0,1]'::jsonb or row_result.participants <> 1 or not row_result.changed
    or (select pv.id from public.poll_votes as pv
      where pv.poll_id = prefix || '_guest' and pv.guest_id_hash = guest_hash) <> guest_row_id then
    raise exception 'Guest change replaced ledger or changed participants';
  end if;
  perform set_config('askio_test.reject_aggregate', 'yes', true);
  perform set_config('askio_test.reject_ledger', 'yes', true);
  select * into row_result from public.change_guest_poll_vote(prefix || '_guest', 1, guest_hash);
  if row_result.changed then raise exception 'Guest same option was not a no-op'; end if;
  perform set_config('askio_test.reject_aggregate', 'no', true);
  perform set_config('askio_test.reject_ledger', 'no', true);
  select * into row_result from public.claim_guest_poll_vote(prefix || '_guest', null, guest_hash);
  if row_result.option_index <> 1 then raise exception 'Guest reload selection was lost'; end if;

  -- A failed guest aggregate update must undo its ledger INSERT as well.
  perform set_config('askio_test.reject_aggregate', 'yes', true);
  begin
    perform public.cast_guest_poll_vote(prefix || '_failure', 0, guest_hash);
    raise exception 'Expected guest aggregate failure did not occur';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'TEST_AGGREGATE_FAILURE' then raise; end if;
  end;
  perform set_config('askio_test.reject_aggregate', 'no', true);
  if exists (select 1 from public.poll_votes as pv where pv.poll_id = prefix || '_failure') then
    raise exception 'Guest failure left a ledger row';
  end if;
  perform set_config('askio_test.reject_ledger', 'yes', true);
  begin
    perform public.change_guest_poll_vote(prefix || '_guest', 0, guest_hash);
    raise exception 'Expected guest ledger failure did not occur';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'TEST_LEDGER_FAILURE' then raise; end if;
  end;
  perform set_config('askio_test.reject_ledger', 'no', true);
  if not exists (select 1 from public.polls as p where p.id = prefix || '_guest'
    and p.votes = '[0,1]'::jsonb and p.participants = 1) then
    raise exception 'Guest change failure corrupted aggregate';
  end if;

  -- Claim keeps the guest identity and ledger row, with zero aggregate delta.
  perform public.cast_guest_poll_vote(prefix || '_guest_claim', 0, guest_hash);
  select pv.id into guest_row_id from public.poll_votes as pv
  where pv.poll_id = prefix || '_guest_claim' and pv.guest_id_hash = guest_hash;
  select * into row_result from public.claim_authenticated_poll_vote(prefix || '_guest_claim', null, u1, guest_hash);
  if row_result.votes <> '[1,0]'::jsonb or row_result.participants <> 1
    or not exists (select 1 from public.poll_votes as pv where pv.id = guest_row_id
      and pv.user_id = u1 and pv.guest_id_hash = guest_hash)
    or (select count(*) from public.poll_votes as pv where pv.poll_id = prefix || '_guest_claim') <> 1 then
    raise exception 'Guest/account claim modified aggregate or lost identity continuity';
  end if;
  perform public.claim_authenticated_poll_vote(prefix || '_guest_claim', null, u1, guest_hash);
  begin
    perform public.cast_guest_poll_vote(prefix || '_guest_claim', 1, guest_hash);
    raise exception 'Logout created another vote after account claim';
  exception when unique_violation then null;
  end;
  begin
    perform public.change_guest_poll_vote(prefix || '_guest_claim', 1, guest_hash);
    raise exception 'Logged-out guest changed a claimed account vote';
  exception when insufficient_privilege then
    if sqlerrm <> 'VOTE_REQUIRES_ACCOUNT' then raise; end if;
  end;
  begin
    perform public.claim_authenticated_poll_vote(prefix || '_guest_claim', null, u2, guest_hash);
    raise exception 'Another account stole the claimed guest row';
  exception when insufficient_privilege then null;
  end;

  -- Existing account wins guest conflict; keep both historical votes, no third.
  perform public.cast_guest_poll_vote(prefix || '_guest_conflict', 0, guest_hash);
  perform public.cast_authenticated_poll_vote(prefix || '_guest_conflict', 1, u1, second_guest_hash);
  select * into row_result from public.claim_authenticated_poll_vote(prefix || '_guest_conflict', null, u1, guest_hash);
  if row_result.option_index <> 1 or row_result.votes <> '[1,1]'::jsonb or row_result.participants <> 2
    or (select count(*) from public.poll_votes as pv where pv.poll_id = prefix || '_guest_conflict') <> 2 then
    raise exception 'Guest/account conflict merged history or changed aggregates';
  end if;
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_guest_conflict', 0, u1, guest_hash);
    raise exception 'Account conflict allowed a third vote';
  exception when unique_violation then null;
  end;
  begin
    perform public.cast_guest_poll_vote(prefix || '_guest_conflict', 1, guest_hash);
    raise exception 'Guest conflict allowed a third vote';
  exception when unique_violation then null;
  end;

  -- Genuine legacy rows can bind guest, then account, without recounting.
  insert into public.poll_votes (poll_id, voter_id, option_index)
  values (prefix || '_guest_legacy', legacy_id, 1) returning id into guest_row_id;
  select * into row_result from public.claim_guest_poll_vote(prefix || '_guest_legacy', upper(legacy_id), legacy_guest_hash);
  if row_result.votes <> '[12,4]'::jsonb or row_result.participants <> 16
    or not exists (select 1 from public.poll_votes as pv where pv.id = guest_row_id
      and pv.user_id is null and pv.guest_id_hash = legacy_guest_hash) then
    raise exception 'Legacy/guest claim changed historical aggregates';
  end if;
  perform public.claim_authenticated_poll_vote(prefix || '_guest_legacy', null, u1, legacy_guest_hash);
  if not exists (select 1 from public.polls as p where p.id = prefix || '_guest_legacy'
      and p.votes = '[12,4]'::jsonb and p.participants = 16)
    or (select count(*) from public.poll_votes as pv where pv.poll_id = prefix || '_guest_legacy') <> 1 then
    raise exception 'Legacy/guest/account claim recounted history';
  end if;

  -- An account-first vote also prevents logout from repeating that browser vote.
  perform public.cast_authenticated_poll_vote(prefix || '_account_browser', 0, u1, guest_hash);
  begin
    perform public.cast_guest_poll_vote(prefix || '_account_browser', 1, guest_hash);
    raise exception 'Logout repeated an authenticated-first browser vote';
  exception when unique_violation then null;
  end;
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_account_browser', 1, u1, second_guest_hash);
    raise exception 'Another browser repeated an account vote';
  exception when unique_violation then null;
  end;

  begin
    perform public.cast_guest_poll_vote(prefix || '_failure', 0, gen_random_uuid()::text);
    raise exception 'Raw UUID was accepted as a guest hash';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.cast_guest_poll_vote(prefix || '_hidden', 0, guest_hash);
    raise exception 'Hidden poll accepted a guest vote';
  exception when no_data_found then null;
  end;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform 1 from public.poll_votes;
    raise exception 'anon read raw vote rows';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cast_authenticated_poll_vote(current_setting('askio_test.poll_prefix') || '_account',
      0, current_setting('askio_test.user_one')::uuid);
    raise exception 'anon executed account cast RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform 1 from public.poll_votes;
    raise exception 'authenticated read another account vote rows';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.change_authenticated_poll_vote(current_setting('askio_test.poll_prefix') || '_account',
      0, current_setting('askio_test.user_one')::uuid);
    raise exception 'authenticated executed account change RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_authenticated_poll_vote(current_setting('askio_test.poll_prefix') || '_account',
      gen_random_uuid()::text, current_setting('askio_test.user_one')::uuid);
    raise exception 'authenticated executed account claim RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
declare
  rpc_signature text;
begin
  foreach rpc_signature in array array[
    'public.cast_authenticated_poll_vote(text,integer,uuid,text)',
    'public.claim_authenticated_poll_vote(text,text,uuid,text)',
    'public.cast_guest_poll_vote(text,integer,text)',
    'public.change_guest_poll_vote(text,integer,text)',
    'public.claim_guest_poll_vote(text,text,text)'
  ] loop
    if has_function_privilege('anon', rpc_signature, 'EXECUTE')
      or has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
      or not has_function_privilege('service_role', rpc_signature, 'EXECUTE') then
      raise exception 'Dual-identity RPC ACL is not service-only: %', rpc_signature;
    end if;
    if not exists (select 1 from pg_proc as p where p.oid = rpc_signature::regprocedure
      and not p.prosecdef and p.pronargdefaults = 0
      and 'search_path=pg_catalog' = any(p.proconfig)) then
      raise exception 'Dual-identity RPC security/default signature differs: %', rpc_signature;
    end if;
  end loop;
  -- Privileged migration owners are still rejected by the runtime role guard.
  begin
    perform public.cast_authenticated_poll_vote(current_setting('askio_test.poll_prefix') || '_account',
      0, current_setting('askio_test.user_one')::uuid);
    raise exception 'Non-service role bypassed runtime RPC role guard';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cast_guest_poll_vote(current_setting('askio_test.poll_prefix') || '_guest',
      0, repeat('a', 64));
    raise exception 'Non-service role bypassed guest RPC runtime guard';
  exception when insufficient_privilege then null;
  end;
  delete from auth.users where id = current_setting('askio_test.removed_user')::uuid;
  if not exists (select 1 from public.poll_votes as pv
    where pv.poll_id = current_setting('askio_test.poll_prefix') || '_removed' and pv.user_id is null)
    or not exists (select 1 from public.polls as p
      where p.id = current_setting('askio_test.poll_prefix') || '_removed'
        and p.votes = '[1,0]'::jsonb and p.participants = 1) then
    raise exception 'Account removal lost vote history or changed aggregates';
  end if;
end;
$$;

rollback;
