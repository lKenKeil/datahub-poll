-- Review-only catalog export for a confirmed project and authorized connection.
-- Save the result grid as CSV or JSON. Each result row describes one catalog
-- object. This is baseline evidence, not a script to restore.
-- Review function bodies and expressions for embedded private settings before
-- sharing. This query does not read business, Auth, Storage or sequence rows.
begin isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
set local search_path = pg_catalog;

with
app_schemas as (
  select oid, nspname, nspowner, nspacl
  from pg_namespace
  where nspname in ('public', 'askio_private')
),
api_roles as (
  select oid, rolname, rolsuper, rolinherit, rolbypassrls, rolcanlogin
  from pg_roles
  where rolname in ('anon', 'authenticated', 'service_role')
),
app_relations as (
  select c.*, n.nspname
  from pg_class c
  join app_schemas n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S')
    and not exists (
      select from pg_depend d where d.classid = 'pg_class'::regclass
        and d.objid = c.oid and d.deptype = 'e'
    )
),
app_routines as (
  select p.*, n.nspname, pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_proc p
  join app_schemas n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and not exists (
      select from pg_depend d where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid and d.deptype = 'e'
    )
),
catalog_export as (
  select 'server' as object_kind, '' as schema_name,
    'postgresql' as object_name, '' as part,
    jsonb_build_object(
      'server_version', current_setting('server_version'),
      'application_schemas', (select jsonb_agg(nspname order by nspname) from app_schemas),
      'migration_registry_exists', to_regclass('supabase_migrations.schema_migrations') is not null
    ) as details

  union all
  select 'schema', s.nspname, s.nspname, '',
    jsonb_build_object(
      'owner', pg_get_userbyid(s.nspowner), 'acl', s.nspacl,
      'api_privileges', (select jsonb_object_agg(r.rolname, jsonb_build_object(
        'usage', has_schema_privilege(r.oid, s.oid, 'USAGE'),
        'create', has_schema_privilege(r.oid, s.oid, 'CREATE')
      )) from api_roles r)
    )
  from app_schemas s

  union all
  select 'relation', c.nspname, c.relname, '',
    jsonb_build_object(
      'kind', c.relkind, 'owner', pg_get_userbyid(c.relowner), 'acl', c.relacl,
      'persistence', c.relpersistence, 'options', c.reloptions,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'replica_identity', c.relreplident, 'partition', c.relispartition,
      'partition_key', case when c.relkind = 'p' then pg_get_partkeydef(c.oid) end,
      'partition_bound', pg_get_expr(c.relpartbound, c.oid),
      'parents', (select jsonb_agg(format('%I.%I', pn.nspname, parent.relname) order by i.inhseqno)
        from pg_inherits i join pg_class parent on parent.oid = i.inhparent
        join pg_namespace pn on pn.oid = parent.relnamespace where i.inhrelid = c.oid),
      'view_query', case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, false) end,
      'api_privileges', (select jsonb_object_agg(r.rolname,
        case when c.relkind = 'S' then jsonb_build_object(
          'usage', has_sequence_privilege(r.oid, c.oid, 'USAGE'),
          'select', has_sequence_privilege(r.oid, c.oid, 'SELECT'),
          'update', has_sequence_privilege(r.oid, c.oid, 'UPDATE')
        ) else jsonb_build_object(
          'select', has_table_privilege(r.oid, c.oid, 'SELECT'),
          'insert', has_table_privilege(r.oid, c.oid, 'INSERT'),
          'update', has_table_privilege(r.oid, c.oid, 'UPDATE'),
          'delete', has_table_privilege(r.oid, c.oid, 'DELETE'),
          'truncate', has_table_privilege(r.oid, c.oid, 'TRUNCATE'),
          'references', has_table_privilege(r.oid, c.oid, 'REFERENCES'),
          'trigger', has_table_privilege(r.oid, c.oid, 'TRIGGER')
        ) end) from api_roles r)
    )
  from app_relations c

  union all
  select 'column', c.nspname, c.relname, a.attname,
    jsonb_build_object(
      'position', a.attnum, 'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
      'default_or_generation_sql', pg_get_expr(d.adbin, d.adrelid), 'acl', a.attacl,
      'collation', case when col.oid is not null then format('%I.%I', cn.nspname, col.collname) end,
      'api_privileges', (select jsonb_object_agg(r.rolname, jsonb_build_object(
        'select', has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT'),
        'insert', has_column_privilege(r.oid, c.oid, a.attnum, 'INSERT'),
        'update', has_column_privilege(r.oid, c.oid, a.attnum, 'UPDATE'),
        'references', has_column_privilege(r.oid, c.oid, a.attnum, 'REFERENCES')
      )) from api_roles r)
    )
  from app_relations c
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  left join pg_collation col on col.oid = a.attcollation
  left join pg_namespace cn on cn.oid = col.collnamespace
  where c.relkind <> 'S'

  union all
  select 'constraint', c.nspname, c.relname, k.conname,
    jsonb_build_object(
      'definition', pg_get_constraintdef(k.oid, false), 'kind', k.contype,
      'validated', k.convalidated, 'deferrable', k.condeferrable,
      'initially_deferred', k.condeferred, 'local', k.conislocal
    )
  from app_relations c join pg_constraint k on k.conrelid = c.oid

  union all
  select 'index', c.nspname, c.relname, i.relname,
    jsonb_build_object(
      'definition', pg_get_indexdef(i.oid), 'valid', x.indisvalid, 'ready', x.indisready,
      'primary', x.indisprimary, 'unique', x.indisunique, 'replica_identity', x.indisreplident,
      'constraint', (select k.conname from pg_constraint k
        where k.conindid = i.oid and k.conrelid = c.oid and k.contype in ('p', 'u', 'x') limit 1)
    )
  from app_relations c join pg_index x on x.indrelid = c.oid
  join pg_class i on i.oid = x.indexrelid

  union all
  select 'sequence', c.nspname, c.relname, '',
    jsonb_build_object(
      'data_type', format_type(s.seqtypid, null), 'start', s.seqstart,
      'increment', s.seqincrement, 'min', s.seqmin, 'max', s.seqmax,
      'cache', s.seqcache, 'cycle', s.seqcycle, 'ownership_kind', d.deptype,
      'owned_by', case when a.attname is not null then format('%I.%I.%I', tn.nspname, t.relname, a.attname) end
    )
  from app_relations c join pg_sequence s on s.seqrelid = c.oid
  left join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = c.oid
    and d.objsubid = 0 and d.refclassid = 'pg_class'::regclass and d.refobjsubid > 0
    and d.deptype in ('a', 'i')
  left join pg_class t on t.oid = d.refobjid
  left join pg_namespace tn on tn.oid = t.relnamespace
  left join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid

  union all
  select 'type', n.nspname, t.typname, '',
    jsonb_build_object(
      'kind', t.typtype, 'owner', pg_get_userbyid(t.typowner), 'acl', t.typacl,
      'enum_labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid),
      'domain_base_type', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
      'domain_not_null', t.typnotnull, 'domain_default', pg_get_expr(t.typdefaultbin, 0),
      'domain_constraints', (select jsonb_object_agg(k.conname, jsonb_build_object(
        'definition', pg_get_constraintdef(k.oid, false), 'validated', k.convalidated
      )) from pg_constraint k where k.contypid = t.oid)
    )
  from pg_type t join app_schemas n on n.oid = t.typnamespace
  where t.typtype in ('d', 'e')
    and not exists (select from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')

  union all
  select 'routine', p.nspname, p.proname, p.identity_arguments,
    jsonb_build_object(
      'definition', pg_get_functiondef(p.oid),
      'result', pg_get_function_result(p.oid), 'kind', p.prokind,
      'owner', pg_get_userbyid(p.proowner), 'acl', p.proacl,
      'security_definer', p.prosecdef, 'runtime_settings', p.proconfig,
      'api_execute', (select jsonb_object_agg(r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE')) from api_roles r)
    )
  from app_routines p

  union all
  select 'trigger', n.nspname, c.relname, t.tgname,
    jsonb_build_object('definition', pg_get_triggerdef(t.oid, false), 'enabled', t.tgenabled)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and (
    exists (select 1 from app_relations a where a.oid = c.oid)
    or (n.nspname = 'auth' and c.relname = 'users' and exists (
      select 1 from app_routines p where p.oid = t.tgfoid
    ))
  )

  union all
  select 'policy', n.nspname, c.relname, p.polname,
    jsonb_build_object(
      'permissive', p.polpermissive, 'command', p.polcmd,
      'roles', (select jsonb_agg(case when r.oid = 0 then 'PUBLIC' else pg_get_userbyid(r.oid)::text end order by r.ordinality)
        from unnest(p.polroles) with ordinality r(oid, ordinality)),
      'using', pg_get_expr(p.polqual, p.polrelid), 'with_check', pg_get_expr(p.polwithcheck, p.polrelid)
    )
  from pg_policy p join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where exists (select 1 from app_relations a where a.oid = c.oid)
    or (n.nspname = 'storage' and c.relname = 'objects')

  union all
  select 'publication', '', p.pubname, '',
    jsonb_build_object(
      'owner', pg_get_userbyid(p.pubowner), 'all_tables', p.puballtables,
      'insert', p.pubinsert, 'update', p.pubupdate, 'delete', p.pubdelete,
      'truncate', p.pubtruncate, 'via_partition_root', p.pubviaroot
    )
  from pg_publication p
  where p.pubname = 'supabase_realtime'
    or exists (select 1 from pg_publication_tables pt join app_schemas s on s.nspname = pt.schemaname
      where pt.pubname = p.pubname)

  union all
  select 'publication_membership', t.schemaname, t.tablename, t.pubname,
    jsonb_build_object('columns', t.attnames, 'row_filter', t.rowfilter)
  from pg_publication_tables t
  where exists (select 1 from app_relations c where c.nspname = t.schemaname and c.relname = t.tablename)

  union all
  select 'role', '', r.rolname, '',
    jsonb_build_object(
      'superuser', r.rolsuper, 'inherit', r.rolinherit, 'bypass_rls', r.rolbypassrls, 'can_login', r.rolcanlogin,
      'direct_memberships', (select jsonb_agg(jsonb_build_object(
        'role', pg_get_userbyid(m.roleid), 'admin_option', m.admin_option,
        'inherit_option', to_jsonb(m)->'inherit_option', 'set_option', to_jsonb(m)->'set_option'
      ) order by pg_get_userbyid(m.roleid)) from pg_auth_members m where m.member = r.oid)
    )
  from api_roles r

  union all
  select 'default_acl', coalesce(s.nspname, ''), pg_get_userbyid(d.defaclrole), d.defaclobjtype::text,
    jsonb_build_object('acl', d.defaclacl)
  from pg_default_acl d left join app_schemas s on s.oid = d.defaclnamespace
  where d.defaclnamespace = 0 or s.oid is not null

  union all
  select 'extension', n.nspname, e.extname, '',
    jsonb_build_object('version', e.extversion, 'relocatable', e.extrelocatable)
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
)
select object_kind, schema_name, object_name, part, details
from catalog_export
order by object_kind, schema_name, object_name,
  case when object_kind = 'column' then (details->>'position')::integer end, part;

rollback;
