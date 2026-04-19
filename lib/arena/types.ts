/**
 * Shared types for the Arena onboarding surface.
 *
 * These are the wire contracts for `GET /api/arena/me` and
 * `POST /api/gladiators/mint`. Keeping them colocated with the service
 * means the handler, the service, and the client stay in sync.
 */

import type { ArenaBalance, PositionBalance } from "@/lib/chain/balances";

export type { ArenaBalance, PositionBalance };

export type WhitelistEntry = {
  symbol: string;
  name: string;
};

export type GladiatorStatus = "pending_funding" | "alive";

export type GladiatorSummary = {
  name: string;
  status: GladiatorStatus;
  minted_at: string;
  funded_at: string | null;
};

/**
 * Rules surfaced on the Arena page. Display-only in the onboarding
 * surface; server-side enforcement happens in the execution pipeline
 * (#8 / #12). Values come from `wallet_policies` once the row exists,
 * otherwise from the canonical defaults in the DB CHECK constraints.
 */
export type ArenaRules = {
  whitelist: WhitelistEntry[];
  max_trade_usdc: number;
  max_trades_per_day: number;
  wallet_cap_usdc: number;
  min_mint_deposit_usdc: number;
  swap_fee_bps: number;
  swap_fee_min_usdc: number;
};

/**
 * Response body for `GET /api/arena/me`. Drives all three Arena states:
 *   - `gladiator === null` → State A (pre-mint)
 *   - `needs_funding === true` → State B (pending funding)
 *   - otherwise → State C (alive)
 *
 * Addresses are lowercase hex throughout the system.
 */
export type ArenaProfile = {
  gladiator: GladiatorSummary | null;
  arena_address: string | null;
  balance: ArenaBalance;
  rules: ArenaRules;
  needs_funding: boolean;
  daily_slots_remaining: number;
  /**
   * Server-derived gladiator name preview shown on the pre-mint card
   * (Farcaster username, or `gladiator-{fid}` fallback). Present only
   * when `gladiator === null`; `null` otherwise. Authoritative — the
   * mint endpoint uses the same derivation on write.
   */
  suggested_name: string | null;
};

/**
 * Mint request body. All fields optional — default behavior derives the
 * gladiator name from the authenticated user's Farcaster username.
 */
export type MintGladiatorRequest = {
  name?: string;
};

export type MintGladiatorResponse = {
  arena_address: string;
  gladiator: GladiatorSummary;
  min_mint_deposit_usdc: number;
};
