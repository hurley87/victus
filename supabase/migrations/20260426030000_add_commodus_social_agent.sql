-- Commodus social agent: inbound casts, decision runs, memory tables, blocklist.
-- Ref: GitHub hurley87/victus#35 — RLS enabled, no policies (service-role writes only).

-- =========================================================================
-- commodus_casts — raw inbound + self-post evidence
-- =========================================================================

create table public.commodus_casts (
  id                 uuid primary key default gen_random_uuid(),
  hash               text not null unique,
  thread_hash        text,
  parent_hash        text,
  parent_author_fid  bigint,
  author_fid         bigint not null,
  text               text not null,
  source             text not null
                     check (source in ('webhook', 'manual', 'self')),
  raw_json           jsonb not null default '{}'::jsonb,
  first_seen_at      timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index commodus_casts_thread_hash_idx
  on public.commodus_casts(thread_hash);

create index commodus_casts_author_fid_first_seen_at_idx
  on public.commodus_casts(author_fid, first_seen_at desc);

create index commodus_casts_created_at_idx
  on public.commodus_casts(created_at desc);

alter table public.commodus_casts enable row level security;

-- =========================================================================
-- commodus_social_runs — one row per agent decision (idempotent by idem_key)
-- =========================================================================

create table public.commodus_social_runs (
  id                   uuid primary key default gen_random_uuid(),
  run_type             text not null,
  trigger_cast_hash    text,
  selected_cast_hash   text,
  action               text not null
                       check (action in ('reply', 'ignore', 'save_only', 'error')),
  score                numeric(38, 18),
  reason               text,
  risk_flags           jsonb not null default '[]'::jsonb,
  prompt_snapshot      jsonb not null default '{}'::jsonb,
  model_output         jsonb not null default '{}'::jsonb,
  posted_cast_hash     text,
  idem_key             text not null unique,
  created_at           timestamptz not null default now()
);

create index commodus_social_runs_created_at_idx
  on public.commodus_social_runs(created_at desc);

create index commodus_social_runs_action_created_at_idx
  on public.commodus_social_runs(action, created_at desc);

create index commodus_social_runs_selected_cast_hash_idx
  on public.commodus_social_runs(selected_cast_hash);

alter table public.commodus_social_runs enable row level security;

-- =========================================================================
-- commodus_thread_memory — per-thread rolling context
-- =========================================================================

create table public.commodus_thread_memory (
  thread_hash    text primary key,
  summary        text not null default '',
  last_cast_hash text,
  participants   jsonb not null default '[]'::jsonb
);

alter table public.commodus_thread_memory enable row level security;

-- =========================================================================
-- commodus_user_memory — per-Farcaster-user relationship lens
-- =========================================================================

create table public.commodus_user_memory (
  fid                  bigint primary key,
  summary              text not null default '',
  relationship         text not null default 'unknown'
                       check (relationship in ('ally', 'rival', 'unknown', 'muted')),
  last_interaction_at  timestamptz
);

alter table public.commodus_user_memory enable row level security;

-- =========================================================================
-- commodus_long_term_memory — durable facts / lore for the agent
-- =========================================================================

create table public.commodus_long_term_memory (
  id           uuid primary key default gen_random_uuid(),
  memory_type  text not null
               check (memory_type in ('lore', 'bit', 'rivalry', 'rule', 'event')),
  title        text not null,
  body         text not null,
  importance   integer not null default 0
);

alter table public.commodus_long_term_memory enable row level security;

-- =========================================================================
-- commodus_social_blocklist — FIDs the agent must not engage
-- =========================================================================

create table public.commodus_social_blocklist (
  fid     bigint primary key,
  reason  text not null
);

alter table public.commodus_social_blocklist enable row level security;
