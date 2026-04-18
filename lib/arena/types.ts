/**
 * Shared types for the Arena onboarding surface.
 *
 * These are the wire contracts for `GET /api/arena/me` and
 * `POST /api/arena/address`. Keeping them colocated with the service
 * means the handler, the service, and the client stay in sync.
 */

export type WhitelistEntry = {
  symbol: string;
  name: string;
};

/**
 * Rules surfaced on the Arena page. Display-only; server-side
 * enforcement happens at intent/score time (#12). Values fall back to
 * the canonical `wallet_policies` defaults before designation.
 */
export type ArenaRules = {
  whitelist: WhitelistEntry[];
  max_trade_usdc: number;
  max_trades_per_day: number;
};

/**
 * Response body for `GET /api/arena/me`. Addresses are lowercase
 * throughout the system. `is_designated` mirrors `arena_address !== null`
 * and is on the wire so callers don't have to duplicate the check.
 */
export type ArenaProfile = {
  arena_address: string | null;
  verifications: string[];
  is_designated: boolean;
  rules: ArenaRules;
};

export type DesignateArenaAddressRequest = {
  address: string;
};

export type DesignateArenaAddressResponse = {
  arena_address: string;
};
