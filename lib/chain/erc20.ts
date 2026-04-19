import "server-only";

import { erc20Abi, formatUnits, type Address } from "viem";

import { basePublicClient } from "./client";
import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "./addresses";

// Re-export so existing server-side callers (balances reader, future
// execution pipeline) keep working unchanged. Client code should import
// directly from `./addresses` to avoid pulling in the server-only RPC
// client.
export { USDC_BASE_ADDRESS, USDC_DECIMALS };

/**
 * Read the ERC-20 balance of `owner` on Base. Returns the raw integer in
 * token base units (wei-equivalent) so the caller can format with the
 * right decimals. Throws on RPC failure — callers decide retry policy.
 */
export async function readErc20Balance(
  token: Address,
  owner: Address,
): Promise<bigint> {
  return await basePublicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

/**
 * Read the USDC balance of `owner` on Base as a decimal number. Accurate
 * to USDC's 6 decimals; safe because JS `number` has >15 digits of
 * precision and the `wallet_cap_usdc` ($50) is orders of magnitude below
 * the floating-point danger zone.
 */
export async function readUsdcBalance(owner: Address): Promise<number> {
  const raw = await readErc20Balance(USDC_BASE_ADDRESS, owner);
  return Number(formatUnits(raw, USDC_DECIMALS));
}
