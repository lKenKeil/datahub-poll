-- Synchronize only deterministic seed polls that still have no user activity.
-- Each poll is locked and rechecked atomically so a vote or comment cannot race
-- with an allowed content update.

create or replace function public.sync_seed_poll_content(
  p_poll_id text,
  p_title text,
  p_category text,
  p_options jsonb,
  p_official_fact text,
  p_edit_lock_mode text,
  p_edit_lock_minutes integer,
  p_edit_lock_participants integer
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_poll public.polls%rowtype;
  normalized_title text;
  normalized_official_fact text;
  option_count integer;
  poll_vote_count bigint;
  comment_count bigint;
begin
  if p_poll_id is null
    or p_poll_id !~ '^seed_v1_[a-z0-9]+(-[a-z0-9]+)*$'
    or char_length(p_poll_id) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_SEED_POLL_INPUT';
  end if;

  normalized_title := btrim(p_title);
  normalized_official_fact := nullif(btrim(p_official_fact), '');

  if normalized_title is null
    or char_length(normalized_title) < 3
    or char_length(normalized_title) > 120 then
    raise exception using errcode = '22023', message = 'INVALID_SEED_POLL_INPUT';
  end if;

  if p_category is null or p_category not in (
    '학술/통계',
    'IT/테크',
    '사회/경제',
    '라이프스타일',
    '커뮤니티'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_SEED_POLL_INPUT';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_SEED_POLL_INPUT';
  end if;

  option_count := jsonb_array_length(p_options);
  if option_count < 2
    or option_count > 6
    or exists (
      select 1
      from jsonb_array_elements(p_options) as option_row(value)
      where jsonb_typeof(option_row.value) <> 'string'
        or char_length(btrim(option_row.value #>> '{}')) < 1
        or char_length(btrim(option_row.value #>> '{}')) > 50
    )
    or (
      select count(*)
      from jsonb_array_elements(p_options) as option_row(value)
    ) <> (
      select count(distinct lower(btrim(option_row.value #>> '{}')))
      from jsonb_array_elements(p_options) as option_row(value)
    ) then
    raise exception using errcode = '22023', message = 'INVALID_SEED_POLL_INPUT';
  end if;

  if normalized_official_fact is not null
    and char_length(normalized_official_fact) > 300 then
    raise exception using errcode = '22023', message = 'INVALID_SEED_POLL_INPUT';
  end if;

  if not coalesce((
    (p_edit_lock_mode = 'first_vote'
      and p_edit_lock_minutes is null
      and p_edit_lock_participants is null)
    or
    (p_edit_lock_mode = 'time'
      and p_edit_lock_minutes between 1 and 1440
      and p_edit_lock_participants is null)
    or
    (p_edit_lock_mode = 'participants'
      and p_edit_lock_minutes is null
      and p_edit_lock_participants between 1 and 1000)
    or
    (p_edit_lock_mode = 'time_or_participants'
      and p_edit_lock_minutes between 1 and 1440
      and p_edit_lock_participants between 1 and 1000)
  ), false) then
    raise exception using errcode = '22023', message = 'INVALID_SEED_POLL_INPUT';
  end if;

  select p.*
    into current_poll
  from public.polls as p
  where p.id = p_poll_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'missing',
      'participants', 0,
      'poll_votes', 0,
      'comments', 0
    );
  end if;

  select count(*)
    into poll_vote_count
  from public.poll_votes as pv
  where pv.poll_id = p_poll_id;

  select count(*)
    into comment_count
  from public.comments as c
  where c.poll_id = p_poll_id;

  if normalized_title is not distinct from current_poll.title
    and p_category is not distinct from current_poll.category
    and p_options is not distinct from current_poll.options
    and normalized_official_fact is not distinct from current_poll.official_fact
    and p_edit_lock_mode is not distinct from current_poll.edit_lock_mode
    and p_edit_lock_minutes is not distinct from current_poll.edit_lock_minutes
    and p_edit_lock_participants is not distinct from current_poll.edit_lock_participants then
    return jsonb_build_object(
      'status', 'unchanged',
      'participants', current_poll.participants,
      'poll_votes', poll_vote_count,
      'comments', comment_count
    );
  end if;

  if current_poll.participants is distinct from 0
    or poll_vote_count <> 0
    or comment_count <> 0 then
    return jsonb_build_object(
      'status', 'blocked-by-activity',
      'participants', current_poll.participants,
      'poll_votes', poll_vote_count,
      'comments', comment_count
    );
  end if;

  update public.polls as p
  set title = normalized_title,
      category = p_category,
      options = p_options,
      votes = to_jsonb(array_fill(0, array[option_count])),
      participants = 0,
      official_fact = normalized_official_fact,
      edit_lock_mode = p_edit_lock_mode,
      edit_lock_minutes = p_edit_lock_minutes,
      edit_lock_participants = p_edit_lock_participants
  where p.id = p_poll_id;

  return jsonb_build_object(
    'status', 'updated',
    'participants', 0,
    'poll_votes', 0,
    'comments', 0
  );
end;
$$;

revoke all on function public.sync_seed_poll_content(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.sync_seed_poll_content(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) to service_role;

comment on function public.sync_seed_poll_content(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) is
  'Service-only atomic content sync for inactive deterministic seed_v1 polls.';

notify pgrst, 'reload schema';
