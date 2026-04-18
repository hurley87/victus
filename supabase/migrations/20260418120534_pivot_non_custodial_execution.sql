-- Non-custodial execution pivot
--
-- Commodus MVP moves from custodial Privy server wallets + operator-seeded
-- gas to user-signed execution via the Farcaster Mini App SDK's `swapToken`
-- action. Users sign and pay gas from their own Farcaster-verified wallet;
-- the server never holds keys.
--
-- This migration:
--   1. `arena_wallets`   - drops `privy_wallet_id`, adds `source`
--   2. `trade_executions`- drops `execution_id` (the reserve-before-submit
--                          idempotency key); `tx_hash` unique is now the
--                          chain-layer idempotency key. Tightens `status`
--                          CHECK to the reachable set.
--   3. `cast_commands`   - widens `status` CHECK to add `awaiting_swap`
--                          (intent reply posted, waiting for user tap+tx)
--                          and `abandoned` (TTL expired); drops unreachable
--                          `quoted`, `executing`.
--
-- No production data exists yet, so this is purely additive DDL with no
-- data migration path. Safe to apply against any fresh environment.

-- =========================================================================
-- arena_wallets
-- =========================================================================

alter table public.arena_wallets
  drop column privy_wallet_id;

alter table public.arena_wallets
  add column source text not null default 'user_verified'
    check (source in ('user_verified'));

-- =========================================================================
-- trade_executions
-- =========================================================================

alter table public.trade_executions
  drop column execution_id;

alter table public.trade_executions
  alter column status drop default;

alter table public.trade_executions
  drop constraint trade_executions_status_check;

alter table public.trade_executions
  add constraint trade_executions_status_check
    check (status in ('confirmed', 'reverted', 'failed'));

-- The old partial index targeted the reserve-before-submit lifecycle
-- (`status in ('pending', 'submitted')`). Those states no longer exist.
drop index if exists public.trade_executions_status_idx;

-- =========================================================================
-- cast_commands
-- =========================================================================

alter table public.cast_commands
  drop constraint cast_commands_status_check;

alter table public.cast_commands
  add constraint cast_commands_status_check
    check (status in ('received', 'parsed', 'validated', 'awaiting_swap',
                      'executed', 'failed', 'rejected', 'abandoned'));

-- Recreate the non-terminal partial index so `abandoned` joins the excluded
-- terminal set. Without this, abandoned rows accumulate in the index that
-- exists only to accelerate "pick up active work" queries.
drop index if exists public.cast_commands_status_idx;
create index cast_commands_status_idx on public.cast_commands(status)
  where status not in ('executed', 'failed', 'rejected', 'abandoned');
