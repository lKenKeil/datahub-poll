-- LOCAL DISPOSABLE DATABASE ONLY. Never execute on Production, even with
-- ROLLBACK. Apply account-voting, dual-identity, reconciliation and managed-
-- voting migrations first. Run as local owner with ON_ERROR_STOP enabled:
-- PGOPTIONS='-c askio_test.vote_management=local-disposable' psql -X \
--   -v ON_ERROR_STOP=1 -f supabase/tests/vote_management.sql <local URL>
-- Multi-connection cancel/change races must also be exercised separately.

begin;
do $$
begin
  if current_setting('askio_test.vote_management', true) is distinct from 'local-disposable'
    or (inet_server_addr() is not null and host(inet_server_addr()) not in ('127.0.0.1', '::1')) then
    raise exception 'Refusing fixtures: enable explicitly on a local disposable database only.';
  end if;
end;
$$;

do $$
declare
  google_user uuid := gen_random_uuid();
  kakao_user uuid := gen_random_uuid();
begin
  perform set_config('askio_test.management_google', google_user::text, true);
  perform set_config('askio_test.management_kakao', kakao_user::text, true);
  perform set_config('askio_test.management_prefix', 'vote_management_test_' || gen_random_uuid()::text, true);
  insert into auth.users (id, aud, role, email, is_anonymous)
  values
    (google_user, 'authenticated', 'authenticated', google_user::text || '@example.invalid', false),
    (kakao_user, 'authenticated', 'authenticated', kakao_user::text || '@example.invalid', false);
end;
$$;

create function public.askio_test_reject_managed_aggregate()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_setting('askio_test.management_reject_aggregate', true) = 'yes'
    and new.id like current_setting('askio_test.management_prefix') || '%' then
    raise exception using errcode = 'P0001', message = 'TEST_MANAGEMENT_AGGREGATE_FAILURE';
  end if;
  return new;
end;
$$;
create trigger askio_test_reject_managed_aggregate
before update on public.polls for each row
execute function public.askio_test_reject_managed_aggregate();

create function public.askio_test_reject_managed_ledger()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_setting('askio_test.management_reject_ledger', true) = 'yes'
    and (case when tg_op = 'DELETE' then old.poll_id else new.poll_id end)
      like current_setting('askio_test.management_prefix') || '%' then
    raise exception using errcode = 'P0001', message = 'TEST_MANAGEMENT_LEDGER_FAILURE';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger askio_test_reject_managed_ledger
before update or delete on public.poll_votes for each row
execute function public.askio_test_reject_managed_ledger();

set local role service_role;
do $$
#variable_conflict use_variable
declare
  prefix text := current_setting('askio_test.management_prefix');
  google_user uuid := current_setting('askio_test.management_google')::uuid;
  kakao_user uuid := current_setting('askio_test.management_kakao')::uuid;
  first_user uuid;
  next_user uuid;
  guest_hash text := repeat('a', 64);
  other_hash text := repeat('b', 64);
  unknown_hash text := repeat('c', 64);
  poll_id text;
  case_index integer;
  vote_id bigint;
  account_vote_id bigint;
  voter_token text;
  row_before jsonb;
  current_poll public.polls%rowtype;
  result record;
begin
  -- The provider labels are fixture roles only; the database uses Auth UUIDs.
  -- Test both guest -> Google -> Kakao and guest -> Kakao -> Google.
  for case_index in 1..2 loop
    poll_id := prefix || '_provider_' || case_index;
    first_user := case when case_index = 1 then google_user else kakao_user end;
    next_user := case when case_index = 1 then kakao_user else google_user end;
    insert into public.polls (id, title, category, options, votes, participants)
    values (poll_id, 'Provider continuity SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0);
    perform public.cast_guest_poll_vote(poll_id, 0, guest_hash);
    perform public.claim_authenticated_poll_vote(poll_id, null, first_user, guest_hash);
    select pv.id, pv.voter_id, to_jsonb(pv) into vote_id, voter_token, row_before
    from public.poll_votes as pv where pv.poll_id = poll_id;
    select * into result from public.change_managed_poll_vote(poll_id, 1, first_user, guest_hash, vote_id);
    if result.votes is distinct from '[0,1]'::jsonb or result.participants <> 1
      or not result.changed then raise exception 'First provider change failed'; end if;
    perform public.claim_authenticated_poll_vote(poll_id, null, next_user, guest_hash);
    select * into result from public.change_managed_poll_vote(poll_id, 0, next_user, guest_hash, vote_id);
    if result.votes is distinct from '[1,0]'::jsonb or result.participants <> 1
      or not result.changed
      or (select count(*) from public.poll_votes as pv where pv.poll_id = poll_id) <> 1
      or not exists (select 1 from public.poll_votes as pv where pv.id = vote_id
        and pv.user_id = first_user and pv.guest_id_hash = guest_hash
        and pv.voter_id = voter_token and pv.option_index = 0) then
      raise exception 'Cross-provider change duplicated, reassigned or recounted a vote';
    end if;
    -- All immutable fields, including timestamps, must stay unchanged.
    if (select to_jsonb(pv) - 'option_index' from public.poll_votes as pv where pv.id = vote_id)
      is distinct from row_before - 'option_index' then
      raise exception 'Managed change modified identity or immutable ledger fields';
    end if;
    -- Logging out does not remove this browser's participation proof.
    select * into result from public.change_managed_poll_vote(poll_id, 1, null, guest_hash, vote_id);
    if result.option_index <> 1 or result.participants <> 1 then
      raise exception 'Logged-out browser could not manage its claimed ballot';
    end if;
    select * into result from public.cancel_managed_poll_vote(poll_id, next_user, guest_hash, vote_id);
    if result.votes is distinct from '[0,0]'::jsonb or result.participants <> 0
      or exists (select 1 from public.poll_votes as pv where pv.poll_id = poll_id) then
      raise exception 'Browser-linked cancellation did not remove exactly its counted ballot';
    end if;
    begin
      perform public.cancel_managed_poll_vote(poll_id, next_user, guest_hash, vote_id);
      raise exception 'Repeated cancellation was accepted';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'VOTE_MANAGEMENT_CONFLICT' then raise; end if;
    end;
    if exists (select 1 from public.claim_authenticated_poll_vote(poll_id, null, first_user, guest_hash)) then
      raise exception 'Original account retained the cancelled browser ballot';
    end if;
    perform public.cast_authenticated_poll_vote(poll_id, 0, next_user, guest_hash);
    if not exists (select 1 from public.polls as p where p.id = poll_id
        and p.votes = '[1,0]'::jsonb and p.participants = 1)
      or (select count(*) from public.poll_votes as pv where pv.poll_id = poll_id) <> 1 then
      raise exception 'Re-vote after cancellation was not exactly one new ballot';
    end if;
    -- A stale request is pinned to the deleted row, not its new replacement.
    begin
      perform public.cancel_managed_poll_vote(poll_id, next_user, guest_hash, vote_id);
      raise exception 'Cancel/recast ABA cancelled a newly created ballot';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'VOTE_MANAGEMENT_CONFLICT' then raise; end if;
    end;
    begin
      perform public.change_managed_poll_vote(poll_id, 1, next_user, guest_hash, vote_id);
      raise exception 'Cancel/recast ABA changed a newly created ballot';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'VOTE_MANAGEMENT_CONFLICT' then raise; end if;
    end;
    if not exists (select 1 from public.polls as p where p.id = poll_id
        and p.votes = '[1,0]'::jsonb and p.participants = 1)
      or (select count(*) from public.poll_votes as pv where pv.poll_id = poll_id) <> 1 then
      raise exception 'Stale requests changed the replacement ballot';
    end if;
  end loop;

  -- Account-first conflicts must preserve the other account's browser row.
  poll_id := prefix || '_conflict';
  insert into public.polls (id, title, category, options, votes, participants)
  values (poll_id, 'Account precedence SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0);
  perform public.cast_guest_poll_vote(poll_id, 0, guest_hash);
  perform public.claim_authenticated_poll_vote(poll_id, null, google_user, guest_hash);
  select pv.id, to_jsonb(pv) into vote_id, row_before from public.poll_votes as pv
  where pv.poll_id = poll_id and pv.user_id = google_user;
  perform public.cast_authenticated_poll_vote(poll_id, 1, kakao_user, other_hash);
  select pv.id into account_vote_id from public.poll_votes as pv
  where pv.poll_id = poll_id and pv.user_id = kakao_user;
  select * into result from public.change_managed_poll_vote(poll_id, 0, kakao_user, guest_hash, account_vote_id);
  if result.votes is distinct from '[2,0]'::jsonb or result.participants <> 2
    or (select to_jsonb(pv) from public.poll_votes as pv where pv.id = vote_id) is distinct from row_before then
    raise exception 'Account change modified the other-account browser row';
  end if;
  select * into result from public.cancel_managed_poll_vote(poll_id, kakao_user, guest_hash, account_vote_id);
  if result.votes is distinct from '[1,0]'::jsonb or result.participants <> 1
    or exists (select 1 from public.poll_votes as pv where pv.poll_id = poll_id and pv.user_id = kakao_user)
    or (select to_jsonb(pv) from public.poll_votes as pv where pv.id = vote_id) is distinct from row_before then
    raise exception 'Account cancellation touched the other-account browser row';
  end if;
  -- The same pending request must not drift from the deleted account ballot to
  -- the browser's other-account ballot when the poll lock becomes available.
  begin
    perform public.cancel_managed_poll_vote(poll_id, kakao_user, guest_hash, account_vote_id);
    raise exception 'Repeated account cancel deleted the browser fallback ballot';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'VOTE_MANAGEMENT_CONFLICT' then raise; end if;
  end;
  begin
    perform public.change_managed_poll_vote(poll_id, 1, kakao_user, guest_hash, account_vote_id);
    raise exception 'Pending account change modified the browser fallback ballot';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'VOTE_MANAGEMENT_CONFLICT' then raise; end if;
  end;
  if (select to_jsonb(pv) from public.poll_votes as pv where pv.id = vote_id) is distinct from row_before
    or not exists (select 1 from public.polls as p where p.id = poll_id
      and p.votes = '[1,0]'::jsonb and p.participants = 1) then
    raise exception 'Stale account requests modified another account ballot';
  end if;

  -- Guest-only and account-only cancellation both remove one aggregate vote.
  for case_index in 1..2 loop
    poll_id := prefix || '_cancel_' || case_index;
    insert into public.polls (id, title, category, options, votes, participants)
    values (poll_id, 'Cancellation SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0);
    if case_index = 1 then
      perform public.cast_guest_poll_vote(poll_id, 0, guest_hash);
      select pv.id into vote_id from public.poll_votes as pv where pv.poll_id = poll_id;
      select * into result from public.cancel_managed_poll_vote(poll_id, null, guest_hash, vote_id);
    else
      perform public.cast_authenticated_poll_vote(poll_id, 0, google_user, null);
      select pv.id into vote_id from public.poll_votes as pv where pv.poll_id = poll_id;
      select * into result from public.cancel_managed_poll_vote(poll_id, google_user, null, vote_id);
    end if;
    if result.votes is distinct from '[0,0]'::jsonb or result.participants <> 0
      or exists (select 1 from public.poll_votes as pv where pv.poll_id = poll_id) then
      raise exception 'Guest/account cancellation did not decrement exactly once';
    end if;
  end loop;

  -- A legacy row without browser/account proof cannot be guessed into ownership.
  poll_id := prefix || '_legacy';
  insert into public.polls (id, title, category, options, votes, participants)
  values (poll_id, 'Historical aggregate SQL fixture', '커뮤니티', '["A","B"]', '[15,3]', 18);
  voter_token := gen_random_uuid()::text;
  insert into public.poll_votes (poll_id, voter_id, option_index)
  values (poll_id, voter_token, 0) returning id into vote_id;
  begin
    perform public.change_managed_poll_vote(poll_id, 1, google_user, guest_hash, vote_id);
    raise exception 'Unclaimed legacy ballot gained browser ownership';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'VOTE_MANAGEMENT_CONFLICT' then raise; end if;
  end;
  perform public.claim_guest_poll_vote(poll_id, voter_token, guest_hash);
  select * into result from public.cancel_managed_poll_vote(poll_id, null, guest_hash, vote_id);
  if result.votes is distinct from '[14,3]'::jsonb or result.participants <> 17 then
    raise exception 'Cancellation recounted historical aggregate instead of applying one delta';
  end if;

  -- Same-option change is a no-op, even with mutation-failing triggers enabled.
  poll_id := prefix || '_atomic';
  insert into public.polls (id, title, category, options, votes, participants)
  values (poll_id, 'Atomic failure SQL fixture', '커뮤니티', '["A","B"]', '[0,0]', 0);
  perform public.cast_guest_poll_vote(poll_id, 0, guest_hash);
  select pv.id, to_jsonb(pv) into vote_id, row_before from public.poll_votes as pv where pv.poll_id = poll_id;
  perform set_config('askio_test.management_reject_aggregate', 'yes', true);
  perform set_config('askio_test.management_reject_ledger', 'yes', true);
  select * into result from public.change_managed_poll_vote(poll_id, 0, null, guest_hash, vote_id);
  if result.changed or result.votes is distinct from '[1,0]'::jsonb or result.participants <> 1 then
    raise exception 'Managed same-option selection was not a no-op';
  end if;
  perform set_config('askio_test.management_reject_aggregate', 'no', true);
  -- A ledger failure after aggregate UPDATE must roll that aggregate back.
  begin
    perform public.change_managed_poll_vote(poll_id, 1, null, guest_hash, vote_id);
    raise exception 'Injected change failure did not occur';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'TEST_MANAGEMENT_LEDGER_FAILURE' then raise; end if;
  end;
  begin
    perform public.cancel_managed_poll_vote(poll_id, null, guest_hash, vote_id);
    raise exception 'Injected cancellation failure did not occur';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'TEST_MANAGEMENT_LEDGER_FAILURE' then raise; end if;
  end;
  perform set_config('askio_test.management_reject_ledger', 'no', true);
  if not exists (select 1 from public.polls as p where p.id = poll_id
      and p.votes = '[1,0]'::jsonb and p.participants = 1)
    or (select to_jsonb(pv) from public.poll_votes as pv where pv.id = vote_id) is distinct from row_before then
    raise exception 'Failed change/cancellation left partial aggregate or ledger state';
  end if;
  perform set_config('askio_test.management_reject_aggregate', 'yes', true);
  begin
    perform public.cancel_managed_poll_vote(poll_id, null, guest_hash, vote_id);
    raise exception 'Injected aggregate failure did not occur';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'TEST_MANAGEMENT_AGGREGATE_FAILURE' then raise; end if;
  end;
  perform set_config('askio_test.management_reject_aggregate', 'no', true);
  if (select to_jsonb(pv) from public.poll_votes as pv where pv.id = vote_id) is distinct from row_before then
    raise exception 'Failed aggregate update deleted the ballot';
  end if;
  begin
    perform public.cancel_managed_poll_vote(poll_id, kakao_user, unknown_hash, vote_id);
    raise exception 'Unrelated account/browser cancelled another ballot';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'VOTE_MANAGEMENT_CONFLICT' then raise; end if;
  end;
  begin
    perform public.change_managed_poll_vote(poll_id, 2, null, guest_hash, vote_id);
    raise exception 'Out-of-range new option was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.cancel_managed_poll_vote(poll_id, null, gen_random_uuid()::text, vote_id);
    raise exception 'Unhashed client identity was accepted';
  exception when invalid_parameter_value then null;
  end;
  update public.polls as p set is_hidden = true where p.id = poll_id;
  begin
    perform public.cancel_managed_poll_vote(poll_id, null, guest_hash, vote_id);
    raise exception 'Hidden poll accepted cancellation';
  exception when no_data_found then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    perform public.change_managed_poll_vote(poll_id, 1, null, guest_hash, vote_id);
    raise exception 'Hidden poll accepted change';
  exception when no_data_found then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  update public.polls as p set is_hidden = false where p.id = poll_id;

  -- Fail closed for negative/malformed/zero historical counters, never clamp.
  for case_index in 1..5 loop
    update public.polls as p set
      votes = case case_index when 1 then '[0,0]'::jsonb when 2 then '[-1,0]'::jsonb
        when 3 then '[1,"bad"]'::jsonb when 4 then '[1,0]'::jsonb else '[1,2147483648]'::jsonb end,
      participants = case when case_index = 4 then 0 else 1 end
    where p.id = poll_id;
    select p.* into current_poll from public.polls as p where p.id = poll_id;
    begin
      perform public.cancel_managed_poll_vote(poll_id, null, guest_hash, vote_id);
      raise exception 'Invalid aggregate cancellation accepted, case %', case_index;
    exception when invalid_parameter_value then
      if sqlerrm <> 'INVALID_POLL_VOTE_DATA' then raise; end if;
    end;
    begin
      perform public.change_managed_poll_vote(poll_id, 1, null, guest_hash, vote_id);
      raise exception 'Invalid aggregate change accepted, case %', case_index;
    exception when invalid_parameter_value then
      if sqlerrm <> 'INVALID_POLL_VOTE_DATA' then raise; end if;
    end;
    if not exists (select 1 from public.polls as p where p.id = poll_id
        and p.votes = current_poll.votes and p.participants = current_poll.participants)
      or (select to_jsonb(pv) from public.poll_votes as pv where pv.id = vote_id) is distinct from row_before then
      raise exception 'Invalid cancellation changed historical data';
    end if;
  end loop;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform 1 from public.poll_votes;
    raise exception 'anon read private vote rows';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cancel_managed_poll_vote(current_setting('askio_test.management_prefix') || '_atomic',
      null, repeat('a', 64), 1);
    raise exception 'anon invoked cancellation RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.change_managed_poll_vote(current_setting('askio_test.management_prefix') || '_atomic',
      1, null, repeat('a', 64), 1);
    raise exception 'anon invoked managed change RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.poll_votes where poll_id = current_setting('askio_test.management_prefix') || '_atomic';
    raise exception 'anon directly deleted a ballot';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.poll_votes (poll_id, voter_id, option_index)
    values (current_setting('askio_test.management_prefix') || '_atomic', gen_random_uuid()::text, 0);
    raise exception 'anon directly inserted a ballot';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform 1 from public.poll_votes;
    raise exception 'authenticated read private vote rows';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cancel_managed_poll_vote(current_setting('askio_test.management_prefix') || '_atomic',
      current_setting('askio_test.management_google')::uuid, repeat('a', 64), 1);
    raise exception 'authenticated invoked cancellation RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.change_managed_poll_vote(current_setting('askio_test.management_prefix') || '_atomic',
      1, current_setting('askio_test.management_google')::uuid, repeat('a', 64), 1);
    raise exception 'authenticated invoked managed change RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.poll_votes set option_index = 1;
    raise exception 'authenticated directly changed ballots';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.poll_votes where poll_id = current_setting('askio_test.management_prefix') || '_atomic';
    raise exception 'authenticated directly deleted a ballot';
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
    'public.change_managed_poll_vote(text,integer,uuid,text,bigint)',
    'public.cancel_managed_poll_vote(text,uuid,text,bigint)'
  ] loop
    if has_function_privilege('anon', rpc_signature, 'EXECUTE')
      or has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
      or not has_function_privilege('service_role', rpc_signature, 'EXECUTE') then
      raise exception 'Managed voting RPC ACL is not service-only: %', rpc_signature;
    end if;
    if not exists (select 1 from pg_proc as p where p.oid = rpc_signature::regprocedure
      and not p.prosecdef and p.pronargdefaults = 0
      and 'search_path=pg_catalog' = any(p.proconfig)) then
      raise exception 'Managed voting RPC security differs: %', rpc_signature;
    end if;
  end loop;
  begin
    perform public.cancel_managed_poll_vote(current_setting('askio_test.management_prefix') || '_atomic',
      null, repeat('a', 64), 1);
    raise exception 'Non-service migration owner bypassed cancellation runtime guard';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
