create or replace function public.increment_poll_vote(
  p_poll_id text,
  p_option_index integer,
  p_title text,
  p_category text,
  p_options text[],
  p_seed_votes integer[],
  p_seed_participants integer
)
returns table (id text, votes integer[], participants integer)
language plpgsql
security definer
as $$
declare
  current_votes integer[];
  current_participants integer;
begin
  insert into public.polls (id, title, category, options, votes, participants)
  values (
    p_poll_id,
    p_title,
    p_category,
    p_options,
    p_seed_votes,
    p_seed_participants
  )
  on conflict (id) do nothing;

  select polls.votes, polls.participants
    into current_votes, current_participants
  from public.polls
  where polls.id = p_poll_id
  for update;

  if current_votes is null then
    current_votes := p_seed_votes;
  end if;

  if current_participants is null then
    current_participants := p_seed_participants;
  end if;

  if p_option_index < 0 or p_option_index >= coalesce(array_length(current_votes, 1), 0) then
    raise exception 'Invalid option index: %', p_option_index;
  end if;

  current_votes[p_option_index + 1] := coalesce(current_votes[p_option_index + 1], 0) + 1;
  current_participants := coalesce(current_participants, 0) + 1;

  update public.polls
  set votes = current_votes,
      participants = current_participants,
      title = coalesce(title, p_title),
      category = coalesce(category, p_category),
      options = coalesce(options, p_options)
  where polls.id = p_poll_id;

  return query
  select polls.id, polls.votes, polls.participants
  from public.polls
  where polls.id = p_poll_id;
end;
$$;

grant execute on function public.increment_poll_vote(text, integer, text, text, text[], integer[], integer) to anon;
grant execute on function public.increment_poll_vote(text, integer, text, text, text[], integer[], integer) to authenticated;
