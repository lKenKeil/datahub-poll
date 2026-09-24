-- Keep the lock order consistent for first votes and vote changes: poll row
-- first, then the per-voter row. This prevents cross-operation deadlocks.
create or replace function public.increment_poll_vote(
  p_poll_id text,
  p_option_index integer,
  p_voter_id text
)
returns table (id text, votes integer[], participants integer, option_index integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
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

  if p_voter_id is null
    or char_length(p_voter_id) <> 36
    or p_voter_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '22023',
      message = 'Invalid voter id.';
  end if;

  perform 1
  from public.polls as p
  where p.id = p_poll_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Poll not found.';
  end if;

  begin
    insert into public.poll_votes (poll_id, voter_id, option_index)
    values (p_poll_id, lower(p_voter_id), p_option_index);
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'Already voted on this poll.';
  end;

  return query
  select result.id, result.votes, result.participants, p_option_index
  from public.increment_poll_vote(p_poll_id, p_option_index) as result;
end;
$$;

create or replace function public.change_poll_vote(
  p_poll_id text,
  p_new_option_index integer,
  p_voter_id text
)
returns table (
  id text,
  votes jsonb,
  participants integer,
  option_index integer,
  changed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_options jsonb;
  current_votes jsonb;
  current_participants integer;
  previous_option_index integer;
  option_count integer;
  previous_vote_count integer;
  new_vote_count integer;
begin
  if p_poll_id is null
    or btrim(p_poll_id) = ''
    or char_length(p_poll_id) > 200 then
    raise exception using
      errcode = '22023',
      message = 'Invalid poll id.';
  end if;

  if p_new_option_index is null or p_new_option_index < 0 then
    raise exception using
      errcode = '22023',
      message = 'Invalid option index.';
  end if;

  if p_voter_id is null
    or char_length(p_voter_id) <> 36
    or p_voter_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '22023',
      message = 'Invalid voter id.';
  end if;

  -- Every vote mutation locks the poll row before changing its vote counts.
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

  if current_options is null
    or jsonb_typeof(current_options) <> 'array'
    or current_votes is null
    or jsonb_typeof(current_votes) <> 'array'
    or current_participants is null
    or current_participants < 0 then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  option_count := jsonb_array_length(current_options);
  if option_count < 2
    or jsonb_array_length(current_votes) <> option_count
    or p_new_option_index >= option_count then
    raise exception using
      errcode = '22023',
      message = 'Option index is out of range.';
  end if;

  select pv.option_index
    into previous_option_index
  from public.poll_votes as pv
  where pv.poll_id = p_poll_id
    and pv.voter_id = lower(p_voter_id)
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Existing vote not found.';
  end if;

  if previous_option_index < 0 or previous_option_index >= option_count then
    raise exception using
      errcode = '22023',
      message = 'Stored option index is invalid.';
  end if;

  if previous_option_index = p_new_option_index then
    return query
    select p_poll_id, current_votes, current_participants, previous_option_index, false;
    return;
  end if;

  if (current_votes ->> previous_option_index) is null
    or (current_votes ->> previous_option_index) !~ '^(0|[1-9][0-9]*)$'
    or (current_votes ->> p_new_option_index) is null
    or (current_votes ->> p_new_option_index) !~ '^(0|[1-9][0-9]*)$' then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  if (current_votes ->> previous_option_index)::numeric > 2147483647
    or (current_votes ->> p_new_option_index)::numeric > 2147483647 then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  previous_vote_count := (current_votes ->> previous_option_index)::integer;
  new_vote_count := (current_votes ->> p_new_option_index)::integer;

  if previous_vote_count <= 0 or new_vote_count >= 2147483647 then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  current_votes := jsonb_set(
    current_votes,
    array[previous_option_index::text],
    to_jsonb(previous_vote_count - 1),
    false
  );
  current_votes := jsonb_set(
    current_votes,
    array[p_new_option_index::text],
    to_jsonb(new_vote_count + 1),
    false
  );

  update public.polls as p
  set votes = current_votes
  where p.id = p_poll_id;

  update public.poll_votes as pv
  set option_index = p_new_option_index
  where pv.poll_id = p_poll_id
    and pv.voter_id = lower(p_voter_id);

  return query
  select p_poll_id, current_votes, current_participants, p_new_option_index, true;
end;
$$;

revoke all on function public.increment_poll_vote(text, integer, text)
from public, anon, authenticated;

grant execute on function public.increment_poll_vote(text, integer, text)
to service_role;

revoke all on function public.change_poll_vote(text, integer, text)
from public, anon, authenticated;

grant execute on function public.change_poll_vote(text, integer, text)
to service_role;
