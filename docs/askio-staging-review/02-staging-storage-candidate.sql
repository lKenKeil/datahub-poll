-- Read-only staging Storage gate. The original review draft proposed
-- additional policies. This version checks observed bucket configuration
-- and exports policy definitions for comparison without changing policies.
-- Run after approved empty buckets are created via staging Dashboard/API.
begin read only;
set local statement_timeout = '15s';

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'poll-option-images' and name = id and public and file_size_limit = 2097152
      and allowed_mime_types @> array['image/jpeg','image/png','image/webp']::text[]
      and allowed_mime_types <@ array['image/jpeg','image/png','image/webp']::text[]
  ) or not exists (
    select 1 from storage.buckets
    where id = 'profile-avatars' and name = id and public and file_size_limit = 2097152
      and allowed_mime_types = array['image/webp']::text[]
  ) then
    raise exception 'Staging bucket definitions differ from the reviewed configuration.';
  end if;
  if not exists (select 1 from pg_class where oid = 'storage.objects'::regclass and relrowsecurity) then
    raise exception 'Managed Storage objects RLS is required.';
  end if;
end $$;

-- Review applicable rules and ACLs against the actual production export.
-- Bucket options alone do not establish direct object or public URL access.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'storage' and tablename = 'objects'
order by policyname;
select c.relname, c.relacl, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
where c.oid in ('storage.objects'::regclass, 'storage.buckets'::regclass)
order by c.relname;
rollback;
