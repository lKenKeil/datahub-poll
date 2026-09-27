-- Poll creators can choose when structural edits become locked. Existing
-- polls keep the historical first-vote behavior. Category and description
-- edits remain available after the structural lock.

do $$
declare
  mode_type text;
  minutes_type text;
  participants_type text;
begin
  select c.data_type into mode_type
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'polls'
    and c.column_name = 'edit_lock_mode';

  select c.data_type into minutes_type
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'polls'
    and c.column_name = 'edit_lock_minutes';

  select c.data_type into participants_type
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'polls'
    and c.column_name = 'edit_lock_participants';

  if mode_type is not null and mode_type <> 'text' then
    raise exception using errcode = '42804', message = 'polls.edit_lock_mode must be text.';
  end if;
  if minutes_type is not null and minutes_type <> 'integer' then
    raise exception using errcode = '42804', message = 'polls.edit_lock_minutes must be integer.';
  end if;
  if participants_type is not null and participants_type <> 'integer' then
    raise exception using errcode = '42804', message = 'polls.edit_lock_participants must be integer.';
  end if;
end;
$$;

alter table public.polls
  add column if not exists edit_lock_mode text,
  add column if not exists edit_lock_minutes integer,
  add column if not exists edit_lock_participants integer;

-- Backfill only the new policy column. Existing vote data is untouched.
update public.polls
set edit_lock_mode = 'first_vote'
where edit_lock_mode is null;

alter table public.polls
  alter column edit_lock_mode set default 'first_vote',
  alter column edit_lock_mode set not null;

alter table public.polls
  drop constraint if exists polls_edit_lock_mode_check,
  drop constraint if exists polls_edit_lock_values_check;

alter table public.polls
  add constraint polls_edit_lock_mode_check
  check (edit_lock_mode in (
    'first_vote',
    'time',
    'participants',
    'time_or_participants'
  )) not valid,
  add constraint polls_edit_lock_values_check
  check (
    (edit_lock_mode = 'first_vote'
      and edit_lock_minutes is null
      and edit_lock_participants is null)
    or
    (edit_lock_mode = 'time'
      and created_at is not null
      and edit_lock_minutes between 1 and 1440
      and edit_lock_participants is null)
    or
    (edit_lock_mode = 'participants'
      and edit_lock_minutes is null
      and edit_lock_participants between 1 and 1000)
    or
    (edit_lock_mode = 'time_or_participants'
      and created_at is not null
      and edit_lock_minutes between 1 and 1440
      and edit_lock_participants between 1 and 1000)
  ) not valid;

alter table public.polls validate constraint polls_edit_lock_mode_check;
alter table public.polls validate constraint polls_edit_lock_values_check;

comment on column public.polls.edit_lock_mode is
  'Structural edit lock policy: first_vote, time, participants, or time_or_participants.';
comment on column public.polls.edit_lock_minutes is
  'Minute limit for time-based structural edit policies (1-1440).';
comment on column public.polls.edit_lock_participants is
  'Participant limit for participant-based structural edit policies (1-1000).';

create or replace function public.poll_structural_edit_lock_reason(
  p_edit_lock_mode text,
  p_created_at timestamptz,
  p_participants integer,
  p_edit_lock_minutes integer,
  p_edit_lock_participants integer,
  p_has_votes boolean,
  p_has_comments boolean,
  p_now timestamptz
)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
begin
  if coalesce(p_has_comments, false) then
    return 'has_comments';
  end if;

  case p_edit_lock_mode
    when 'first_vote' then
      if coalesce(p_participants, 0) > 0 or coalesce(p_has_votes, false) then
        return 'first_vote';
      end if;
    when 'time' then
      if p_created_at is null
        or p_edit_lock_minutes is null
        or p_now is null
        or p_now >= p_created_at + make_interval(mins => p_edit_lock_minutes) then
        return 'time_expired';
      end if;
    when 'participants' then
      if p_edit_lock_participants is null
        or coalesce(p_participants, 0) >= p_edit_lock_participants then
        return 'participant_limit';
      end if;
    when 'time_or_participants' then
      if p_created_at is null
        or p_edit_lock_minutes is null
        or p_now is null
        or p_now >= p_created_at + make_interval(mins => p_edit_lock_minutes) then
        return 'time_expired';
      end if;
      if p_edit_lock_participants is null
        or coalesce(p_participants, 0) >= p_edit_lock_participants then
        return 'participant_limit';
      end if;
    else
      -- Invalid persisted policy data must fail closed.
      return 'first_vote';
  end case;

  return null;
end;
$$;

revoke all on function public.poll_structural_edit_lock_reason(
  text,
  timestamptz,
  integer,
  integer,
  integer,
  boolean,
  boolean,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.poll_structural_edit_lock_reason(
  text,
  timestamptz,
  integer,
  integer,
  integer,
  boolean,
  boolean,
  timestamptz
) to service_role;

-- Keep the original nine-argument overload for rolling-deployment
-- compatibility. It continues to create first_vote polls via column defaults.
create or replace function public.create_owned_poll(
  p_poll_id text,
  p_title text,
  p_category text,
  p_options jsonb,
  p_votes jsonb,
  p_participants integer,
  p_official_fact text,
  p_option_image_paths jsonb,
  p_owner_token_hash text,
  p_edit_lock_mode text,
  p_edit_lock_minutes integer,
  p_edit_lock_participants integer
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  option_count integer;
begin
  if p_poll_id is null
    or btrim(p_poll_id) = ''
    or char_length(p_poll_id) > 200 then
    raise exception using errcode = '22023', message = 'Invalid poll id.';
  end if;

  if p_title is null
    or char_length(btrim(p_title)) < 3
    or char_length(btrim(p_title)) > 120 then
    raise exception using errcode = '22023', message = 'Invalid poll title.';
  end if;

  if p_category is null or p_category not in (
    '학술/통계',
    'IT/테크',
    '사회/경제',
    '라이프스타일',
    '커뮤니티'
  ) then
    raise exception using errcode = '22023', message = 'Invalid poll category.';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid poll options.';
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
    raise exception using errcode = '22023', message = 'Invalid poll options.';
  end if;

  if p_votes is null or jsonb_typeof(p_votes) <> 'array' then
    raise exception using errcode = '22023', message = 'New poll vote data must start at zero.';
  end if;

  if jsonb_array_length(p_votes) <> option_count
    or exists (
      select 1
      from jsonb_array_elements(p_votes) as vote_row(value)
      where jsonb_typeof(vote_row.value) <> 'number'
        or (vote_row.value #>> '{}') <> '0'
    )
    or p_participants is distinct from 0 then
    raise exception using errcode = '22023', message = 'New poll vote data must start at zero.';
  end if;

  if p_official_fact is not null and char_length(p_official_fact) > 300 then
    raise exception using errcode = '22023', message = 'Invalid poll description.';
  end if;

  if p_option_image_paths is not null then
    if jsonb_typeof(p_option_image_paths) <> 'array' then
      raise exception using errcode = '22023', message = 'Invalid poll option image paths.';
    end if;

    if jsonb_array_length(p_option_image_paths) <> option_count
      or exists (
      select 1
      from jsonb_array_elements(p_option_image_paths) as image_row(value)
      where jsonb_typeof(image_row.value) not in ('string', 'null')
      ) then
      raise exception using errcode = '22023', message = 'Invalid poll option image paths.';
    end if;
  end if;

  if p_owner_token_hash is null or p_owner_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid owner token hash.';
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
    raise exception using errcode = '22023', message = 'Invalid poll edit lock.';
  end if;

  insert into public.polls (
    id,
    title,
    category,
    options,
    votes,
    participants,
    official_fact,
    option_image_paths,
    edit_lock_mode,
    edit_lock_minutes,
    edit_lock_participants
  ) values (
    p_poll_id,
    btrim(p_title),
    p_category,
    p_options,
    p_votes,
    p_participants,
    nullif(btrim(p_official_fact), ''),
    p_option_image_paths,
    p_edit_lock_mode,
    p_edit_lock_minutes,
    p_edit_lock_participants
  );

  insert into public.poll_ownership (poll_id, owner_token_hash)
  values (p_poll_id, p_owner_token_hash);

  return p_poll_id;
end;
$$;

revoke all on function public.create_owned_poll(
  text,
  text,
  text,
  jsonb,
  jsonb,
  integer,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.create_owned_poll(
  text,
  text,
  text,
  jsonb,
  jsonb,
  integer,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) to service_role;

create or replace function public.update_owned_poll(
  p_poll_id text,
  p_title text,
  p_category text,
  p_options jsonb,
  p_official_fact text,
  p_option_image_paths jsonb,
  p_expected_poll jsonb
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
  has_votes boolean;
  has_comments boolean;
  structure_changed boolean;
  lock_reason text;
  updated_poll jsonb;
begin
  if p_poll_id is null
    or btrim(p_poll_id) = ''
    or char_length(p_poll_id) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
  end if;

  normalized_title := btrim(p_title);
  normalized_official_fact := nullif(btrim(p_official_fact), '');

  if normalized_title is null
    or char_length(normalized_title) < 3
    or char_length(normalized_title) > 120 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
  end if;

  if p_category is null or p_category not in (
    '학술/통계',
    'IT/테크',
    '사회/경제',
    '라이프스타일',
    '커뮤니티'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
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
    raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
  end if;

  if normalized_official_fact is not null
    and char_length(normalized_official_fact) > 300 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
  end if;

  if p_option_image_paths is not null then
    if jsonb_typeof(p_option_image_paths) <> 'array' then
      raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
    end if;

    if jsonb_array_length(p_option_image_paths) <> option_count
      or exists (
      select 1
      from jsonb_array_elements(p_option_image_paths)
        with ordinality as image_row(value, position)
      where jsonb_typeof(image_row.value) not in ('string', 'null')
        or (
          jsonb_typeof(image_row.value) = 'string'
          and (
            split_part(image_row.value #>> '{}', '/', 1) <> p_poll_id
            or cardinality(string_to_array(image_row.value #>> '{}', '/')) <> 4
            or split_part(image_row.value #>> '{}', '/', 2) <> 'options'
            or split_part(image_row.value #>> '{}', '/', 3) <> (image_row.position - 1)::text
            or split_part(image_row.value #>> '{}', '/', 4)
              !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
          )
        )
      ) then
      raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
    end if;
  end if;

  -- This is the shared lock boundary with vote RPCs and the comment trigger.
  select p.*
    into current_poll
  from public.polls as p
  where p.id = p_poll_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;

  if p_expected_poll is null
    or jsonb_typeof(p_expected_poll) <> 'object'
    or current_poll.title is distinct from (p_expected_poll ->> 'title')
    or current_poll.category is distinct from (p_expected_poll ->> 'category')
    or current_poll.options is distinct from (p_expected_poll -> 'options')
    or current_poll.official_fact is distinct from (p_expected_poll ->> 'official_fact')
    or current_poll.option_image_paths is distinct from nullif(
      p_expected_poll -> 'option_image_paths',
      'null'::jsonb
    ) then
    raise exception using errcode = 'P0001', message = 'POLL_EDIT_CONFLICT';
  end if;

  select exists (
    select 1 from public.poll_votes as pv where pv.poll_id = p_poll_id
  ) into has_votes;

  select exists (
    select 1 from public.comments as c where c.poll_id = p_poll_id
  ) into has_comments;

  structure_changed :=
    normalized_title is distinct from current_poll.title
    or p_options is distinct from current_poll.options
    or p_option_image_paths is distinct from current_poll.option_image_paths;

  if structure_changed then
    lock_reason := public.poll_structural_edit_lock_reason(
      current_poll.edit_lock_mode,
      current_poll.created_at,
      current_poll.participants,
      current_poll.edit_lock_minutes,
      current_poll.edit_lock_participants,
      has_votes,
      has_comments,
      statement_timestamp()
    );

    if lock_reason is not null then
      raise exception using
        errcode = 'P0001',
        message = 'POLL_STRUCTURE_LOCKED',
        detail = lock_reason;
    end if;

    -- Reset all positional vote data in the same transaction before applying
    -- the new option structure. Deleting zero rows is harmless.
    delete from public.poll_votes as pv
    where pv.poll_id = p_poll_id;

    update public.polls as p
    set title = normalized_title,
        category = p_category,
        options = p_options,
        votes = to_jsonb(array_fill(0, array[option_count])),
        participants = 0,
        official_fact = normalized_official_fact,
        option_image_paths = p_option_image_paths
    where p.id = p_poll_id;
  else
    update public.polls as p
    set category = p_category,
        official_fact = normalized_official_fact
    where p.id = p_poll_id;
  end if;

  select to_jsonb(p)
    into updated_poll
  from public.polls as p
  where p.id = p_poll_id;

  return updated_poll;
end;
$$;

revoke all on function public.update_owned_poll(
  text,
  text,
  text,
  jsonb,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.update_owned_poll(
  text,
  text,
  text,
  jsonb,
  text,
  jsonb,
  jsonb
) to service_role;

comment on function public.update_owned_poll(text, text, text, jsonb, text, jsonb, jsonb) is
  'Service-only atomic poll update. Structural changes follow the persisted edit-lock policy and reset positional vote data.';

-- comments_poll_id_idx and poll_votes_poll_id_idx already support the two
-- existence checks above; no new index is required.

notify pgrst, 'reload schema';
