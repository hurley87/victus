import "server-only";

import { formatUnits, getAddress, type Address } from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "./addresses";
import { basePublicClient } from "./client";

export type TradableAsset = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
};

export type PositionBalance = {
  symbol: string;
  name: string;
  quantity: number;
  /**
   * USDC-denominated notional. `null` until the 0x price integration
   * lands in #11/#12 — the arena page renders a placeholder in that
   * case. Keeping the field on the wire now avoids a breaking change.
   */
  notional_usdc: number | null;
};

export type ArenaBalance = {
  usdc: number;
  positions: PositionBalance[];
};

/**
 * Read the arena wallet's USDC balance and each tradable asset's quantity
 * in a single `multicall3` round trip. This keeps the Arena page fast
 * (≤1 RPC call per render) and avoids N+1 fan-out as the whitelist grows.
 *
 * Assets with a zero balance are filtered out of `positions` — there's
 * no point rendering a row for every un-held token.
 */
export async function readArenaBalance(
  arenaAddress: string,
  tradableAssets: TradableAsset[],
): Promise<ArenaBalance> {
  const owner = getAddress(arenaAddress);

  const usdcCall = {
    address: USDC_BASE_ADDRESS,
    abi: erc20BalanceOfAbi,
    functionName: "balanceOf" as const,
    args: [owner] as const,
  };

  const assetCalls = tradableAssets.map((asset) => ({
    address: getAddress(asset.address),
    abi: erc20BalanceOfAbi,
    functionName: "balanceOf" as const,
    args: [owner] as const,
  }));

  const results = await basePublicClient.multicall({
    contracts: [usdcCall, ...assetCalls],
    allowFailure: true,
  });

  const [usdcResult, ...assetResults] = results;

  const usdc =
    usdcResult.status === "success"
      ? Number(formatUnits(usdcResult.result, USDC_DECIMALS))
      : 0;

  const positions: PositionBalance[] = [];
  for (let i = 0; i < tradableAssets.length; i++) {
    const asset = tradableAssets[i];
    const res = assetResults[i];
    if (res.status !== "success") continue;
    const quantity = Number(formatUnits(res.result, asset.decimals));
    if (quantity <= 0) continue;
    positions.push({
      symbol: asset.symbol,
      name: asset.name,
      quantity,
      notional_usdc: null,
    });
  }

  return { usdc, positions };
}

const erc20BalanceOfAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
