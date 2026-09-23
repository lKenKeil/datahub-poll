create table if not exists public.poll_votes (
  id bigint generated always as identity primary key,
  poll_id text not null references public.polls(id) on delete cascade,
  voter_id text not null,
  option_index integer not null check (option_index >= 0),
  created_at timestamptz not null default now(),
  constraint poll_votes_poll_voter_unique unique (poll_id, voter_id),
  constraint poll_votes_voter_id_length check (char_length(voter_id) = 36),
  constraint poll_votes_voter_id_uuid check (
    voter_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

create index if not exists poll_votes_poll_id_idx
on public.poll_votes (poll_id);

alter table public.poll_votes enable row level security;

revoke all privileges on table public.poll_votes
from public, anon, authenticated, service_role;

grant select on table public.poll_votes
to service_role;

revoke all on sequence public.poll_votes_id_seq
from public, anon, authenticated, service_role;

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

-- The service must use the voter-aware overload from now on.
revoke all on function public.increment_poll_vote(text, integer)
from public, anon, authenticated, service_role;

revoke all on function public.increment_poll_vote(text, integer, text)
from public, anon, authenticated;

grant execute on function public.increment_poll_vote(text, integer, text)
to service_role;
