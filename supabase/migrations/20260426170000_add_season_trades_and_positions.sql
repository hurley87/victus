-- Victus Games season ledger: per-trade rows and current position state.
-- Ref: docs/victus-games.md §4.4–4.5.

create table public.season_trades (
  id                   uuid primary key default gen_random_uuid(),
  season_id            uuid not null references public.seasons(id) on delete cascade,
  season_entry_id      uuid not null references public.season_entries(id) on delete cascade,
  user_id              uuid not null references public.users(id) on delete cascade,
  wallet_id            uuid not null references public.arena_wallets(id) on delete cascade,
  trade_execution_id   uuid not null references public.trade_executions(id) on delete cascade,
  action               text not null check (action in ('buy', 'sell')),
  token_symbol         text not null,
  token_address        text not null,
  notional_usdc        numeric(38, 18) not null,
  token_amount         numeric(78, 18) not null,
  execution_price      numeric(38, 18) not null,
  fees_usdc            numeric(38, 18) not null default 0,
  tx_hash              text,
  status               text not null default 'executed'
                       check (status in ('pending', 'executed', 'failed')),
  created_at           timestamptz not null default now()
);

-- One season_trade per trade_executions row — used for idempotent applySeasonTrade.
create unique index season_trades_trade_execution_idx
  on public.season_trades (trade_execution_id);

create index season_trades_entry_idx
  on public.season_trades (season_entry_id);

create index season_trades_season_user_idx
  on public.season_trades (season_id, user_id);

alter table public.season_trades enable row level security;

create table public.season_positions (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null references public.seasons(id) on delete cascade,
  season_entry_id       uuid not null references public.season_entries(id) on delete cascade,
  user_id               uuid not null references public.users(id) on delete cascade,
  token_symbol          text not null,
  token_address         text not null,
  token_amount          numeric(78, 18) not null default 0,
  average_entry_price   numeric(38, 18) not null default 0,
  updated_at            timestamptz not null default now()
);

create unique index season_positions_entry_symbol_idx
  on public.season_positions (season_entry_id, token_symbol);

create index season_positions_season_user_idx
  on public.season_positions (season_id, user_id);

create trigger season_positions_set_updated_at
  before update on public.season_positions
  for each row execute function public.set_updated_at();

alter table public.season_positions enable row level security;
