-- Run after the moderation migration as the database owner. All fixtures and
-- mutations are rolled back; this script must not be run with a committing
-- wrapper. Assertions also execute under the real API roles, not just postgres.
begin;
set local role service_role;

do $$
#variable_conflict use_variable
declare
  poll_id text := 'moderation_sql_test_' || gen_random_uuid()::text;
  parent_id uuid := gen_random_uuid();
  reply_id uuid := gen_random_uuid();
  grandchild_id uuid := gen_random_uuid();
  voter_id text := gen_random_uuid()::text;
  reporter_hash text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  report_result jsonb;
  queue_result jsonb;
  current_poll jsonb;
begin
  perform set_config('askio_test.poll_id', poll_id, true);
  perform set_config('askio_test.parent_id', parent_id::text, true);
  perform set_config('askio_test.reply_id', reply_id::text, true);
  perform set_config('askio_test.grandchild_id', grandchild_id::text, true);
  perform set_config('askio_test.voter_id', voter_id, true);
  perform public.create_owned_poll(
    poll_id, '모더레이션 검증 질문', '커뮤니티', '["첫 번째", "두 번째"]'::jsonb,
    '[0,0]'::jsonb, 0, null, null,
    md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), 'first_vote', null, null
  );
  insert into public.comments (id, poll_id, text, user_name)
  values (parent_id, poll_id, '숨길 부모 원문', '검증 사용자');
  insert into public.comments (id, poll_id, parent_id, text, user_name)
  values (reply_id, poll_id, parent_id::text, '공개 답글', '검증 사용자');
  insert into public.comments (id, poll_id, parent_id, text, user_name)
  values (grandchild_id, poll_id, reply_id::text, '하위 답글', '검증 사용자');

  perform public.increment_poll_vote(poll_id, 0, voter_id);
  perform public.change_poll_vote(poll_id, 1, voter_id);
  report_result := public.submit_content_report('poll', poll_id, reporter_hash, 'spam', null);
  if (report_result ->> 'duplicate')::boolean then raise exception 'First report unexpectedly duplicate'; end if;
  report_result := public.submit_content_report('poll', poll_id, reporter_hash, 'spam', null);
  if not (report_result ->> 'duplicate')::boolean then raise exception 'Duplicate report was not suppressed'; end if;
  perform public.submit_content_report('poll', poll_id, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), 'privacy', null);
  perform public.submit_content_report('comment', upper(parent_id::text), reporter_hash, 'other', '관리자 전용 설명');
  perform public.submit_content_report('comment', reply_id::text, reporter_hash, 'harassment', null);
  perform public.submit_content_report('comment', grandchild_id::text, reporter_hash, 'inappropriate', null);
  if (select count(*) from public.content_reports as r where r.poll_id = poll_id) <> 5 then
    raise exception 'Report count/duplicate invariant failed';
  end if;
  if not exists (select 1 from public.content_reports as r where r.target_id = parent_id::text) then
    raise exception 'Comment UUID was not normalized';
  end if;
  queue_result := public.get_content_report_queue('pending', 100, 0);
  if queue_result::text like '%reporter_hash%' then raise exception 'Queue exposes reporter hash'; end if;
  if not exists (
    select 1 from jsonb_array_elements(queue_result -> 'data') as row(value)
    where row.value ->> 'target_id' = parent_id::text
      and (row.value #>> '{preview,reply_count}')::integer = 2
      and jsonb_array_length(row.value -> 'details') = 1
  ) then raise exception 'Queue preview/recursive reply count/detail failed'; end if;

  report_result := public.set_comment_reaction(parent_id, 'moderation-test', 'like');
  if report_result ->> 'likeCount' <> '1' or report_result ->> 'userReaction' <> 'like' then
    raise exception 'Reaction creation/count failed';
  end if;
  report_result := public.set_comment_reaction(parent_id, 'moderation-test', 'dislike');
  if report_result ->> 'likeCount' <> '0' or report_result ->> 'dislikeCount' <> '1' then
    raise exception 'Reaction replacement/count failed';
  end if;
  report_result := public.set_comment_reaction(parent_id, 'moderation-test', null);
  if report_result ->> 'dislikeCount' <> '0' or report_result ->> 'userReaction' is not null then
    raise exception 'Reaction removal/count failed';
  end if;
  perform public.set_comment_reaction(parent_id, 'moderation-test', 'like');
  perform public.set_comment_reaction(reply_id, 'moderation-test', 'like');
  perform public.set_comment_reaction(grandchild_id, 'moderation-test', 'dislike');
  perform public.moderate_report_target('comment', parent_id::text, 'hide');
  begin
    perform public.set_comment_reaction(parent_id, 'moderation-test', null);
    raise exception 'Hidden comment reaction removal was allowed';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    insert into public.comments (poll_id, parent_id, text, user_name)
    values (poll_id, parent_id::text, '숨긴 부모에 새 답글', '검증 사용자');
    raise exception 'Hidden parent accepted a reply';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;

  -- Hidden rows still participate in edit-lock comment existence checks.
  select to_jsonb(p) into current_poll from public.polls as p where p.id = poll_id;
  begin
    perform public.update_owned_poll(poll_id, '구조 변경 검증 질문', '커뮤니티', current_poll -> 'options', null, null, current_poll);
    raise exception 'Structural edit ignored votes/comments';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'POLL_STRUCTURE_LOCKED' then raise; end if;
  end;
end;
$$;

set local role anon;
do $$
begin
  if exists (select 1 from public.comments where id = current_setting('askio_test.parent_id')::uuid) then
    raise exception 'Public RLS exposed hidden comment';
  end if;
  if not exists (select 1 from public.comments where id = current_setting('askio_test.reply_id')::uuid) then
    raise exception 'Visible reply disappeared with hidden parent';
  end if;
  if exists (select 1 from public.comment_reactions where comment_id = current_setting('askio_test.parent_id')) then
    raise exception 'Public RLS exposed hidden comment reactions';
  end if;
  begin
    perform 1 from public.content_reports;
    raise exception 'Anon can read reports';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_content_report_queue();
    raise exception 'Anon can execute private queue RPC';
  exception when insufficient_privilege then null; end;
end;
$$;

set local role service_role;
do $$
#variable_conflict use_variable
declare
  poll_id text := current_setting('askio_test.poll_id');
  current_poll jsonb;
begin
  perform public.moderate_report_target('poll', poll_id, 'hide');
  select to_jsonb(p) into current_poll from public.polls as p where p.id = poll_id;
  if current_poll is null then raise exception 'Service role cannot read hidden poll'; end if;
  begin
    perform public.increment_poll_vote(poll_id, 0, gen_random_uuid()::text);
    raise exception 'Hidden poll accepted initial vote';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    perform public.change_poll_vote(poll_id, 1, current_setting('askio_test.voter_id'));
    raise exception 'Hidden poll accepted no-op revote';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    perform public.update_owned_poll(poll_id, current_poll ->> 'title', 'IT/테크', current_poll -> 'options', '설명만 수정', null, current_poll);
    raise exception 'Owner category-only edit bypassed hide';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    insert into public.comments (poll_id, text, user_name) values (poll_id, '숨긴 질문의 의견', '검증 사용자');
    raise exception 'Hidden poll accepted comment';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  begin
    perform public.set_comment_reaction(current_setting('askio_test.reply_id')::uuid, 'moderation-test', 'dislike');
    raise exception 'Hidden poll accepted reply reaction';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'CONTENT_NOT_AVAILABLE' then raise; end if;
  end;
  if (select count(*) from public.poll_votes as v where v.poll_id = poll_id) <> 1 then
    raise exception 'Rejected initial vote left a per-voter row';
  end if;
end;
$$;

set local role authenticated;
do $$
begin
  if exists (select 1 from public.polls where id = current_setting('askio_test.poll_id'))
    or exists (select 1 from public.comments where poll_id = current_setting('askio_test.poll_id')) then
    raise exception 'Authenticated RLS exposed hidden question/comments';
  end if;
  begin
    perform 1 from public.content_reports;
    raise exception 'Authenticated can read reports';
  exception when insufficient_privilege then null; end;
  begin
    update public.polls set is_hidden = false where id = current_setting('askio_test.poll_id');
    raise exception 'Authenticated can mutate moderation';
  exception when insufficient_privilege then null; end;
end;
$$;

set local role service_role;
do $$
#variable_conflict use_variable
declare
  poll_id text := current_setting('askio_test.poll_id');
  delete_result jsonb;
  official_id text := 'official_moderation_sql_test_' || gen_random_uuid()::text;
begin
  perform public.moderate_report_target('poll', poll_id, 'restore');
  perform public.moderate_report_target('comment', current_setting('askio_test.parent_id'), 'restore');
  perform public.change_poll_vote(poll_id, 0, current_setting('askio_test.voter_id'));
  delete_result := public.delete_comment_with_dependents(current_setting('askio_test.parent_id')::uuid);
  if (delete_result ->> 'deleted_count')::integer <> 3 then raise exception 'Subtree delete count failed'; end if;
  if exists (select 1 from public.comments as c where c.poll_id = poll_id)
    or exists (select 1 from public.comment_reactions as r where r.comment_id in (
      current_setting('askio_test.parent_id'), current_setting('askio_test.reply_id'), current_setting('askio_test.grandchild_id')
    )) then raise exception 'Subtree delete left child/reaction rows'; end if;
  if exists (select 1 from public.content_reports as r where r.poll_id = poll_id and r.status = 'pending') then
    raise exception 'Delete left pending reports';
  end if;
  perform public.delete_poll_with_dependents(poll_id);
  if exists (select 1 from public.polls as p where p.id = poll_id)
    or exists (select 1 from public.poll_ownership as o where o.poll_id = poll_id)
    or exists (select 1 from public.poll_votes as v where v.poll_id = poll_id) then
    raise exception 'Poll dependent cleanup failed';
  end if;
  if (select count(*) from public.content_reports as r where r.poll_id = poll_id) <> 5 then
    raise exception 'Report history did not survive deletion';
  end if;
  if exists (select 1 from public.deleted_official_polls as d where d.poll_id = poll_id) then
    raise exception 'Non-official deletion created a tombstone';
  end if;
  perform public.create_owned_poll(
    official_id, '공식 fallback 검증 질문', '커뮤니티', '["첫 번째", "두 번째"]'::jsonb,
    '[0,0]'::jsonb, 0, null, null,
    md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), 'first_vote', null, null
  );
  perform public.delete_poll_with_dependents(official_id);
  if not exists (select 1 from public.deleted_official_polls as d where d.poll_id = official_id) then
    raise exception 'Reportless official deletion lacks fallback tombstone';
  end if;
end;
$$;

rollback;
