-- Deterministic scheduled lore casts for Commodus Season 1.

create table public.commodus_lore_posts (
  id              uuid primary key default gen_random_uuid(),
  season          integer not null,
  day             integer not null check (day between 1 and 30),
  text            text not null,
  status          text not null default 'queued'
                  check (status in ('queued', 'posting', 'posted', 'failed', 'skipped')),
  scheduled_for   date null,
  scheduled_at    timestamptz null,
  cast_hash       text null unique,
  idempotency_key text not null unique,
  error           text null,
  posted_at       timestamptz null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint commodus_lore_posts_season_day_key unique (season, day),
  constraint commodus_lore_posts_text_length check (char_length(text) <= 320)
);

create index commodus_lore_posts_status_idx
  on public.commodus_lore_posts(status);

create index commodus_lore_posts_season_day_idx
  on public.commodus_lore_posts(season, day);

create index commodus_lore_posts_scheduled_for_idx
  on public.commodus_lore_posts(scheduled_for);

create index commodus_lore_posts_scheduled_at_idx
  on public.commodus_lore_posts(scheduled_at);

create unique index commodus_lore_posts_one_attempt_per_date_idx
  on public.commodus_lore_posts(scheduled_for)
  where scheduled_for is not null
    and status in ('posting', 'posted', 'failed', 'skipped');

create trigger commodus_lore_posts_set_updated_at
  before update on public.commodus_lore_posts
  for each row execute function public.set_updated_at();

alter table public.commodus_lore_posts enable row level security;
