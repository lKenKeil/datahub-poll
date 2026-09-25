-- Anonymous poll ownership credentials are isolated from the publicly readable
-- polls table. Only the server-side service_role may access this table or call
-- the atomic poll creation function.

create table if not exists public.poll_ownership (
  poll_id text primary key
    references public.polls(id)
    on delete cascade,
  owner_token_hash text not null,
  created_at timestamptz not null default now(),
  constraint poll_ownership_owner_token_hash_format_check
    check (owner_token_hash ~ '^[0-9a-f]{64}$'),
  constraint poll_ownership_owner_token_hash_unique
    unique (owner_token_hash)
);

alter table public.poll_ownership enable row level security;

revoke all privileges on table public.poll_ownership
from public, anon, authenticated;

grant select, insert, update, delete on table public.poll_ownership
to service_role;

create or replace function public.create_owned_poll(
  p_poll_id text,
  p_title text,
  p_category text,
  p_options jsonb,
  p_votes jsonb,
  p_participants integer,
  p_official_fact text,
  p_option_image_paths jsonb,
  p_owner_token_hash text
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
    raise exception using
      errcode = '22023',
      message = 'Invalid poll id.';
  end if;

  if p_title is null
    or char_length(btrim(p_title)) < 3
    or char_length(btrim(p_title)) > 120 then
    raise exception using
      errcode = '22023',
      message = 'Invalid poll title.';
  end if;

  if p_category is null or p_category not in (
    '학술/통계',
    'IT/테크',
    '사회/경제',
    '라이프스타일',
    '커뮤니티'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Invalid poll category.';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Invalid poll options.';
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
    raise exception using
      errcode = '22023',
      message = 'Invalid poll options.';
  end if;

  if p_votes is null or jsonb_typeof(p_votes) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'New poll vote data must start at zero.';
  end if;

  if jsonb_array_length(p_votes) <> option_count
    or exists (
      select 1
      from jsonb_array_elements(p_votes) as vote_row(value)
      where jsonb_typeof(vote_row.value) <> 'number'
        or (vote_row.value #>> '{}') <> '0'
    )
    or p_participants is distinct from 0 then
    raise exception using
      errcode = '22023',
      message = 'New poll vote data must start at zero.';
  end if;

  if p_official_fact is not null and char_length(p_official_fact) > 300 then
    raise exception using
      errcode = '22023',
      message = 'Invalid poll description.';
  end if;

  if p_option_image_paths is not null then
    if jsonb_typeof(p_option_image_paths) <> 'array' then
      raise exception using
        errcode = '22023',
        message = 'Invalid poll option image paths.';
    end if;

    if jsonb_array_length(p_option_image_paths) <> option_count then
      raise exception using
        errcode = '22023',
        message = 'Invalid poll option image paths.';
    end if;
  end if;

  if p_owner_token_hash is null
    or p_owner_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Invalid owner token hash.';
  end if;

  insert into public.polls (
    id,
    title,
    category,
    options,
    votes,
    participants,
    official_fact,
    option_image_paths
  ) values (
    p_poll_id,
    btrim(p_title),
    p_category,
    p_options,
    p_votes,
    p_participants,
    nullif(btrim(p_official_fact), ''),
    p_option_image_paths
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
  text
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
  text
) to service_role;

comment on table public.poll_ownership is
  'Server-only ownership credentials for anonymously created polls.';

comment on column public.poll_ownership.owner_token_hash is
  'Lowercase SHA-256 hex digest of the one-time raw owner token.';
