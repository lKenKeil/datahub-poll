alter table public.comments
  add column if not exists parent_id text;

create index if not exists comments_poll_id_idx on public.comments (poll_id);
create index if not exists comments_parent_id_idx on public.comments (parent_id);

create table if not exists public.comment_reactions (
  id bigint generated always as identity primary key,
  comment_id text not null,
  user_fingerprint text not null,
  reaction text not null check (reaction in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comment_id, user_fingerprint)
);

create index if not exists comment_reactions_comment_id_idx on public.comment_reactions (comment_id);
create index if not exists comment_reactions_user_fingerprint_idx on public.comment_reactions (user_fingerprint);

alter table public.comment_reactions enable row level security;

drop policy if exists "Public read comment reactions" on public.comment_reactions;
drop policy if exists "Public insert comment reactions" on public.comment_reactions;
drop policy if exists "Public update comment reactions" on public.comment_reactions;
drop policy if exists "Public delete comment reactions" on public.comment_reactions;

create policy "Public read comment reactions"
on public.comment_reactions
for select
to anon, authenticated
using (true);

create policy "Public insert comment reactions"
on public.comment_reactions
for insert
to anon, authenticated
with check (true);

create policy "Public update comment reactions"
on public.comment_reactions
for update
to anon, authenticated
using (true)
with check (true);

create policy "Public delete comment reactions"
on public.comment_reactions
for delete
to anon, authenticated
using (true);

grant select, insert, update, delete on public.comment_reactions to anon, authenticated;
