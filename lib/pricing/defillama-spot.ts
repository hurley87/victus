import "server-only";

import { getAddress } from "viem";

import { log } from "@/lib/logger";

const DEFILLAMA_CURRENT = "https://coins.llama.fi/prices/current";

type DefillamaCurrentResponse = {
  coins?: Record<string, { price?: number }>;
};

/** Batch spot USD prices (DefiLlama); display-only, not for execution. */
export async function fetchDefillamaSpotPricesUsd(
  tokenAddresses: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = uniqueLowerBaseAddresses(tokenAddresses);
  if (unique.length === 0) return map;

  const coinIds = unique.map((a) => `base:${a}`).join(",");
  const url = `${DEFILLAMA_CURRENT}/${coinIds}`;

  let body: DefillamaCurrentResponse;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      log.warn("defillama-spot: non-OK response", { status: res.status, url });
      return map;
    }
    body = (await res.json()) as DefillamaCurrentResponse;
  } catch (err) {
    log.warn("defillama-spot: request failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return map;
  }

  const coins = body.coins ?? {};
  for (const addr of unique) {
    const row = coins[`base:${addr}`];
    const price = row?.price;
    if (typeof price === "number" && Number.isFinite(price) && price >= 0) {
      map.set(addr, price);
    }
  }

  return map;
}

function uniqueLowerBaseAddresses(tokenAddresses: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokenAddresses) {
    try {
      const addr = getAddress(raw).toLowerCase();
      if (seen.has(addr)) continue;
      seen.add(addr);
      unique.push(addr);
    } catch {
      log.warn("defillama-spot: skip invalid token address", { raw });
    }
  }
  return unique;
}
