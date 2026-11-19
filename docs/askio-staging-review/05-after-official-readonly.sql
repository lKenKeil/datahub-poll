-- Read-only post-apply staging checks. No records or account IDs are returned.
begin read only;
set local statement_timeout = '15s';
do $$
declare
  rpc regprocedure := to_regprocedure('public.create_poll_with_management(text,text,text,jsonb,jsonb,integer,text,jsonb,text,text,integer,integer,uuid,boolean)');
begin
  if rpc is null or not has_function_privilege('service_role', rpc, 'EXECUTE')
    or has_function_privilege('anon', rpc, 'EXECUTE')
    or has_function_privilege('authenticated', rpc, 'EXECUTE')
    or exists (select 1 from pg_proc where oid = rpc and prosecdef) then
    raise exception 'Official creation RPC is not a service-only invoker.';
  end if;
  if not exists (
    select 1 from pg_class where oid = 'public.official_poll_publishers'::regclass and relrowsecurity
  ) or has_table_privilege('anon', 'public.official_poll_publishers', 'SELECT, INSERT, UPDATE, DELETE')
    or has_table_privilege('authenticated', 'public.official_poll_publishers', 'SELECT, INSERT, UPDATE, DELETE')
    or not has_table_privilege('service_role', 'public.official_poll_publishers', 'SELECT')
    or has_table_privilege('service_role', 'public.official_poll_publishers', 'INSERT, UPDATE, DELETE') then
    raise exception 'Official publisher privilege mismatch.';
  end if;
  if not exists (
    select 1 from pg_attribute where attrelid = 'public.poll_ownership'::regclass
      and attname = 'owner_token_hash' and not attnotnull and not attisdropped
  ) or not exists (
    select 1 from pg_trigger where tgrelid = 'public.polls'::regclass
      and tgname = 'protect_official_poll_ownership' and tgenabled in ('O','A')
  ) or not exists (
    select 1 from pg_trigger where tgrelid = 'public.poll_ownership'::regclass
      and tgname = 'prevent_poll_token_restore' and tgenabled in ('O','A')
  ) then raise exception 'Official ownership trigger or hash shape mismatch.'; end if;
  if exists (select 1 from public.official_poll_publishers) then
    raise exception 'Official migration is expected to leave the registry empty before enrollment.';
  end if;
  if exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'official_poll_publishers'
  ) then raise exception 'Private official registry is in Realtime.'; end if;
end $$;
select 'Official ownership catalog checks passed' as result;
rollback;
