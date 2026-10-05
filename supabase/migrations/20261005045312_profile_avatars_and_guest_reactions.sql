-- Apply manually after guest-comments migration; no existing reactions/votes rewritten.
alter table public.profiles
  add column if not exists avatar_source text not null default 'social',
  add column if not exists social_avatar_url text,
  add column if not exists uploaded_avatar_url text,
  add column if not exists uploaded_avatar_path text;
alter table public.profiles add constraint profiles_avatar_source_check
  check (avatar_source in ('default','social','uploaded'));
alter table public.profiles add constraint profiles_uploaded_avatar_path_check
  check (uploaded_avatar_path is null or uploaded_avatar_path ~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$');
create unique index profiles_uploaded_avatar_path_unique
on public.profiles(uploaded_avatar_path) where uploaded_avatar_path is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('profile-avatars','profile-avatars',true,2097152,array['image/webp'])
on conflict(id) do nothing;
-- Defense in depth even if another permissive Storage policy is introduced.
create policy "Avatar server writes only" on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'profile-avatars') with check (bucket_id <> 'profile-avatars');
-- Public URL reads are served by the public bucket; no public write/delete policy.

create or replace function public.change_profile_avatar(
  p_user_id uuid, p_source text, p_new_path text, p_new_url text, p_expected_path text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  profile_row public.profiles%rowtype;
  previous_path text;
begin
  if p_user_id is null or p_source is null or p_source not in ('default','social','uploaded') then
    raise exception using errcode='22023', message='INVALID_AVATAR_INPUT';
  end if;
  select p.* into profile_row from public.profiles p where p.id=p_user_id for update;
  if not found then raise exception using errcode='P0002',message='PROFILE_USER_NOT_FOUND'; end if;
  if profile_row.uploaded_avatar_path is distinct from p_expected_path then
    raise exception using errcode='P0001',message='AVATAR_CONFLICT';
  end if;
  -- Capture the provider image once before switching away; never fetch/delete it.
  if profile_row.avatar_source='social' and profile_row.social_avatar_url is null then
    profile_row.social_avatar_url := profile_row.avatar_url;
  end if;
  if p_new_path is not null then
    if p_source <> 'uploaded' or p_new_path !~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
      or p_new_url is null or char_length(p_new_url)>2048
      or p_new_url not like ('https://%/storage/v1/object/public/profile-avatars/' || p_new_path) then
      raise exception using errcode='22023',message='INVALID_AVATAR_INPUT';
    end if;
    previous_path := profile_row.uploaded_avatar_path;
    profile_row.uploaded_avatar_path := p_new_path;
    profile_row.uploaded_avatar_url := p_new_url;
  elsif p_new_url is not null then
    raise exception using errcode='22023',message='INVALID_AVATAR_INPUT';
  end if;
  if (p_source='social' and profile_row.social_avatar_url is null)
    or (p_source='uploaded' and profile_row.uploaded_avatar_url is null) then
    raise exception using errcode='22023',message='AVATAR_SOURCE_UNAVAILABLE';
  end if;
  update public.profiles p set
    avatar_source=p_source,
    avatar_url=case p_source when 'social' then profile_row.social_avatar_url when 'uploaded' then profile_row.uploaded_avatar_url else null end,
    social_avatar_url=profile_row.social_avatar_url,
    uploaded_avatar_path=profile_row.uploaded_avatar_path,
    uploaded_avatar_url=profile_row.uploaded_avatar_url
  where p.id=p_user_id returning p.* into profile_row;
  -- show_avatar stays untouched: uploading never opts a user into public display.
  return jsonb_build_object('profile',to_jsonb(profile_row),'previous_path',previous_path);
end;
$$;
revoke all on function public.change_profile_avatar(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.change_profile_avatar(uuid,text,text,text,text) to service_role;

-- Reuse the existing unique(comment_id,user_fingerprint) constraint. Namespace
-- verified new actors, preserving all legacy fingerprint rows and their counts.
create or replace function public.toggle_comment_reaction_with_actor(
  p_comment_id uuid,p_actor_key text,p_reaction text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  target_poll_id text;
  existing_reaction text;
  likes bigint;
  dislikes bigint;
begin
  if p_comment_id is null or p_actor_key is null
    or p_actor_key !~ '^(account:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|guest:[0-9a-f]{64})$'
    or p_reaction is null or p_reaction not in ('like','dislike') then
    raise exception using errcode='22023',message='INVALID_REACTION_INPUT';
  end if;
  select c.poll_id into target_poll_id from public.comments c where c.id=p_comment_id;
  -- Same poll-first ordering as moderation, then comment. All toggles for this
  -- poll serialize; count reads are in the same transaction, never client deltas.
  perform 1 from public.polls p where p.id=target_poll_id and not p.is_hidden for update;
  if not found then raise exception using errcode='P0002',message='CONTENT_NOT_AVAILABLE'; end if;
  perform 1 from public.comments c where c.id=p_comment_id and c.poll_id=target_poll_id and not c.is_hidden for update;
  if not found then raise exception using errcode='P0002',message='CONTENT_NOT_AVAILABLE'; end if;
  select cr.reaction into existing_reaction from public.comment_reactions cr
  where cr.comment_id=p_comment_id::text and cr.user_fingerprint=p_actor_key;
  if existing_reaction=p_reaction then
    delete from public.comment_reactions cr where cr.comment_id=p_comment_id::text and cr.user_fingerprint=p_actor_key;
    existing_reaction := null;
  else
    insert into public.comment_reactions(comment_id,user_fingerprint,reaction)
    values(p_comment_id::text,p_actor_key,p_reaction)
    on conflict(comment_id,user_fingerprint) do update set reaction=excluded.reaction,updated_at=now();
    existing_reaction := p_reaction;
  end if;
  select count(*) filter(where reaction='like'),count(*) filter(where reaction='dislike')
  into likes,dislikes from public.comment_reactions where comment_id=p_comment_id::text;
  return jsonb_build_object('likeCount',likes,'dislikeCount',dislikes,'userReaction',existing_reaction);
end;
$$;
revoke all on function public.toggle_comment_reaction_with_actor(uuid,text,text) from public,anon,authenticated;
grant execute on function public.toggle_comment_reaction_with_actor(uuid,text,text) to service_role;
-- Actor identifiers must not be readable via the public Data API either.
revoke select on public.comment_reactions from public,anon,authenticated;
revoke select(id,comment_id,user_fingerprint,reaction,created_at,updated_at) on public.comment_reactions from public,anon,authenticated;
-- Counts are read by the server only. No public row stream can reveal an actor.
notify pgrst,'reload schema';
