-- Owner-authorized mutations are authenticated by the server. These RPCs are
-- service_role-only and provide the transaction/row-lock boundary needed to
-- keep option indexes, votes, comments, and deletion consistent.

create or replace function public.lock_poll_for_comment_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  perform 1
  from public.polls as p
  where p.id = new.poll_id
  for key share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'POLL_NOT_FOUND';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_lock_poll_before_write on public.comments;
create trigger comments_lock_poll_before_write
before insert or update of poll_id on public.comments
for each row
execute function public.lock_poll_for_comment_write();

revoke all on function public.lock_poll_for_comment_write()
from public, anon, authenticated;

grant execute on function public.lock_poll_for_comment_write()
to service_role;

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
    if jsonb_typeof(p_option_image_paths) <> 'array'
      or jsonb_array_length(p_option_image_paths) <> option_count
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

  if structure_changed and (
    coalesce(current_poll.participants, 0) <> 0
    or has_votes
    or has_comments
  ) then
    raise exception using errcode = 'P0001', message = 'POLL_STRUCTURE_LOCKED';
  end if;

  if structure_changed then
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

comment on function public.update_owned_poll(text, text, text, jsonb, text, jsonb, jsonb) is
  'Service-only atomic poll update. Structural fields are locked after any vote or comment.';

comment on function public.delete_poll_with_dependents(text) is
  'Service-only atomic poll deletion; returns Storage paths for post-commit cleanup.';
