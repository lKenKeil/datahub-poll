-- comments.id is uuid in the production schema while
-- comment_reactions.comment_id is text. Cast the UUID explicitly so the
-- atomic delete function works with the existing, non-destructive schema.

create or replace function public.delete_poll_with_dependents(p_poll_id text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_image_paths jsonb;
begin
  if p_poll_id is null
    or btrim(p_poll_id) = ''
    or char_length(p_poll_id) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
  end if;

  select p.option_image_paths
    into current_image_paths
  from public.polls as p
  where p.id = p_poll_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;

  delete from public.comment_reactions as cr
  using public.comments as c
  where c.poll_id = p_poll_id
    and cr.comment_id = c.id::text;

  delete from public.comments as c
  where c.poll_id = p_poll_id;

  -- poll_votes and poll_ownership use ON DELETE CASCADE.
  delete from public.polls as p
  where p.id = p_poll_id;

  return current_image_paths;
end;
$$;

revoke all on function public.delete_poll_with_dependents(text)
from public, anon, authenticated;

grant execute on function public.delete_poll_with_dependents(text)
to service_role;

comment on function public.delete_poll_with_dependents(text) is
  'Service-only atomic poll deletion; returns Storage paths for post-commit cleanup.';
