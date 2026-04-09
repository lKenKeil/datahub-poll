create table if not exists public.official_sources (
  id text primary key,
  name text not null,
  homepage_url text,
  license text,
  country_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.official_statistics (
  id text primary key,
  source_id text not null references public.official_sources(id) on delete restrict,
  category text not null,
  title text not null,
  summary text,
  source_url text not null,
  methodology text,
  sample_size integer,
  observed_at date,
  published_at date,
  confidence_note text,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  is_verified boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists official_statistics_source_id_idx on public.official_statistics (source_id);
create index if not exists official_statistics_category_idx on public.official_statistics (category);
create index if not exists official_statistics_observed_at_idx on public.official_statistics (observed_at desc);

alter table public.official_sources enable row level security;
alter table public.official_statistics enable row level security;

drop policy if exists "Public read official_sources" on public.official_sources;
drop policy if exists "Public read official_statistics" on public.official_statistics;

create policy "Public read official_sources"
on public.official_sources
for select
to anon, authenticated
using (true);

create policy "Public read official_statistics"
on public.official_statistics
for select
to anon, authenticated
using (true);

grant select on public.official_sources to anon, authenticated;
grant select on public.official_statistics to anon, authenticated;
