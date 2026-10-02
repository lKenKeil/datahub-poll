-- Reporting credentials and moderation actions are private server operations.
-- Deploy this migration before the corresponding Route Handlers. Existing vote,
-- owner, edit-lock and Storage cleanup behavior is retained.

alter table public.polls
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz;

alter table public.comments
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz;

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('poll', 'comment')),
  target_id text not null check (char_length(target_id) between 1 and 200),
  poll_id text not null check (char_length(poll_id) between 1 and 200),
  reporter_hash text not null check (reporter_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'privacy', 'other')),
  detail text check (detail is null or char_length(detail) <= 300),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  action text check (action in ('hide', 'restore', 'delete', 'no_action')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  constraint content_reports_target_reporter_unique
    unique (target_type, target_id, reporter_hash),
  constraint content_reports_handled_state_check check (
    (status = 'pending' and action is null and handled_at is null)
    or (status <> 'pending' and action is not null and handled_at is not null)
  ),
  constraint content_reports_other_detail_check check (detail is null or reason = 'other')
);

-- There is deliberately no target FK: poll IDs are text, comment IDs are UUID,
-- and handled reports survive target deletion as private operational history.
create index if not exists content_reports_pending_created_at_idx
on public.content_reports (created_at desc, id) where status = 'pending';

create index if not exists content_reports_target_created_at_idx
on public.content_reports (target_type, target_id, created_at desc);

create index if not exists content_reports_poll_id_idx
on public.content_reports (poll_id);

alter table public.content_reports enable row level security;
revoke all privileges on table public.content_reports
from public, anon, authenticated, service_role;
grant select, insert, update on table public.content_reports to service_role;

-- Static official fallback items need a content-free deletion marker, including
-- when the deleted DB row never had a report. Seed/custom IDs are not recorded.
create table if not exists public.deleted_official_polls (
  poll_id text primary key check (left(poll_id, 9) = 'official_' and char_length(poll_id) <= 200),
  deleted_at timestamptz not null default now()
);
alter table public.deleted_official_polls enable row level security;
revoke all privileges on table public.deleted_official_polls
from public, anon, authenticated, service_role;
grant select, insert on table public.deleted_official_polls to service_role;

-- Do not publish private records, even when reapplying existing tables.
do $$
declare
  publication_row record;
begin
  for publication_row in
    select p.pubname, p.puballtables, pt.tablename
    from pg_catalog.pg_publication as p
    join pg_catalog.pg_publication_tables as pt on pt.pubname = p.pubname
    where pt.schemaname = 'public' and pt.tablename in ('content_reports', 'deleted_official_polls')
  loop
    if publication_row.puballtables then
      raise exception 'Private moderation tables must not belong to an ALL TABLES publication.';
    end if;
    execute format('alter publication %I drop table public.%I', publication_row.pubname, publication_row.tablename);
  end loop;
end;
$$;

alter table public.polls enable row level security;
alter table public.comments enable row level security;
alter table public.comment_reactions enable row level security;

drop policy if exists "Public read polls" on public.polls;
create policy "Public read polls" on public.polls
for select to anon, authenticated using (not is_hidden);
drop policy if exists "Moderation public poll visibility" on public.polls;
create policy "Moderation public poll visibility" on public.polls
as restrictive for select to anon, authenticated using (not is_hidden);

drop policy if exists "Public read comments" on public.comments;
create policy "Public read comments" on public.comments
for select to anon, authenticated using (
  not is_hidden and exists (
    select 1 from public.polls as p where p.id = comments.poll_id and not p.is_hidden
  )
);
drop policy if exists "Moderation public comment visibility" on public.comments;
create policy "Moderation public comment visibility" on public.comments
as restrictive for select to anon, authenticated using (
  not is_hidden and exists (
    select 1 from public.polls as p where p.id = comments.poll_id and not p.is_hidden
  )
);

drop policy if exists "Public read comment reactions" on public.comment_reactions;
create policy "Public read comment reactions" on public.comment_reactions
for select to anon, authenticated using (
  exists (
    select 1 from public.comments as c
    join public.polls as p on p.id = c.poll_id
    where c.id::text = comment_reactions.comment_id and not c.is_hidden and not p.is_hidden
  )
);
drop policy if exists "Moderation public reaction visibility" on public.comment_reactions;
create policy "Moderation public reaction visibility" on public.comment_reactions
as restrictive for select to anon, authenticated using (
  exists (
    select 1 from public.comments as c
    join public.polls as p on p.id = c.poll_id
    where c.id::text = comment_reactions.comment_id and not c.is_hidden and not p.is_hidden
  )
);

-- Hidden parents remain in the database for edit-lock checks and safe reply
-- placeholders. New replies must not target a hidden/deleted parent.
create or replace function public.lock_poll_for_comment_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  poll_hidden boolean;
begin
  select p.is_hidden into poll_hidden
  from public.polls as p where p.id = new.poll_id for update;

  if not found or poll_hidden then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;

  if new.parent_id is not null then
    perform 1 from public.comments as c
    where c.id::text = new.parent_id and c.poll_id = new.poll_id and not c.is_hidden
    for key share;
    if not found then
      raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists comments_lock_poll_before_write on public.comments;
create trigger comments_lock_poll_before_write
before insert or update of poll_id, parent_id on public.comments
for each row execute function public.lock_poll_for_comment_write();

revoke all on function public.lock_poll_for_comment_write() from public, anon, authenticated;
grant execute on function public.lock_poll_for_comment_write() to service_role;

create or replace function public.submit_content_report(
  p_target_type text,
  p_target_id text,
  p_reporter_hash text,
  p_reason text,
  p_detail text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  target_poll_id text;
  normalized_target_id text;
  normalized_detail text;
  poll_hidden boolean;
  inserted_id uuid;
begin
  if p_target_type is null or p_target_type not in ('poll', 'comment')
    or p_target_id is null or char_length(p_target_id) not between 1 and 200
    or p_target_id <> btrim(p_target_id)
    or p_reporter_hash is null or p_reporter_hash !~ '^[0-9a-f]{64}$'
    or p_reason is null or p_reason not in ('spam', 'harassment', 'inappropriate', 'privacy', 'other')
    or (p_detail is not null and char_length(p_detail) > 300)
    or (p_reason <> 'other' and nullif(btrim(p_detail), '') is not null) then
    raise exception using errcode = '22023', message = 'INVALID_REPORT_INPUT';
  end if;
  normalized_detail := nullif(btrim(p_detail), '');
  if p_target_type = 'comment' then
    if p_target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'INVALID_REPORT_INPUT';
    end if;
    normalized_target_id := (p_target_id::uuid)::text;
    select c.poll_id into target_poll_id from public.comments as c
    where c.id = normalized_target_id::uuid;
  else
    normalized_target_id := p_target_id;
    target_poll_id := p_target_id;
  end if;

  -- Lock the poll first, then recheck the target to serialize with hide/delete.
  select p.is_hidden into poll_hidden
  from public.polls as p where p.id = target_poll_id for update;
  if not found or poll_hidden then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;
  if p_target_type = 'comment' then
    perform 1 from public.comments as c
    where c.id = normalized_target_id::uuid and c.poll_id = target_poll_id and not c.is_hidden
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
    end if;
  end if;

  insert into public.content_reports (target_type, target_id, poll_id, reporter_hash, reason, detail)
  values (p_target_type, normalized_target_id, target_poll_id, p_reporter_hash, p_reason, normalized_detail)
  on conflict on constraint content_reports_target_reporter_unique do nothing
  returning id into inserted_id;
  return jsonb_build_object('duplicate', inserted_id is null);
end;
$$;

revoke all on function public.submit_content_report(text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.submit_content_report(text, text, text, text, text) to service_role;

create or replace function public.moderate_report_target(
  p_target_type text,
  p_target_id text,
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  target_poll_id text;
  normalized_target_id text;
  target_exists boolean := false;
  target_hidden boolean := false;
  handled_count integer;
begin
  if p_target_type is null or p_target_type not in ('poll', 'comment')
    or p_target_id is null or char_length(p_target_id) not between 1 and 200
    or p_target_id <> btrim(p_target_id)
    or p_action is null or p_action not in ('hide', 'restore', 'resolve', 'dismiss') then
    raise exception using errcode = '22023', message = 'INVALID_MODERATION_INPUT';
  end if;
  if p_target_type = 'comment' then
    if p_target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'INVALID_MODERATION_INPUT';
    end if;
    normalized_target_id := (p_target_id::uuid)::text;
    select c.poll_id into target_poll_id from public.comments as c
    where c.id = normalized_target_id::uuid;
  else
    normalized_target_id := p_target_id;
    target_poll_id := p_target_id;
  end if;

  perform 1 from public.polls as p where p.id = target_poll_id for update;
  if found then
    if p_target_type = 'poll' then
      select p.is_hidden into target_hidden from public.polls as p where p.id = target_poll_id;
      target_exists := true;
    else
      select c.is_hidden into target_hidden from public.comments as c
      where c.id = normalized_target_id::uuid and c.poll_id = target_poll_id for update;
      target_exists := found;
    end if;
  end if;

  if p_action in ('hide', 'restore') then
    if not target_exists then
      raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
    end if;
    target_hidden := p_action = 'hide';
    if p_target_type = 'poll' then
      update public.polls as p
      set is_hidden = target_hidden,
          hidden_at = case when target_hidden then coalesce(p.hidden_at, now()) else null end
      where p.id = normalized_target_id;
    else
      update public.comments as c
      set is_hidden = target_hidden,
          hidden_at = case when target_hidden then coalesce(c.hidden_at, now()) else null end
      where c.id = normalized_target_id::uuid;
    end if;
  end if;

  update public.content_reports as r
  set status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end,
      action = case when p_action in ('resolve', 'dismiss') then 'no_action' else p_action end,
      handled_at = now()
  where r.target_type = p_target_type and r.target_id = normalized_target_id and r.status = 'pending';
  get diagnostics handled_count = row_count;
  return jsonb_build_object(
    'target_exists', target_exists,
    'is_hidden', coalesce(target_hidden, false),
    'handled_count', handled_count
  );
end;
$$;

revoke all on function public.moderate_report_target(text, text, text) from public, anon, authenticated;
grant execute on function public.moderate_report_target(text, text, text) to service_role;

create or replace function public.set_comment_reaction(
  p_comment_id uuid,
  p_user_fingerprint text,
  p_reaction text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  target_poll_id text;
  poll_hidden boolean;
  like_count bigint;
  dislike_count bigint;
  user_reaction text;
begin
  if p_comment_id is null or p_user_fingerprint is null
    or char_length(btrim(p_user_fingerprint)) not between 1 and 200
    or (p_reaction is not null and p_reaction not in ('like', 'dislike')) then
    raise exception using errcode = '22023', message = 'INVALID_REACTION_INPUT';
  end if;
  select c.poll_id into target_poll_id from public.comments as c where c.id = p_comment_id;
  select p.is_hidden into poll_hidden from public.polls as p where p.id = target_poll_id for update;
  if not found or poll_hidden then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;
  perform 1 from public.comments as c
  where c.id = p_comment_id and c.poll_id = target_poll_id and not c.is_hidden for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;

  if p_reaction is null then
    delete from public.comment_reactions as cr
    where cr.comment_id = p_comment_id::text and cr.user_fingerprint = btrim(p_user_fingerprint);
  else
    insert into public.comment_reactions (comment_id, user_fingerprint, reaction)
    values (p_comment_id::text, btrim(p_user_fingerprint), p_reaction)
    on conflict (comment_id, user_fingerprint)
    do update set reaction = excluded.reaction, updated_at = now();
  end if;

  select count(*) filter (where cr.reaction = 'like'),
         count(*) filter (where cr.reaction = 'dislike')
    into like_count, dislike_count
  from public.comment_reactions as cr where cr.comment_id = p_comment_id::text;
  select cr.reaction into user_reaction from public.comment_reactions as cr
  where cr.comment_id = p_comment_id::text and cr.user_fingerprint = btrim(p_user_fingerprint);
  return jsonb_build_object('likeCount', like_count, 'dislikeCount', dislike_count, 'userReaction', user_reaction);
end;
$$;

revoke all on function public.set_comment_reaction(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_comment_reaction(uuid, text, text) to service_role;

create or replace function public.delete_comment_with_dependents(p_comment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  target_poll_id text;
  comment_ids uuid[];
  deleted_count integer;
begin
  if p_comment_id is null then
    raise exception using errcode = '22023', message = 'INVALID_MODERATION_INPUT';
  end if;
  select c.poll_id into target_poll_id from public.comments as c where c.id = p_comment_id;
  perform 1 from public.polls as p where p.id = target_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;
  perform 1 from public.comments as c where c.id = p_comment_id and c.poll_id = target_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
  end if;

  -- UNION (not UNION ALL) also makes malformed historic cycles terminate.
  with recursive descendants(id) as (
    select c.id from public.comments as c where c.id = p_comment_id and c.poll_id = target_poll_id
    union
    select child.id from public.comments as child
    join descendants as parent on child.parent_id = parent.id::text
    where child.poll_id = target_poll_id
  )
  select array_agg(id) into comment_ids from descendants;

  update public.content_reports as r
  set status = 'resolved', action = 'delete', handled_at = now()
  where r.target_type = 'comment' and r.target_id = any(comment_ids::text[]) and r.status = 'pending';

  delete from public.comment_reactions as cr where cr.comment_id = any(comment_ids::text[]);
  delete from public.comments as c where c.id = any(comment_ids);
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('deleted_count', deleted_count);
end;
$$;

revoke all on function public.delete_comment_with_dependents(uuid) from public, anon, authenticated;
grant execute on function public.delete_comment_with_dependents(uuid) to service_role;

create or replace function public.delete_poll_with_dependents(p_poll_id text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  current_image_paths jsonb;
begin
  if p_poll_id is null or btrim(p_poll_id) = '' or char_length(p_poll_id) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_POLL_INPUT';
  end if;
  select p.option_image_paths into current_image_paths
  from public.polls as p where p.id = p_poll_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'POLL_NOT_FOUND';
  end if;

  if left(p_poll_id, 9) = 'official_' then
    insert into public.deleted_official_polls (poll_id)
    values (p_poll_id) on conflict (poll_id) do nothing;
  end if;

  update public.content_reports as r
  set status = 'resolved', action = 'delete', handled_at = now()
  where r.poll_id = p_poll_id and r.status = 'pending';

  delete from public.comment_reactions as cr using public.comments as c
  where c.poll_id = p_poll_id and cr.comment_id = c.id::text;
  delete from public.comments as c where c.poll_id = p_poll_id;
  -- poll_votes and poll_ownership use the existing ON DELETE CASCADE.
  delete from public.polls as p where p.id = p_poll_id;
  -- The existing Route Handler removes validated Storage paths after commit.
  return current_image_paths;
end;
$$;

revoke all on function public.delete_poll_with_dependents(text) from public, anon, authenticated;
grant execute on function public.delete_poll_with_dependents(text) to service_role;

create or replace function public.get_content_report_queue(
  p_status text default 'pending',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  queue_result jsonb;
begin
  if p_status is null or p_status not in ('pending', 'handled', 'all')
    or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'INVALID_MODERATION_INPUT';
  end if;
  with grouped as (
    select r.target_type, r.target_id, min(r.poll_id) as poll_id,
           count(*) filter (where r.status = 'pending') as pending_count,
           count(*) as total_count, max(r.created_at) as latest_report_at,
           case when bool_or(r.status = 'pending') then 'pending'
                else (array_agg(r.status order by r.created_at desc, r.id desc))[1] end as status,
           (array_agg(r.action order by r.handled_at desc nulls last, r.id desc))[1] as action,
           max(r.handled_at) as handled_at
    from public.content_reports as r group by r.target_type, r.target_id
  ), page as (
    select g.*, row_number() over (order by g.latest_report_at desc, g.target_type, g.target_id) as position
    from grouped as g
    where p_status = 'all'
      or (p_status = 'pending' and g.pending_count > 0)
      or (p_status = 'handled' and g.pending_count = 0)
    order by g.latest_report_at desc, g.target_type, g.target_id
    limit p_limit + 1 offset p_offset
  ), enriched as (
    select q.*, jsonb_build_object(
      'text', case when q.target_type = 'poll' then p.title else c.text end,
      'parent_id', c.parent_id,
      'is_hidden', case when q.target_type = 'poll' then coalesce(p.is_hidden, false) else coalesce(c.is_hidden, false) end,
      'exists', case when q.target_type = 'poll' then p.id is not null else c.id is not null end,
      'reply_count', case when q.target_type = 'comment' and c.id is not null then (
        with recursive descendants(id) as (
          select c.id
          union
          select child.id from public.comments as child
          join descendants as parent on child.parent_id = parent.id::text
          where child.poll_id = q.poll_id
        ) select count(*) - 1 from descendants
      ) else 0 end,
      'poll_title', p.title
    ) as preview,
    coalesce((
      select jsonb_agg(jsonb_build_object('reason', reason_counts.reason, 'count', reason_counts.count) order by reason_counts.reason)
      from (
        select r.reason, count(*) as count from public.content_reports as r
        where r.target_type = q.target_type and r.target_id = q.target_id group by r.reason
      ) as reason_counts
    ), '[]'::jsonb) as reasons,
    coalesce((
      select jsonb_agg(jsonb_build_object('detail', recent_details.detail, 'created_at', recent_details.created_at)
        order by recent_details.created_at desc, recent_details.id desc)
      from (
        select r.id, r.detail, r.created_at from public.content_reports as r
        where r.target_type = q.target_type and r.target_id = q.target_id
          and r.reason = 'other' and nullif(btrim(r.detail), '') is not null
        order by r.created_at desc, r.id desc limit 5
      ) as recent_details
    ), '[]'::jsonb) as details
    from page as q
    left join public.polls as p on p.id = q.poll_id
    left join public.comments as c on q.target_type = 'comment' and c.id::text = q.target_id
  )
  select jsonb_build_object(
    'data', coalesce(jsonb_agg(jsonb_build_object(
      'target_type', e.target_type, 'target_id', e.target_id, 'poll_id', e.poll_id,
      'pending_count', e.pending_count, 'total_count', e.total_count, 'reasons', e.reasons,
      'details', e.details,
      'latest_report_at', e.latest_report_at, 'status', e.status, 'action', e.action,
      'handled_at', e.handled_at, 'preview', e.preview
    ) order by e.latest_report_at desc, e.target_type, e.target_id)
      filter (where e.position <= p_offset + p_limit), '[]'::jsonb),
    'hasMore', count(*) > p_limit
  ) into queue_result from enriched as e;
  return queue_result;
end;
$$;

revoke all on function public.get_content_report_queue(text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_content_report_queue(text, integer, integer) to service_role;

-- The vote/owner functions below keep their existing logic and add a hidden
-- check after the shared poll row lock, before any writes or no-op returns.
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

  if exists (select 1 from public.polls as p where p.id = p_poll_id and p.is_hidden) then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
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
from public, anon, authenticated, service_role;


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

  if exists (select 1 from public.polls as p where p.id = p_poll_id and p.is_hidden) then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
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

  if exists (select 1 from public.polls as p where p.id = p_poll_id and p.is_hidden) then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
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

  if exists (select 1 from public.polls as p where p.id = p_poll_id and p.is_hidden) then
    raise exception using errcode = 'P0002', message = 'CONTENT_NOT_AVAILABLE';
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

comment on table public.content_reports is
  'Private, server-only content reports; anonymous credentials are hashed and report history survives deletion.';
comment on table public.deleted_official_polls is
  'Server-only content-free tombstones prevent deleted official polls returning via static fallback.';
comment on function public.moderate_report_target(text, text, text) is
  'Service-only manual visibility changes and report handling under the shared poll lock.';
comment on function public.delete_comment_with_dependents(uuid) is
  'Service-only atomic deletion of one comment, its descendant replies and their reactions.';
notify pgrst, 'reload schema';
