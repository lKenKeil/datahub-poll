-- LOCAL DISPOSABLE DATABASE ONLY. Never run against Production, even with
-- ROLLBACK: sequence changes and external hooks are not transactionally restored.
-- Run as the isolated database owner, after removing only polls_full_access and
-- comments_full_access, with askio_test.legacy_policies=local-disposable.
-- This suite uses actual PostgreSQL roles, not mocked Supabase client responses.
-- It neither applies migrations nor changes the poll_votes schema. All fixture
-- rows, including fake Auth users, are rolled back. Concurrency is not covered.

begin;

do $$
begin
  if current_setting('askio_test.legacy_policies', true) is distinct from 'local-disposable'
    or (inet_server_addr() is not null and inet_server_addr()::text not in ('127.0.0.1', '::1')) then
    raise exception 'Refusing fixtures: enable explicitly on a local disposable database only.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and ((tablename = 'polls' and policyname = 'polls_full_access')
        or (tablename = 'comments' and policyname = 'comments_full_access'))
  ) then
    raise exception 'An exact legacy full-access policy remains';
  end if;
  if (select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('polls', 'comments')
        and c.relrowsecurity) <> 2 then
    raise exception 'RLS must remain enabled on both polls and comments';
  end if;
  if (select count(*) from pg_catalog.pg_policies p
      join (values
        ('polls', 'Public read polls', 'PERMISSIVE'),
        ('polls', 'Moderation public poll visibility', 'RESTRICTIVE'),
        ('comments', 'Public read comments', 'PERMISSIVE'),
        ('comments', 'Moderation public comment visibility', 'RESTRICTIVE')
      ) as expected(table_name, policy_name, policy_kind)
        on p.tablename = expected.table_name and p.policyname = expected.policy_name
          and p.permissive = expected.policy_kind
      where p.schemaname = 'public' and p.cmd = 'SELECT'
        and p.roles::text[] @> array['anon', 'authenticated']
        and p.qual is not null) <> 4 then
    raise exception 'The four existing public read/moderation policies must remain';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('polls', 'comments')
      and p.polcmd <> 'r'
      and (0::oid = any(p.polroles)
        or 'anon'::regrole::oid = any(p.polroles)
        or 'authenticated'::regrole::oid = any(p.polroles))
  ) then
    raise exception 'A public mutation or ALL policy remains on polls/comments';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles
                 where rolname = 'service_role' and rolbypassrls) then
    raise exception 'The existing service_role BYPASSRLS boundary must remain';
  end if;
end;
$$;

do $$
declare
  fixture_prefix text := 'legacy_policy_sql_test_' || gen_random_uuid()::text;
  own_user uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
begin
  perform set_config('askio_test.legacy_prefix', fixture_prefix, true);
  perform set_config('askio_test.legacy_own_user', own_user::text, true);
  perform set_config('askio_test.legacy_other_user', other_user::text, true);
  insert into auth.users (id, aud, role, email, is_anonymous)
  values
    (own_user, 'authenticated', 'authenticated', own_user::text || '@example.invalid', false),
    (other_user, 'authenticated', 'authenticated', other_user::text || '@example.invalid', false);
end;
$$;

set local role service_role;

do $$
declare
  fixture_prefix text := current_setting('askio_test.legacy_prefix');
  own_user uuid := current_setting('askio_test.legacy_own_user')::uuid;
  other_user uuid := current_setting('askio_test.legacy_other_user')::uuid;
  guest_root jsonb;
  account_reply jsonb;
  account_root jsonb;
  guest_reply jsonb;
  other_root jsonb;
  result jsonb;
  expected_poll jsonb;
  relation_name text;
  privilege_name text;
begin
  foreach relation_name in array array['public.polls', 'public.comments'] loop
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege(current_user, relation_name, privilege_name) then
        raise exception 'service_role lost % on %', privilege_name, relation_name;
      end if;
    end loop;
  end loop;

  perform public.create_owned_poll(
    fixture_prefix || '_guest', 'Guest policy fixture', '커뮤니티', '["A","B"]'::jsonb,
    '[0,0]'::jsonb, 0, null, null, repeat('a', 64), 'first_vote', null, null
  );
  perform public.create_owned_poll_with_author(
    fixture_prefix || '_own', 'Own account policy fixture', '커뮤니티', '["A","B"]'::jsonb,
    '[0,0]'::jsonb, 0, null, null, repeat('b', 64), 'first_vote', null, null, own_user, false
  );
  perform public.create_owned_poll_with_author(
    fixture_prefix || '_other', 'Other account policy fixture', '커뮤니티', '["A","B"]'::jsonb,
    '[0,0]'::jsonb, 0, null, null, repeat('c', 64), 'first_vote', null, null, other_user, false
  );
  select to_jsonb(p) into expected_poll from public.polls p
  where p.id = fixture_prefix || '_own';
  result := public.update_owned_poll(
    fixture_prefix || '_own', 'Edited account policy fixture', '커뮤니티', '["A","B"]'::jsonb,
    null, null, expected_poll
  );
  if result ->> 'title' is distinct from 'Edited account policy fixture'
    or result -> 'votes' is distinct from '[0,0]'::jsonb
    or result ->> 'participants' is distinct from '0' then
    raise exception 'Server owner edit path failed';
  end if;
  guest_root := public.create_comment_with_identity(
    fixture_prefix || '_guest', 'Guest root policy fixture', null, null, repeat('d', 64),
    true, '익명 하늘 11', null
  );
  account_reply := public.create_comment_with_identity(
    fixture_prefix || '_guest', 'Account reply policy fixture', guest_root ->> 'id', own_user,
    null, false, null, 'Account fixture'
  );
  account_root := public.create_comment_with_identity(
    fixture_prefix || '_own', 'Account root policy fixture', null, own_user,
    null, false, null, 'Account fixture'
  );
  guest_reply := public.create_comment_with_identity(
    fixture_prefix || '_own', 'Guest reply policy fixture', account_root ->> 'id', null,
    repeat('e', 64), true, '익명 바다 22', null
  );
  other_root := public.create_comment_with_identity(
    fixture_prefix || '_other', 'Other account root policy fixture', null, other_user,
    null, false, null, 'Other account fixture'
  );
  perform set_config('askio_test.legacy_guest_root', guest_root ->> 'id', true);
  perform set_config('askio_test.legacy_account_reply', account_reply ->> 'id', true);
  perform set_config('askio_test.legacy_account_root', account_root ->> 'id', true);
  perform set_config('askio_test.legacy_guest_reply', guest_reply ->> 'id', true);
  perform set_config('askio_test.legacy_other_root', other_root ->> 'id', true);

  if (select p.author_user_id from public.polls p where p.id = fixture_prefix || '_own')
      is distinct from own_user
    or (select c.user_id from public.comments c where c.id = (account_reply ->> 'id')::uuid)
      is distinct from own_user
    or (select c.guest_id_hash from public.comments c where c.id = (guest_root ->> 'id')::uuid)
      is distinct from repeat('d', 64)
    or account_reply ->> 'parent_id' is distinct from guest_root ->> 'id'
    or guest_reply ->> 'parent_id' is distinct from account_root ->> 'id' then
    raise exception 'Server account/guest authorship or reply links changed';
  end if;

  result := public.toggle_comment_reaction_with_actor(
    (guest_root ->> 'id')::uuid, 'account:' || own_user::text, 'like'
  );
  if result ->> 'likeCount' is distinct from '1' then raise exception 'Account reaction path failed'; end if;
  result := public.toggle_comment_reaction_with_actor(
    (guest_root ->> 'id')::uuid, 'guest:' || repeat('f', 64), 'dislike'
  );
  if result ->> 'dislikeCount' is distinct from '1' then raise exception 'Guest reaction path failed'; end if;
  perform public.submit_content_report('comment', guest_root ->> 'id', repeat('1', 64), 'spam', null);
  perform public.submit_content_report('poll', fixture_prefix || '_other', repeat('2', 64), 'privacy', null);
  perform public.moderate_report_target('comment', guest_root ->> 'id', 'hide');
  perform public.moderate_report_target('poll', fixture_prefix || '_other', 'hide');
end;
$$;

reset role;

-- SET LOCAL ROLE inside this invoker DO changes the executor's current role.
-- Every query below therefore checks real role privileges and RLS. JWT claims
-- identify own_user, while the other fixture belongs to a different account.
do $$
declare
  api_role text;
  fixture_prefix text := current_setting('askio_test.legacy_prefix');
  own_user text := current_setting('askio_test.legacy_own_user');
  guest_root text := current_setting('askio_test.legacy_guest_root');
  account_root text := current_setting('askio_test.legacy_account_root');
  other_root text := current_setting('askio_test.legacy_other_root');
  relation_name text;
  rpc record;
  attempt record;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', api_role);
    if current_user <> api_role then raise exception 'Role impersonation failed'; end if;
    perform set_config('request.jwt.claim.sub', case when api_role = 'authenticated' then own_user else '' end, true);
    perform set_config('request.jwt.claims',
      jsonb_build_object('role', api_role, 'sub', case when api_role = 'authenticated' then own_user else null end)::text, true);

    if (select count(p.id) from public.polls p
        where p.id in (fixture_prefix || '_guest', fixture_prefix || '_own')) <> 2 then
      raise exception '% cannot read visible questions', api_role;
    end if;
    if not exists (select c.id, c.text from public.comments c where c.id = account_root::uuid)
      or not exists (select c.id, c.parent_id, c.text from public.comments c
                     where c.id = current_setting('askio_test.legacy_guest_reply')::uuid)
      or not exists (select c.id, c.parent_id, c.text from public.comments c
                     where c.id = current_setting('askio_test.legacy_account_reply')::uuid) then
      raise exception '% cannot read visible account/guest comments or a reply to a hidden comment', api_role;
    end if;
    if exists (select c.id from public.comments c where c.id = guest_root::uuid)
      or exists (select p.id from public.polls p where p.id = fixture_prefix || '_other')
      or exists (select c.id from public.comments c where c.poll_id = fixture_prefix || '_other') then
      raise exception '% can read a hidden comment, hidden question or its comments', api_role;
    end if;

    foreach relation_name in array array['public.polls', 'public.comments'] loop
      if has_table_privilege(current_user, relation_name, 'INSERT')
        or has_table_privilege(current_user, relation_name, 'UPDATE')
        or has_table_privilege(current_user, relation_name, 'DELETE')
        or has_any_column_privilege(current_user, relation_name, 'INSERT')
        or has_any_column_privilege(current_user, relation_name, 'UPDATE') then
        raise exception '% has a raw mutation grant on %', api_role, relation_name;
      end if;
    end loop;
    for rpc in
      select p.oid, p.oid::regprocedure::text as signature
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(array[
        'create_owned_poll', 'create_owned_poll_with_author', 'create_comment_with_identity',
        'update_owned_poll', 'delete_comment_with_dependents', 'delete_poll_with_dependents',
        'submit_content_report', 'moderate_report_target', 'get_content_report_queue',
        'set_comment_reaction', 'toggle_comment_reaction_with_actor', 'ensure_user_profile',
        'increment_poll_vote', 'change_poll_vote',
        'cast_authenticated_poll_vote', 'change_authenticated_poll_vote', 'claim_authenticated_poll_vote',
        'cast_guest_poll_vote', 'change_guest_poll_vote', 'claim_guest_poll_vote'
      ])
    loop
      if has_function_privilege(current_user, rpc.oid, 'EXECUTE') then
        raise exception '% can execute private RPC %', api_role, rpc.signature;
      end if;
    end loop;

    for attempt in
      select * from (values
        ('poll author ID read', 'select author_user_id from public.polls'),
        ('comment account ID read', 'select user_id from public.comments'),
        ('comment guest hash read', 'select guest_id_hash from public.comments'),
        ('private report read', 'select id from public.content_reports'),
        ('raw poll insert', format('insert into public.polls(id,title,category,options,votes,participants) values(%L,''Raw fixture'',''커뮤니티'',''["A","B"]''::jsonb,''[0,0]''::jsonb,0)', fixture_prefix || '_raw')),
        ('raw own poll update', format('update public.polls set title=''Blocked'' where id=%L', fixture_prefix || '_own')),
        ('raw other poll update', format('update public.polls set is_hidden=false where id=%L', fixture_prefix || '_other')),
        ('raw own poll delete', format('delete from public.polls where id=%L', fixture_prefix || '_own')),
        ('raw other poll delete', format('delete from public.polls where id=%L', fixture_prefix || '_other')),
        ('raw comment insert', format('insert into public.comments(poll_id,text,user_name) values(%L,''Blocked'',''Raw fixture'')', fixture_prefix || '_own')),
        ('raw own comment update', format('update public.comments set text=''Blocked'' where id=%L::uuid', account_root)),
        ('raw other comment update', format('update public.comments set text=''Blocked'' where id=%L::uuid', other_root)),
        ('raw own comment delete', format('delete from public.comments where id=%L::uuid', account_root)),
        ('raw other comment delete', format('delete from public.comments where id=%L::uuid', other_root)),
        ('private comment RPC', 'select public.create_comment_with_identity(null::text,null::text,null::text,null::uuid,null::text,false,null::text,null::text)'),
        ('private poll RPC', 'select public.create_owned_poll(null::text,null::text,null::text,null::jsonb,null::jsonb,0,null::text,null::jsonb,null::text,null::text,null::integer,null::integer)'),
        ('private report RPC', 'select public.submit_content_report(null::text,null::text,null::text,null::text,null::text)'),
        ('private moderation RPC', 'select public.moderate_report_target(null::text,null::text,null::text)'),
        ('private deletion RPC', 'select public.delete_poll_with_dependents(null::text)')
      ) as denied(label, statement)
    loop
      begin
        execute attempt.statement;
        raise exception '% unexpectedly succeeded: %', api_role, attempt.label;
      exception when insufficient_privilege then null;
      end;
    end loop;
    execute 'reset role';
  end loop;
end;
$$;

set local role service_role;

do $$
declare
  fixture_prefix text := current_setting('askio_test.legacy_prefix');
  guest_root uuid := current_setting('askio_test.legacy_guest_root')::uuid;
  account_root uuid := current_setting('askio_test.legacy_account_root')::uuid;
  result jsonb;
begin
  -- BYPASSRLS server operations still see hidden targets for restore/delete.
  if not exists (select p.id from public.polls p where p.id = fixture_prefix || '_other' and p.is_hidden)
    or not exists (select c.id from public.comments c where c.id = guest_root and c.is_hidden) then
    raise exception 'service_role cannot read hidden moderation targets';
  end if;
  perform public.moderate_report_target('comment', guest_root::text, 'restore');
  perform public.moderate_report_target('poll', fixture_prefix || '_other', 'restore');
  if exists (select p.id from public.polls p where p.id = fixture_prefix || '_other' and p.is_hidden)
    or exists (select c.id from public.comments c where c.id = guest_root and c.is_hidden) then
    raise exception 'Server restore path failed';
  end if;
  result := public.delete_comment_with_dependents(guest_root);
  if (result ->> 'deleted_count')::integer is distinct from 2 then
    raise exception 'Guest root/account reply subtree deletion failed';
  end if;
  result := public.delete_comment_with_dependents(account_root);
  if (result ->> 'deleted_count')::integer is distinct from 2 then
    raise exception 'Account root/guest reply subtree deletion failed';
  end if;
  perform public.delete_poll_with_dependents(fixture_prefix || '_guest');
  perform public.delete_poll_with_dependents(fixture_prefix || '_own');
  perform public.delete_poll_with_dependents(fixture_prefix || '_other');
  if exists (select p.id from public.polls p where p.id like fixture_prefix || '%')
    or exists (select c.id from public.comments c where c.poll_id like fixture_prefix || '%')
    or exists (select o.poll_id from public.poll_ownership o where o.poll_id like fixture_prefix || '%')
    or exists (select r.id from public.comment_reactions r
               where r.comment_id = guest_root::text) then
    raise exception 'Server deletion left fixture content/ownership/reactions';
  end if;
  if (select count(*) from public.content_reports r where r.poll_id like fixture_prefix || '%') <> 2
    or exists (select r.id from public.content_reports r
               where r.poll_id like fixture_prefix || '%' and r.status = 'pending') then
    raise exception 'Private report history did not survive server deletion';
  end if;
  raise notice 'PASS legacy policy absence, retained RLS/read policies, role reads, identity privacy, raw mutation/RPC denial, guest/account server paths, report/hide/restore/delete';
end;
$$;

reset role;
rollback;
