-- LOCAL DISPOSABLE DATABASE ONLY. Never run against Production, even with
-- ROLLBACK: sequences and external Auth hooks are not transactionally restored.
-- Apply the migrations to a local test database first, then run as its owner:
-- PGOPTIONS='-c askio_test.account_voting=local-disposable' psql -X \
--   -v ON_ERROR_STOP=1 -f supabase/tests/account_poll_voting.sql <local URL>
-- This suite verifies real PostgreSQL privileges, unique/FK constraints,
-- transaction rollback, historical aggregates and the account mutation RPCs.
-- A true two-connection concurrency run must be performed separately.

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
    (prefix || '_removed', 'Removed user SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0);

  select * into row_result from public.cast_authenticated_poll_vote(prefix || '_account', 0, u1);
  if row_result.votes <> '[1,0]'::jsonb or row_result.participants <> 1 or row_result.option_index <> 0 then
    raise exception 'Initial account vote did not increment once';
  end if;
  select pv.id into account_row_id from public.poll_votes as pv
  where pv.poll_id = prefix || '_account' and pv.user_id = u1;

  begin
    perform public.cast_authenticated_poll_vote(prefix || '_account', 1, u1);
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

  perform public.cast_authenticated_poll_vote(prefix || '_account', 1, u2);
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
    perform public.cast_authenticated_poll_vote(prefix || '_failure', 0, gen_random_uuid());
    raise exception 'Nonexistent account was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_failure', 0, null);
    raise exception 'Null account was accepted';
  exception when insufficient_privilege then null;
  end;

  -- INSERT precedes aggregate UPDATE. An injected aggregate failure must undo
  -- the INSERT as well, rather than leave an uncounted account vote.
  perform set_config('askio_test.reject_aggregate', 'yes', true);
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_failure', 0, u1);
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
  select * into row_result from public.claim_authenticated_poll_vote(prefix || '_legacy', upper(legacy_id), u1);
  if row_result.votes <> '[15,3]'::jsonb or row_result.participants <> 18 or row_result.option_index <> 0
    or (select pv.user_id from public.poll_votes as pv where pv.id = claimed_row_id) <> u1
    or (select count(*) from public.poll_votes as pv where pv.poll_id = prefix || '_legacy') <> 1 then
    raise exception 'Legacy claim changed aggregate counts or replaced a row';
  end if;
  perform public.claim_authenticated_poll_vote(prefix || '_legacy', legacy_id, u1);
  if exists (select 1 from public.claim_authenticated_poll_vote(prefix || '_legacy', legacy_id, u2)) then
    raise exception 'A legacy vote already claimed by another account was stolen';
  end if;
  if exists (select 1 from public.claim_authenticated_poll_vote(prefix || '_failure', gen_random_uuid()::text, u1)) then
    raise exception 'Unmatched legacy claim unexpectedly created a vote';
  end if;

  insert into public.poll_votes (poll_id, voter_id, option_index, user_id)
  values (prefix || '_conflict', gen_random_uuid()::text, 1, u1);
  insert into public.poll_votes (poll_id, voter_id, option_index)
  values (prefix || '_conflict', conflict_legacy_id, 0);
  select * into row_result from public.claim_authenticated_poll_vote(prefix || '_conflict', conflict_legacy_id, u1);
  if row_result.option_index <> 1 or row_result.votes <> '[4,7]'::jsonb or row_result.participants <> 11
    or (select count(*) from public.poll_votes as pv where pv.poll_id = prefix || '_conflict') <> 2
    or not exists (select 1 from public.poll_votes as pv where pv.poll_id = prefix || '_conflict'
      and pv.voter_id = conflict_legacy_id and pv.user_id is null) then
    raise exception 'Account/legacy conflict did not preserve both historical rows';
  end if;
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_conflict', 0, u1);
    raise exception 'Conflict accepted a third vote';
  exception when unique_violation then null;
  end;

  begin
    perform public.cast_authenticated_poll_vote(prefix || '_invalid', 0, u1);
    raise exception 'Malformed aggregate was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_failure', 2, u1);
    raise exception 'Out-of-range option was accepted';
  exception when invalid_parameter_value then null;
  end;
  update public.polls as p set is_hidden = true where p.id = prefix || '_hidden';
  begin
    perform public.cast_authenticated_poll_vote(prefix || '_hidden', 0, u1);
    raise exception 'Hidden poll accepted a vote';
  exception when no_data_found then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    perform public.claim_authenticated_poll_vote(prefix || '_hidden', legacy_id, u1);
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
  perform public.cast_authenticated_poll_vote(prefix || '_removed', 0, u3);
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
begin
  -- Privileged migration owners are still rejected by the runtime role guard.
  begin
    perform public.cast_authenticated_poll_vote(current_setting('askio_test.poll_prefix') || '_account',
      0, current_setting('askio_test.user_one')::uuid);
    raise exception 'Non-service role bypassed runtime RPC role guard';
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
