-- polls.options and polls.votes are jsonb columns. Keep the existing RPC
-- signature, but convert votes explicitly instead of relying on invalid
-- jsonb-to-PostgreSQL-array assignment casts.

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
  current_options jsonb;
  current_votes_json jsonb;
  current_votes integer[];
  current_participants integer;
  new_participants integer;
  option_count integer;
  vote_count integer;
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
    into current_options, current_votes_json, current_participants
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
    or current_votes_json is null
    or jsonb_typeof(current_votes_json) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  option_count := jsonb_array_length(current_options);
  vote_count := jsonb_array_length(current_votes_json);

  if option_count < 2 or vote_count <> option_count then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(current_options) as item(value)
    where jsonb_typeof(item.value) <> 'string'
  ) or exists (
    select 1
    from jsonb_array_elements(current_votes_json) as item(value)
    where jsonb_typeof(item.value) <> 'number'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(current_votes_json) as item(value)
    where (item.value #>> '{}') !~ '^(0|[1-9][0-9]*)$'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(current_votes_json) as item(value)
    where (item.value #>> '{}')::numeric > 2147483646
  ) or current_participants is null
    or current_participants < 0
    or current_participants > 2147483646 then
    raise exception using
      errcode = '22023',
      message = 'Poll vote data is invalid.';
  end if;

  if p_option_index >= option_count then
    raise exception using
      errcode = '22023',
      message = 'Option index is out of range.';
  end if;

  select coalesce(
    array_agg((item.value #>> '{}')::integer order by item.position),
    array[]::integer[]
  )
    into current_votes
  from jsonb_array_elements(current_votes_json)
    with ordinality as item(value, position);

  current_votes[p_option_index + 1] := current_votes[p_option_index + 1] + 1;
  new_participants := current_participants + 1;

  update public.polls as p
  set votes = to_jsonb(current_votes),
      participants = new_participants
  where p.id = p_poll_id;

  return query
  select p_poll_id, current_votes, new_participants;
end;
$$;

revoke all on function public.increment_poll_vote(text, integer)
from public, anon, authenticated;

grant execute on function public.increment_poll_vote(text, integer)
to service_role;
