/**
 * Canonical policy defaults for a freshly provisioned arena wallet.
 *
 * Mirrored from the Postgres defaults on `wallet_policies` (see
 * `supabase/migrations/20260417094525_init_commodus_schema.sql` and
 * `supabase/migrations/20260418170000_restore_custodial_execution.sql`).
 *
 * Any code path that reads a `wallet_policies` row and needs a fallback
 * (mint threshold lookup, arena self-heal threshold, pre-mint Arena
 * rules card) MUST import from here so the paths can't drift.
 */
export const DEFAULT_POLICY = {
  max_trade_usdc: 10,
  max_trades_per_day: 10,
  wallet_cap_usdc: 50,
  min_mint_deposit_usdc: 5,
  swap_fee_bps: 50,
  swap_fee_min_usdc: 0.05,
} as const;
