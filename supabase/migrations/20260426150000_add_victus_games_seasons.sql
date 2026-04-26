-- Victus Games season foundation: seasons, season_tokens, season_entries.
-- Ref: docs/victus-games.md §4.1–4.3.

create table public.seasons (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  status                 text not null default 'upcoming'
                         check (status in ('upcoming', 'active', 'settled')),
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  starting_balance_usdc  numeric(38, 18) not null default 10,
  max_trades             int not null default 5,
  min_trade_size_usdc    numeric(38, 18) not null default 0.5,
  settled_at             timestamptz,
  created_at             timestamptz not null default now()
);

-- Only one active season at a time.
create unique index seasons_one_active_idx
  on public.seasons (status)
  where status = 'active';

alter table public.seasons enable row level security;

create table public.season_tokens (
  id                  uuid primary key default gen_random_uuid(),
  season_id           uuid not null references public.seasons(id) on delete cascade,
  token_symbol        text not null,
  token_address       text not null,
  chain_id            int not null default 8453,
  decimals            int not null,
  is_active           boolean not null default true,
  closing_price_usdc  numeric(38, 18),
  created_at          timestamptz not null default now()
);

create unique index season_tokens_season_symbol_idx
  on public.season_tokens (season_id, token_symbol);

alter table public.season_tokens enable row level security;

create table public.season_entries (
  id                            uuid primary key default gen_random_uuid(),
  season_id                     uuid not null references public.seasons(id) on delete cascade,
  user_id                       uuid not null references public.users(id) on delete cascade,
  wallet_id                     uuid not null references public.arena_wallets(id) on delete cascade,
  starting_balance_usdc         numeric(38, 18) not null default 10,
  cash_remaining_usdc           numeric(38, 18) not null default 10,
  trades_used                   int not null default 0,
  max_trades                    int not null default 5,
  has_qualifying_trade          boolean not null default false,
  status                        text not null default 'active'
                                check (status in ('active', 'settled', 'disqualified')),
  settled_portfolio_value_usdc  numeric(38, 18),
  settled_return_pct            numeric(38, 18),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create unique index season_entries_season_user_idx
  on public.season_entries (season_id, user_id);

create index season_entries_user_id_idx
  on public.season_entries (user_id);

create trigger season_entries_set_updated_at
  before update on public.season_entries
  for each row execute function public.set_updated_at();

alter table public.season_entries enable row level security;
