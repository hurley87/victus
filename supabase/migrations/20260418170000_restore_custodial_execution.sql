-- Restore custodial execution
--
-- The 20260418120534 pivot to non-custodial (Farcaster Mini App SDK
-- `swapToken`) was itself a fallback from the 20260418* spike that proved
-- Farcaster Snaps cannot return `tx_hash` from `swap_token` actions
-- (see docs/spikes/snap-tx-hash.md, commit 521cd9e6, unmerged). After that
-- spike, the product was re-evaluated and pivoted again — this time to
-- custodial Privy server wallets. Rationale in docs/mvp.md § Alternatives
-- considered:
--   * the autonomous-agent product thesis requires a signing surface
--     Commodus controls;
--   * Privy's server-wallet API returns tx_hash synchronously, eliminating
--     the capture ambiguity that killed the Snap path;
--   * fee-on-swap and yield-on-idle revenue surfaces only exist when
--     Commodus holds the balance;
--   * TEE execution in AWS Nitro Enclaves preserves the custody posture
--     without exposing raw keys to the application server.
--
-- This migration restores the pre-pivot custodial schema and parameterizes
-- it for:
--
--   * Privy server-wallet custody (TEE-executed, keys non-extractable)
--   * Lazy wallet provisioning at gladiator-mint time
--   * Gladiator soft-mint (DB row, no on-chain NFT in MVP) gated by
--     a minimum USDC deposit
--   * Fee-on-swap revenue (0.5%, $0.05 min) that refills Privy's gas
--     sponsorship balance and contributes to the operator treasury
--   * Privy sponsored gas (arena wallets never hold ETH)
--
-- No production data exists yet, so this is purely additive DDL with no
-- data migration path. Safe to apply against any fresh environment.
--
-- See docs/mvp.md § Gladiator Mint, § Execution Rules, § Durable Execution
-- Architecture, and § Data Model for the full spec.

-- =========================================================================
-- arena_wallets — restore privy_wallet_id, drop the non-custodial `source`
-- =========================================================================

alter table public.arena_wallets
  drop column source;

alter table public.arena_wallets
  add column privy_wallet_id text not null unique;

comment on column public.arena_wallets.privy_wallet_id is
  'Privy canonical identifier used when calling the server-wallet API. '
  'Key material is TEE-custodied in AWS Nitro Enclaves and not extractable '
  'by the application.';

-- =========================================================================
-- gladiators — new table for the mint ritual + funding gate
-- =========================================================================

create table public.gladiators (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references public.users(id) on delete cascade,
  name        text not null unique,
  status      text not null default 'pending_funding'
              check (status in ('pending_funding', 'alive')),
  minted_at   timestamptz not null default now(),
  funded_at   timestamptz,
  updated_at  timestamptz not null default now(),
  -- 3-32 chars, ASCII letters/numbers/spaces/hyphens, must start with
  -- an alphanumeric. Globally unique: first mint wins the name.
  constraint gladiators_name_charset
    check (name ~ '^[A-Za-z0-9][A-Za-z0-9 \-]{2,31}$')
);

comment on table public.gladiators is
  'A user''s gladiator identity in the arena. Soft-minted (no on-chain '
  'NFT in MVP). status=''alive'' is the gate for trading — enforced by the '
  'policy_validate workflow step.';

create index gladiators_status_idx on public.gladiators(status)
  where status = 'pending_funding';

create trigger gladiators_set_updated_at
  before update on public.gladiators
  for each row execute function public.set_updated_at();

alter table public.gladiators enable row level security;

-- =========================================================================
-- wallet_policies — add fee-on-swap + mint-deposit parameters
-- =========================================================================

alter table public.wallet_policies
  add column swap_fee_bps          integer         not null default 50,
  add column swap_fee_min_usdc     numeric(38, 18) not null default 0.05,
  add column min_mint_deposit_usdc numeric(38, 18) not null default 5;

comment on column public.wallet_policies.swap_fee_bps is
  'Fee-on-swap in basis points. Applied to the USDC leg of every trade; '
  'refills the Privy gas sponsorship balance and contributes to the '
  'operator treasury. MVP default: 50 (0.5%).';

comment on column public.wallet_policies.swap_fee_min_usdc is
  'Floor on the fee-on-swap in USDC. Ensures dust trades still contribute. '
  'MVP default: $0.05.';

comment on column public.wallet_policies.min_mint_deposit_usdc is
  'Minimum cumulative USDC deposit required to flip a gladiator from '
  'pending_funding to alive. MVP default: $5.';

-- =========================================================================
-- trade_executions — restore execution_id, split fees, widen status
-- =========================================================================

-- execution_id is the reserve-before-submit idempotency key (deterministic
-- from cast_hash). Populated by the `quote_swap` workflow step before
-- the Privy signing call. Without production data we can add NOT NULL
-- directly.
alter table public.trade_executions
  add column execution_id       text not null,
  add column swap_fee_usdc      numeric(38, 18),
  add column sponsored_gas_usdc numeric(38, 18),
  add column fee_tx_hash        text;

alter table public.trade_executions
  add constraint trade_executions_execution_id_key unique (execution_id);

alter table public.trade_executions
  add constraint trade_executions_fee_tx_hash_key unique (fee_tx_hash);

-- The non-custodial era rolled swap_fee, gas, and anything else into a
-- single `fees_usdc` column. In the custodial model these are semantically
-- distinct (Commodus charges the swap fee; Privy sponsors the gas; both
-- are recorded for cost-basis arithmetic). Drop the generic column in
-- favor of the two split columns added above.
alter table public.trade_executions
  drop column fees_usdc;

alter table public.trade_executions
  alter column status set default 'pending';

alter table public.trade_executions
  drop constraint trade_executions_status_check;

alter table public.trade_executions
  add constraint trade_executions_status_check
    check (status in ('pending', 'submitted', 'confirmed', 'reverted', 'failed'));

-- Partial index for the reconciler's "pick up stuck work" query.
create index trade_executions_status_idx on public.trade_executions(status)
  where status in ('pending', 'submitted');

comment on column public.trade_executions.execution_id is
  'Reserve-before-submit idempotency key, deterministic from cast_hash. '
  'Inserted with status=pending BEFORE the Privy signing call so workflow '
  'replays cannot double-submit.';

comment on column public.trade_executions.swap_fee_usdc is
  'Commodus fee-on-swap charged on this execution. Deducted from the USDC '
  'leg (pre-quote on buys, post-swap transfer on sells). Included in '
  'cost-basis arithmetic.';

comment on column public.trade_executions.sponsored_gas_usdc is
  'USDC-equivalent of the gas Privy sponsored for this execution, priced '
  'at the submission block. Included in cost-basis arithmetic.';

comment on column public.trade_executions.fee_tx_hash is
  'Chain-layer idempotency key for the fee-transfer leg (USDC arena -> '
  'operator treasury). Distinct from tx_hash (the swap leg).';

-- =========================================================================
-- cast_commands — restore custodial status lifecycle
-- =========================================================================

-- The non-custodial pivot widened the check to include awaiting_swap and
-- abandoned (the "intent reply posted, waiting for user tap" state that
-- no longer exists) and dropped `quoted` / `executing`. Restore the
-- custodial lifecycle.
alter table public.cast_commands
  drop constraint cast_commands_status_check;

alter table public.cast_commands
  add constraint cast_commands_status_check
    check (status in ('received', 'parsed', 'validated', 'quoted',
                      'executing', 'executed', 'failed', 'rejected'));

drop index if exists public.cast_commands_status_idx;
create index cast_commands_status_idx on public.cast_commands(status)
  where status not in ('executed', 'failed', 'rejected');
