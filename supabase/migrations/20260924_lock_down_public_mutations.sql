-- Public clients may read community data, but all writes must pass through a
-- server Route Handler that uses the service_role key.

alter table public.polls enable row level security;
alter table public.comments enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.official_sources enable row level security;
alter table public.official_statistics enable row level security;

drop policy if exists "Public insert polls" on public.polls;
drop policy if exists "Public update polls" on public.polls;
drop policy if exists "Public insert comments" on public.comments;
drop policy if exists "Public insert comment reactions" on public.comment_reactions;
drop policy if exists "Public update comment reactions" on public.comment_reactions;
drop policy if exists "Public delete comment reactions" on public.comment_reactions;

drop policy if exists "Public read polls" on public.polls;
create policy "Public read polls"
on public.polls
for select
to anon, authenticated
using (true);

drop policy if exists "Public read comments" on public.comments;
create policy "Public read comments"
on public.comments
for select
to anon, authenticated
using (true);

drop policy if exists "Public read comment reactions" on public.comment_reactions;
create policy "Public read comment reactions"
on public.comment_reactions
for select
to anon, authenticated
using (true);

drop policy if exists "Public read official_sources" on public.official_sources;
create policy "Public read official_sources"
on public.official_sources
for select
to anon, authenticated
using (true);

drop policy if exists "Public read official_statistics" on public.official_statistics;
create policy "Public read official_statistics"
on public.official_statistics
for select
to anon, authenticated
using (true);

grant usage on schema public to anon, authenticated, service_role;

revoke all privileges on table
  public.polls,
  public.comments,
  public.comment_reactions,
  public.official_sources,
  public.official_statistics
from public, anon, authenticated;

grant select on table
  public.polls,
  public.comments,
  public.comment_reactions,
  public.official_sources,
  public.official_statistics
to anon, authenticated;

grant select, insert, update, delete on table
  public.polls,
  public.comments,
  public.comment_reactions,
  public.official_sources,
  public.official_statistics
to service_role;

revoke all on sequence public.comment_reactions_id_seq from public, anon, authenticated;
grant usage, select on sequence public.comment_reactions_id_seq to service_role;

-- Disable the legacy seed-based overload without dropping it. It inserted
-- missing polls and accepted mutable poll fields from its caller.
revoke all on function public.increment_poll_vote(
  text,
  integer,
  text,
  text,
  text[],
  integer[],
  integer
) from public, anon, authenticated, service_role;

create or replace function public.increment_poll_vote(
  p_poll_id text,
  p_option_index integer
)
returns table (id text, votes integer[], participants integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_options text[];
  current_votes integer[];
  current_participants integer;
  option_count integer;
  vote_count integer;
  vote_lower_bound integer;
begin
  if p_poll_id is null
    or btrim(p_poll_id) = ''
    or char_length(p_poll_id) > 200 then
    raise exception using
      errcode = '22023',
      message = 'Invalid poll id.';
  end if;

  if p_option_index is null or p_option_index < 0 then
    raise exception using
      errcode = '22023',
      message = 'Invalid option index.';
  end if;

  select p.options, p.votes, p.participants
    into current_options, current_votes, current_participants
  from public.polls as p
  where p.id = p_poll_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Poll not found.';
  end if;

  option_count := coalesce(array_length(current_options, 1), 0);
  vote_count := coalesce(array_length(current_votes, 1), 0);
  vote_lower_bound := coalesce(array_lower(current_votes, 1), 1);

  if option_count < 2 or vote_count <> option_count then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  if exists (
    select 1
    from unnest(current_votes) as item(value)
    where item.value is null or item.value < 0
  ) or current_participants is null or current_participants < 0 then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  if p_option_index >= option_count then
    raise exception using
      errcode = '22023',
      message = 'Option index is out of range.';
  end if;

  current_votes[vote_lower_bound + p_option_index] :=
    current_votes[vote_lower_bound + p_option_index] + 1;

  update public.polls as p
  set votes = current_votes,
      participants = current_participants + 1
  where p.id = p_poll_id;

  return query
  select p.id, p.votes, p.participants
  from public.polls as p
  where p.id = p_poll_id;
end;
$$;

revoke all on function public.increment_poll_vote(text, integer)
from public, anon, authenticated;

grant execute on function public.increment_poll_vote(text, integer)
to service_role;
