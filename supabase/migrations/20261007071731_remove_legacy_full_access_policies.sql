-- Production audit confirmed both legacy policies are PERMISSIVE, FOR ALL,
-- TO PUBLIC, USING (true), WITH CHECK (true). They are not needed by the
-- dedicated visible SELECT policies or the service_role BYPASSRLS RPC paths.
-- Keep all moderation SELECT restrictions, column grants and RPC ACLs intact.
-- This migration changes no data and grants no additional access.

drop policy if exists polls_full_access on public.polls;
drop policy if exists comments_full_access on public.comments;
