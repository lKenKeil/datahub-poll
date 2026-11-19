-- Read-only gate for staging after the reviewed app baseline and Storage.
-- This checks selected dependencies; review actual SQL bodies/ACLs separately.
begin read only;
set local statement_timeout = '15s';
do $$
declare
  item text;
  relation_oid regclass;
  function_oid regprocedure;
begin
  foreach item in array array[
    'public.polls', 'public.comments', 'public.poll_votes', 'public.poll_ownership',
    'public.profiles', 'public.comment_reactions', 'public.content_reports',
    'public.deleted_official_polls', 'public.official_sources', 'public.official_statistics'
  ] loop
    relation_oid := to_regclass(item);
    if relation_oid is null then raise exception 'Missing baseline relation: %', item; end if;
    if not (select relrowsecurity from pg_class where oid = relation_oid) then
      raise exception 'RLS disabled for %', item;
    end if;
  end loop;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.polls'::regclass and attname = 'author_user_id'
      and atttypid = 'uuid'::regtype and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.poll_ownership'::regclass and attname = 'owner_token_hash'
      and atttypid = 'text'::regtype and attnotnull and not attisdropped
  ) then
    raise exception 'Required authorship or pre-migration token column differs.';
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid
      and c.conkey = array[a.attnum] and a.attname = 'author_user_id'
    where c.contype = 'f' and c.conrelid = 'public.polls'::regclass
      and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'n' and c.convalidated
      and c.confkey = array[(
        select attnum from pg_attribute where attrelid = c.confrelid and attname = 'id'
      )]
  ) or not exists (
    select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid
      and c.conkey = array[a.attnum] and a.attname = 'poll_id'
    where c.contype = 'f' and c.conrelid = 'public.poll_ownership'::regclass
      and c.confrelid = 'public.polls'::regclass and c.confdeltype = 'c' and c.convalidated
      and c.confkey = array[(
        select attnum from pg_attribute where attrelid = c.confrelid and attname = 'id'
      )]
  ) then
    raise exception 'Unexpected authorship or ownership foreign key.';
  end if;

  if not has_schema_privilege('service_role', 'askio_private', 'USAGE')
    or not has_column_privilege('service_role', 'public.polls', 'author_user_id', 'SELECT')
    or not has_table_privilege('service_role', 'public.poll_ownership', 'SELECT')
    or not has_column_privilege('service_role', 'public.poll_ownership', 'owner_token_hash', 'UPDATE')
    or has_column_privilege('anon', 'public.polls', 'author_user_id', 'SELECT, INSERT, UPDATE')
    or has_column_privilege('authenticated', 'public.polls', 'author_user_id', 'SELECT, INSERT, UPDATE')
    or has_any_column_privilege('anon', 'public.poll_ownership', 'SELECT, INSERT, UPDATE')
    or has_any_column_privilege('authenticated', 'public.poll_ownership', 'SELECT, INSERT, UPDATE')
    or has_table_privilege('anon', 'public.poll_ownership', 'DELETE')
    or has_table_privilege('authenticated', 'public.poll_ownership', 'DELETE')
    or has_any_column_privilege('anon', 'public.comment_reactions', 'SELECT')
    or has_any_column_privilege('authenticated', 'public.comment_reactions', 'SELECT') then
    raise exception 'Private authorship, ownership or reaction privilege mismatch.';
  end if;

  foreach item in array array[
    'public.create_owned_poll_with_author(text,text,text,jsonb,jsonb,integer,text,jsonb,text,text,integer,integer,uuid,boolean)',
    'public.update_owned_poll(text,text,text,jsonb,text,jsonb,jsonb)',
    'public.delete_poll_with_dependents(text)',
    'public.cast_guest_poll_vote(text,integer,text)',
    'public.cast_authenticated_poll_vote(text,integer,uuid,text)',
    'public.claim_authenticated_poll_vote(text,text,uuid,text)',
    'public.claim_guest_poll_vote(text,text,text)',
    'public.ensure_user_profile(uuid)',
    'public.recommend_user_profile_nickname(uuid)',
    'public.change_profile_avatar(uuid,text,text,text,text)',
    'public.create_comment_with_identity(text,text,text,uuid,text,boolean,text,text)',
    'public.toggle_comment_reaction_with_actor(uuid,text,text)',
    'public.change_managed_poll_vote(text,integer,uuid,text,bigint)',
    'public.cancel_managed_poll_vote(text,uuid,text,bigint)'
  ] loop
    function_oid := to_regprocedure(item);
    if function_oid is null then raise exception 'Missing RPC: %', item; end if;
    if not has_function_privilege('service_role', function_oid, 'EXECUTE')
      or has_function_privilege('anon', function_oid, 'EXECUTE')
      or has_function_privilege('authenticated', function_oid, 'EXECUTE') then
      raise exception 'RPC execution privilege mismatch: %', item;
    end if;
  end loop;

  if exists (
    select 1
    from (values
      ('auth.users'::regclass, 'askio_create_profile_after_signup'),
      ('public.comments'::regclass, 'comments_anonymous_name_before_write'),
      ('public.comments'::regclass, 'comments_lock_poll_before_write'),
      ('public.profiles'::regclass, 'profiles_normalize_before_write')
    ) as expected(relation_oid, trigger_name)
    where not exists (
      select 1 from pg_trigger t
      where t.tgrelid = expected.relation_oid and t.tgname = expected.trigger_name
        and not t.tgisinternal and t.tgenabled in ('O','A')
    )
  ) then raise exception 'An expected ASKIO trigger is missing or disabled.'; end if;

  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables
  ) or (
    select array_agg(format('%I.%I', schemaname, tablename) order by schemaname, tablename)
    from pg_publication_tables where pubname = 'supabase_realtime'
  ) is distinct from array['public.comment_reactions','public.comments','public.polls']::text[]
  then raise exception 'Realtime publication differs from the reported production membership.'; end if;

  if to_regclass('public.official_poll_publishers') is not null
    or to_regprocedure('public.create_poll_with_management(text,text,text,jsonb,jsonb,integer,text,jsonb,text,text,integer,integer,uuid,boolean)') is not null
    or to_regprocedure('askio_private.prevent_poll_token_restore()') is not null
    or to_regprocedure('askio_private.protect_official_poll_ownership()') is not null
    or exists (
      select 1 from pg_trigger
      where (tgrelid = 'public.polls'::regclass and tgname = 'protect_official_poll_ownership')
         or (tgrelid = 'public.poll_ownership'::regclass and tgname = 'prevent_poll_token_restore')
    ) then raise exception 'Official objects already present, check drift before applying.'; end if;
end $$;

-- Compare body manually. It must insert poll and token hash before updating
-- polls.author_user_id, which is the event that invokes the new trigger.
select pg_get_functiondef(
  'public.create_owned_poll_with_author(text,text,text,jsonb,jsonb,integer,text,jsonb,text,text,integer,integer,uuid,boolean)'::regprocedure
) as create_authorship_sql;
rollback;
