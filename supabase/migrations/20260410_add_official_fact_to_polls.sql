alter table public.polls
  add column if not exists official_fact text;
