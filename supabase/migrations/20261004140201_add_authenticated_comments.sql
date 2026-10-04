-- Apply before deploying authenticated comment writes. No old rows are
-- backfilled, and no vote, ownership, moderation or reaction RPC is changed.
alter table public.comments
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists comments_user_id_idx
on public.comments (user_id) where user_id is not null;

comment on column public.comments.user_id is
  'Verified Auth author for new comments; historical anonymous comments remain null.';

-- Existing read-only public RLS and service-role-only mutation grants remain.
notify pgrst, 'reload schema';
