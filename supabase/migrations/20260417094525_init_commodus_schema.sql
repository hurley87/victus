-- Commodus MVP initial schema
-- Ref: docs/mvp.md § Data Model
--
-- Conventions:
--   * All PKs are uuid, default gen_random_uuid() (built-in in PG17).
--   * All timestamps are timestamptz, default now().
--   * All monetary/quantity values are numeric(38, 18) — never float.
--   * Status columns use CHECK constraints over text (easier to evolve than enums).
--   * RLS is enabled on every table with NO policies: anon/authenticated are denied
--     by default; the service role bypasses RLS and is the only writer in MVP.
--   * Idempotency keys are enforced with UNIQUE constraints (cast_hash, execution_id).

-- =========================================================================
-- Helpers
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- users + farcaster_accounts
-- =========================================================================

create table public.users (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create table public.farcaster_accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  fid            bigint not null unique,
  username       text,
  display_name   text,
  pfp_url        text,
  verifications  jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index farcaster_accounts_user_id_idx on public.farcaster_accounts(user_id);
create trigger farcaster_accounts_set_updated_at
  before update on public.farcaster_accounts
  for each row execute function public.set_updated_at();

-- =========================================================================
-- arena_wallets + wallet_policies
-- =========================================================================

create table public.arena_wallets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references public.users(id) on delete cascade,
  wallet_address    text not null unique,
  privy_wallet_id   text not null unique,
  status            text not null default 'active'
                    check (status in ('active', 'closed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger arena_wallets_set_updated_at
  before update on public.arena_wallets
  for each row execute function public.set_updated_at();

create table public.wallet_policies (
  id                   uuid primary key default gen_random_uuid(),
  wallet_id            uuid not null unique references public.arena_wallets(id) on delete cascade,
  max_trade_usdc       numeric(38, 18) not null default 10,
  max_trades_per_day   integer not null default 10,
  wallet_cap_usdc      numeric(38, 18) not null default 50,
  max_slippage_bps     integer not null default 100,
  max_price_impact_bps integer not null default 300,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger wallet_policies_set_updated_at
  before update on public.wallet_policies
  for each row execute function public.set_updated_at();

-- =========================================================================
-- asset_whitelist
-- =========================================================================

create table public.asset_whitelist (
  id              uuid primary key default gen_random_uuid(),
  symbol          text not null unique,
  name            text not null,
  address         text not null unique, -- Base mainnet address (lowercased; checksum in app layer)
  decimals        smallint not null,
  is_tradable     boolean not null default true,
  is_blocklisted  boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint asset_whitelist_blocklist_excludes_tradable
    check (not (is_tradable and is_blocklisted))
);

create trigger asset_whitelist_set_updated_at
  before update on public.asset_whitelist
  for each row execute function public.set_updated_at();

-- =========================================================================
-- cast_commands (webhook landing table; cast_hash is THE idempotency key)
-- =========================================================================

create table public.cast_commands (
  id              uuid primary key default gen_random_uuid(),
  fid             bigint not null,
  cast_hash       text not null unique,
  text            text not null,
  parsed_action   text check (parsed_action in ('buy', 'sell', 'status')),
  parsed_symbol   text,
  parsed_amount   numeric(38, 18),   -- buy: USDC in
  parsed_percent  integer,           -- sell: 1..100
  status          text not null default 'received'
                  check (status in ('received', 'parsed', 'validated', 'quoted',
                                    'executing', 'executed', 'failed', 'rejected')),
  error_reason    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index cast_commands_fid_created_at_idx on public.cast_commands(fid, created_at desc);
create index cast_commands_status_idx on public.cast_commands(status)
  where status not in ('executed', 'failed', 'rejected');

create trigger cast_commands_set_updated_at
  before update on public.cast_commands
  for each row execute function public.set_updated_at();

-- =========================================================================
-- trade_intents
-- =========================================================================

create table public.trade_intents (
  id               uuid primary key default gen_random_uuid(),
  cast_command_id  uuid not null unique references public.cast_commands(id) on delete cascade,
  wallet_id        uuid not null references public.arena_wallets(id) on delete cascade,
  action           text not null check (action in ('buy', 'sell')),
  asset_symbol     text not null references public.asset_whitelist(symbol),
  amount_type      text not null check (amount_type in ('usdc_in', 'percent_out')),
  amount_value     numeric(38, 18) not null,
  status           text not null default 'pending'
                   check (status in ('pending', 'validated', 'quoted', 'executing',
                                     'executed', 'failed', 'rejected')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index trade_intents_wallet_id_idx on public.trade_intents(wallet_id, created_at desc);

create trigger trade_intents_set_updated_at
  before update on public.trade_intents
  for each row execute function public.set_updated_at();

-- =========================================================================
-- trade_executions (chain-layer idempotency via execution_id)
-- =========================================================================

create table public.trade_executions (
  id                     uuid primary key default gen_random_uuid(),
  trade_intent_id        uuid not null unique references public.trade_intents(id) on delete cascade,
  execution_id           text not null unique, -- deterministic from cast_hash
  tx_hash                text unique,
  execution_price_usdc   numeric(38, 18),
  quantity               numeric(38, 18),
  notional_usdc          numeric(38, 18),
  fees_usdc              numeric(38, 18),
  status                 text not null default 'pending'
                         check (status in ('pending', 'submitted', 'confirmed',
                                           'reverted', 'failed')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  confirmed_at           timestamptz
);

create index trade_executions_status_idx on public.trade_executions(status)
  where status in ('pending', 'submitted');

create trigger trade_executions_set_updated_at
  before update on public.trade_executions
  for each row execute function public.set_updated_at();

-- =========================================================================
-- lots + lot_closures (FIFO accounting)
-- =========================================================================

create table public.lots (
  id                      uuid primary key default gen_random_uuid(),
  wallet_id               uuid not null references public.arena_wallets(id) on delete cascade,
  asset_symbol            text not null references public.asset_whitelist(symbol),
  initial_quantity        numeric(38, 18) not null check (initial_quantity > 0),
  remaining_quantity      numeric(38, 18) not null check (remaining_quantity >= 0),
  avg_cost_usdc           numeric(38, 18) not null check (avg_cost_usdc >= 0),
  opening_execution_id    uuid not null unique references public.trade_executions(id) on delete restrict,
  opened_at               timestamptz not null default now(),
  closed_at               timestamptz,
  updated_at              timestamptz not null default now()
);

-- Partial index: the FIFO query is always "oldest open lot for (wallet, symbol)".
create index lots_open_fifo_idx
  on public.lots(wallet_id, asset_symbol, opened_at)
  where remaining_quantity > 0;

create trigger lots_set_updated_at
  before update on public.lots
  for each row execute function public.set_updated_at();

create table public.lot_closures (
  id                       uuid primary key default gen_random_uuid(),
  lot_id                   uuid not null references public.lots(id) on delete cascade,
  closing_execution_id     uuid not null references public.trade_executions(id) on delete restrict,
  quantity_closed          numeric(38, 18) not null check (quantity_closed > 0),
  avg_cost_usdc_at_close   numeric(38, 18) not null,
  realized_pnl_usdc        numeric(38, 18) not null,
  realized_return_pct      numeric(38, 18) not null,
  closed_at                timestamptz not null default now(),
  constraint lot_closures_lot_execution_unique
    unique (lot_id, closing_execution_id)
);

create index lot_closures_closing_execution_idx
  on public.lot_closures(closing_execution_id);

-- =========================================================================
-- positions (materialized summary per wallet+symbol)
-- =========================================================================

create table public.positions (
  id             uuid primary key default gen_random_uuid(),
  wallet_id      uuid not null references public.arena_wallets(id) on delete cascade,
  asset_symbol   text not null references public.asset_whitelist(symbol),
  quantity       numeric(38, 18) not null default 0,
  avg_cost_usdc  numeric(38, 18) not null default 0,
  updated_at     timestamptz not null default now(),
  constraint positions_wallet_symbol_unique unique (wallet_id, asset_symbol)
);

create trigger positions_set_updated_at
  before update on public.positions
  for each row execute function public.set_updated_at();

-- =========================================================================
-- user_stats (all-time, not shown in MVP UI)
-- =========================================================================

create table public.user_stats (
  user_id                  uuid primary key references public.users(id) on delete cascade,
  total_points             integer not null default 0,
  total_realized_pnl_usdc  numeric(38, 18) not null default 0,
  months_active            integer not null default 0,
  updated_at               timestamptz not null default now()
);

create trigger user_stats_set_updated_at
  before update on public.user_stats
  for each row execute function public.set_updated_at();

-- =========================================================================
-- reward_epochs
-- =========================================================================

create table public.reward_epochs (
  id                   uuid primary key default gen_random_uuid(),
  month                text not null unique check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status               text not null default 'pending_snapshot'
                       check (status in ('pending_snapshot', 'snapshot_ready',
                                         'distributed', 'partial')),
  pool_glory_amount    numeric(38, 18),
  snapshot_at          timestamptz,
  distributed_at       timestamptz,
  airdrop_tx_hashes    jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger reward_epochs_set_updated_at
  before update on public.reward_epochs
  for each row execute function public.set_updated_at();

-- =========================================================================
-- Row-Level Security
-- =========================================================================
-- Enable RLS on every table with NO policies: denies anon + authenticated.
-- Service role bypasses RLS. This matches the MVP posture: server is the
-- sole writer; reads go through API routes using the service role key.

alter table public.users                   enable row level security;
alter table public.farcaster_accounts      enable row level security;
alter table public.arena_wallets           enable row level security;
alter table public.wallet_policies         enable row level security;
alter table public.asset_whitelist         enable row level security;
alter table public.cast_commands           enable row level security;
alter table public.trade_intents           enable row level security;
alter table public.trade_executions        enable row level security;
alter table public.lots                    enable row level security;
alter table public.lot_closures            enable row level security;
alter table public.positions               enable row level security;
alter table public.user_stats              enable row level security;
alter table public.reward_epochs           enable row level security;

-- =========================================================================
-- Seed: asset_whitelist
-- =========================================================================
-- Canonical Base mainnet addresses (lowercase). App layer should checksum
-- when comparing against user input.

insert into public.asset_whitelist (symbol, name, address, decimals, is_tradable, is_blocklisted)
values
  ('USDC',    'USD Coin',           '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 6,  false, false),
  ('WETH',    'Wrapped Ether',      '0x4200000000000000000000000000000000000006', 18, true,  false),
  ('AERO',    'Aerodrome Finance',  '0x940181a94a35a4569e4529a3cdfb74e38fd98631', 18, true,  false),
  ('DEGEN',   'Degen',              '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', 18, true,  false),
  ('VIRTUAL', 'Virtuals Protocol',  '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', 18, true,  false);

-- GLORY is blocklisted at parse time. Address is set to a sentinel zero
-- address until the Clanker launch; update via `update asset_whitelist ...`.
insert into public.asset_whitelist (symbol, name, address, decimals, is_tradable, is_blocklisted)
values
  ('GLORY', 'Glory', '0x0000000000000000000000000000000000000000', 18, false, true);
