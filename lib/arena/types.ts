/**
 * Wire contracts for the Arena HTTP surface — `/api/arena/me`,
 * `/api/arena/wallet`, and `/api/arena/withdraw`. Colocated so
 * the handler, the service, and the client stay in sync.
 */

import type { ArenaBalance, PositionBalance } from "@/lib/chain/balances";
import type { WithdrawDestinationSource } from "./withdraw-destination";

export type { ArenaBalance, PositionBalance };

export type WhitelistEntry = {
  symbol: string;
  name: string;
  /** When false, the asset may still appear for routing / display but is not tradable against USDC (`is_tradable` in `asset_whitelist`). */
  is_tradable: boolean;
};

export type ArenaWalletStatus = "active" | "closed";

export type ArenaWalletSummary = {
  status: ArenaWalletStatus;
  created_at: string;
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
  min_funding_deposit_usdc: number;
  swap_fee_bps: number;
  swap_fee_min_usdc: number;
};

/**
 * Response body for `GET /api/arena/me`. Drives all three Wallet states:
 *   - `wallet === null` → State A (pre-wallet)
 *   - `needs_funding === true` → State B (pending funding)
 *   - otherwise → State C (funded)
 *
 * Addresses are lowercase hex throughout the system.
 */
export type ArenaProfile = {
  wallet: ArenaWalletSummary | null;
  arena_address: string | null;
  withdraw_destination: {
    address: string;
    source: WithdrawDestinationSource;
  } | null;
  balance: ArenaBalance;
  rules: ArenaRules;
  needs_funding: boolean;
  daily_slots_remaining: number;
};

export type ProvisionArenaWalletResponse = {
  arena_address: string;
  wallet: ArenaWalletSummary;
  min_funding_deposit_usdc: number;
};

/**
 * Withdraw request body. Amount omitted = sweep full live USDC balance.
 * USDC on Base only; non-USDC tokens are out of scope for MVP.
 */
export type WithdrawRequest = {
  amount_usdc?: number;
};

export type WithdrawResponse = {
  tx_hash: string;
  amount_usdc: number;
  to: string;
  destination_source: WithdrawDestinationSource;
};
