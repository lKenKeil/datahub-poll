-- update_owned_poll remains SECURITY INVOKER and deletes per-voter rows when
-- an allowed structural edit resets positional vote data. Keep public roles
-- read/write-blocked and grant only the missing table privilege to the server.

revoke delete on table public.poll_votes
from public, anon, authenticated;

grant delete on table public.poll_votes
to service_role;

