import { getAddress, type Address } from "viem";

/**
 * Chain-address constants safe to import from both server and client code.
 *
 * Kept separate from `lib/chain/erc20.ts` (which is `"server-only"` for
 * RPC calls) so that client components — the in-Mini-App deposit button
 * in particular — can build transaction calldata from the same source of
 * truth as the server-side balance reader.
 */

/** Native USDC on Base mainnet (`0x833589f…02913`). Not USDC.e, not USDbC. */
export const USDC_BASE_ADDRESS: Address = getAddress(
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
);

/** Canonical USDC decimals on Base. */
export const USDC_DECIMALS = 6;
