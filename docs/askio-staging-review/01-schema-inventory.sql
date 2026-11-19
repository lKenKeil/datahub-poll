-- Read-only catalog inventory. Run via an authorized SQL connection in each
-- target separately, confirm the project in Dashboard/connection metadata.
-- Outputs schema and bucket configuration only. It does not read app/Auth rows.
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select current_setting('server_version') as postgresql_version,
       to_regclass('supabase_migrations.schema_migrations') as migration_registry;
-- If the registry exists, separately run this inside a read-only transaction:
-- select version from supabase_migrations.schema_migrations order by version;
-- Deliberately exclude "statements" and don't infer state from registry alone.

select n.nspname as schema_name, c.relname as relation, c.relkind,
       pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity,
       c.relacl, c.relreplident
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'askio_private') and c.relkind in ('r','p','v','m','S')
order by 1, 2;

select n.nspname as schema_name, c.relname as relation, a.attname as column_name,
       format_type(a.atttypid, a.atttypmod) as data_type, a.attnotnull, a.attidentity,
       a.attgenerated, a.attacl, pg_get_expr(d.adbin, d.adrelid) as default_sql
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname in ('public', 'askio_private') and c.relkind in ('r','p','v','m')
  and a.attnum > 0 and not a.attisdropped
order by 1, 2, a.attnum;

select n.nspname, c.relname, con.conname, con.convalidated,
       pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'askio_private')
order by 1, 2, 3;

select schemaname, tablename, indexname, indexdef from pg_indexes
where schemaname in ('public', 'askio_private')
order by 1, 2, 3;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result, p.prosecdef, p.proconfig, p.proacl,
       pg_get_userbyid(p.proowner) as owner,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'askio_private') and p.prokind in ('f', 'p')
  and not exists (
    select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
      and d.objid = p.oid and d.deptype = 'e'
  )
order by 1, 2, 3;
-- Function bodies live in separately reviewed schema-only DDL, never app rows.

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'askio_private')
   or (schemaname = 'storage' and tablename = 'objects')
order by 1, 2, 3;

select n.nspname, c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid, true)
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal
  and (n.nspname in ('public', 'askio_private')
    or (n.nspname = 'auth' and c.relname = 'users' and pn.nspname in ('public','askio_private')))
order by 1, 2, 3;

select pubname, puballtables from pg_publication where pubname = 'supabase_realtime';
select pubname, schemaname, tablename, attnames, rowfilter from pg_publication_tables
where pubname = 'supabase_realtime' order by 2, 3;

select name, public, file_size_limit, allowed_mime_types from storage.buckets
where name in ('poll-option-images', 'profile-avatars') order by name;
select rolname, rolbypassrls from pg_roles
where rolname in ('anon','authenticated','service_role') order by rolname;
select nspname, nspacl, pg_get_userbyid(nspowner) as owner
from pg_namespace where nspname in ('public','askio_private') order by nspname;
select e.extname, e.extversion, n.nspname as schema_name
from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by e.extname;
select pg_get_userbyid(defaclrole) as owner, n.nspname, defaclobjtype, defaclacl
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname in ('public','askio_private') or n.nspname is null
order by 1, 2, 3;
rollback;
