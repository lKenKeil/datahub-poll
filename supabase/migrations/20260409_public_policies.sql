alter table public.polls enable row level security;
alter table public.comments enable row level security;

drop policy if exists "Public read polls" on public.polls;
drop policy if exists "Public insert polls" on public.polls;
drop policy if exists "Public update polls" on public.polls;

create policy "Public read polls"
on public.polls
for select
to anon, authenticated
using (true);

create policy "Public insert polls"
on public.polls
for insert
to anon, authenticated
with check (true);

create policy "Public update polls"
on public.polls
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Public read comments" on public.comments;
drop policy if exists "Public insert comments" on public.comments;

create policy "Public read comments"
on public.comments
for select
to anon, authenticated
using (true);

create policy "Public insert comments"
on public.comments
for insert
to anon, authenticated
with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.polls to anon, authenticated;
grant select, insert on public.comments to anon, authenticated;
