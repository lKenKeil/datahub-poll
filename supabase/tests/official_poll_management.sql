-- LOCAL DISPOSABLE DATABASE ONLY. Apply the authorship, ownership and
-- official-publisher migrations first, then run as the local database owner:
-- PGOPTIONS='-c askio_test.official_poll_management=local-disposable' psql -X \
--   -v ON_ERROR_STOP=1 -f supabase/tests/official_poll_management.sql <local URL>

begin;
do $$
begin
  if current_setting('askio_test.official_poll_management', true) is distinct from 'local-disposable'
    or (inet_server_addr() is not null and host(inet_server_addr()) not in ('127.0.0.1', '::1')) then
    raise exception 'Refusing fixtures: enable explicitly on a local disposable database only.';
  end if;
end;
$$;

do $$
declare
  ordinary_user uuid := gen_random_uuid();
  publisher_user uuid := gen_random_uuid();
  inactive_user uuid := gen_random_uuid();
  fixture_prefix text := 'official_management_test_' || gen_random_uuid()::text;
  ordinary_poll text := fixture_prefix || '_ordinary';
  existing_poll text := fixture_prefix || '_existing';
  official_poll text := fixture_prefix || '_official';
  legacy_rpc_poll text := fixture_prefix || '_legacy_rpc';
  inactive_poll text := fixture_prefix || '_inactive';
  ordinary_hash text := md5(ordinary_poll) || md5(ordinary_poll);
  existing_hash text := md5(existing_poll) || md5(existing_poll);
  official_hash text := md5(official_poll) || md5(official_poll);
  legacy_rpc_hash text := md5(legacy_rpc_poll) || md5(legacy_rpc_poll);
  account_managed boolean;
  public_role text;
begin
  insert into auth.users (id, aud, role, email, is_anonymous)
  select id, 'authenticated', 'authenticated', id::text || '@example.invalid', false
  from unnest(array[ordinary_user, publisher_user, inactive_user]) as users(id);

  set local role service_role;
  account_managed := public.create_poll_with_management(
    ordinary_poll, 'Ordinary poll fixture', '커뮤니티', '["A","B"]', '[0,0]', 0,
    null, null, ordinary_hash, 'first_vote', null, null, ordinary_user, false
  );
  if account_managed is distinct from false or not exists (
    select 1 from public.poll_ownership where poll_id = ordinary_poll and owner_token_hash = ordinary_hash
  ) then
    raise exception 'Ordinary creation must preserve its browser token hash.';
  end if;
  perform public.create_owned_poll_with_author(
    existing_poll, 'Existing poll fixture', '커뮤니티', '["A","B"]', '[0,0]', 0,
    null, null, existing_hash, 'first_vote', null, null, publisher_user, false
  );
  reset role;

  insert into public.official_poll_publishers (user_id, active)
  values (publisher_user, true), (inactive_user, false);

  set local role service_role;
  if not exists (
    select 1 from public.poll_ownership where poll_id = existing_poll and owner_token_hash = existing_hash
  ) then
    raise exception 'Publisher registration must leave existing ownership intact.';
  end if;
  account_managed := public.create_poll_with_management(
    official_poll, 'Official poll fixture', '커뮤니티', '["A","B"]', '[0,0]', 0,
    null, null, official_hash, 'first_vote', null, null, publisher_user, false
  );
  if account_managed is distinct from true or not exists (
    select 1 from public.poll_ownership where poll_id = official_poll and owner_token_hash is null
  ) then
    raise exception 'Active official creation must use account management.';
  end if;
  perform public.create_owned_poll_with_author(
    legacy_rpc_poll, 'Legacy RPC fixture', '커뮤니티', '["A","B"]', '[0,0]', 0,
    null, null, legacy_rpc_hash, 'first_vote', null, null, publisher_user, true
  );
  if not exists (
    select 1
    from public.polls p join public.poll_ownership o on o.poll_id = p.id
    where p.id = legacy_rpc_poll and p.is_anonymous and o.owner_token_hash is null
  ) then
    raise exception 'The legacy creation RPC must respect account management and anonymity.';
  end if;
  begin
    perform public.create_poll_with_management(
      inactive_poll, 'Inactive publisher fixture', '커뮤니티', '["A","B"]', '[0,0]', 0,
      null, null, legacy_rpc_hash, 'first_vote', null, null, inactive_user, false
    );
    raise exception 'Inactive publisher creation was accepted.';
  exception when insufficient_privilege then
    if sqlerrm <> 'OFFICIAL_PUBLISHER_INACTIVE' then raise; end if;
  end;
  if exists (select 1 from public.polls where id = inactive_poll)
    or exists (select 1 from public.poll_ownership where poll_id = inactive_poll) then
    raise exception 'Rejected creation must leave no poll or ownership row.';
  end if;
  begin
    update public.poll_ownership set owner_token_hash = official_hash where poll_id = official_poll;
    raise exception 'Account-managed ownership accepted a browser token.';
  exception when check_violation then
    if sqlerrm <> 'ACCOUNT_MANAGED_POLL_CANNOT_RESTORE_TOKEN' then raise; end if;
  end;
  reset role;

  foreach public_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(public_role, 'public.official_poll_publishers', 'SELECT, INSERT, UPDATE, DELETE')
      or has_table_privilege(public_role, 'public.poll_ownership', 'SELECT, INSERT, UPDATE, DELETE')
      or has_column_privilege(public_role, 'public.polls', 'author_user_id', 'SELECT, INSERT, UPDATE')
      or has_function_privilege(public_role,
        'public.create_poll_with_management(text,text,text,jsonb,jsonb,integer,text,jsonb,text,text,integer,integer,uuid,boolean)',
        'EXECUTE')
      or has_function_privilege(public_role,
        'public.create_owned_poll_with_author(text,text,text,jsonb,jsonb,integer,text,jsonb,text,text,integer,integer,uuid,boolean)',
        'EXECUTE') then
      raise exception 'Public origin role % has a private ownership privilege.', public_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.official_poll_publishers', 'INSERT, UPDATE, DELETE') then
    raise exception 'The application service role can modify official registration.';
  end if;

  delete from auth.users where id = publisher_user;
  if exists (select 1 from public.official_poll_publishers where user_id = publisher_user)
    or not exists (
      select 1
      from public.polls p join public.poll_ownership o on o.poll_id = p.id
      where p.id = official_poll and p.author_user_id is null and o.owner_token_hash is null
    ) then
    raise exception 'Deleting the publisher must remove registration without restoring token access.';
  end if;
end;
$$;

rollback;
