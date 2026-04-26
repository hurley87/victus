import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDefillamaSpotPricesUsd } from "./defillama-spot";

describe("fetchDefillamaSpotPricesUsd", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps lowercase addresses from the batch response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          coins: {
            "base:0x00000000000000000000000000000000000000a1": { price: 2.5 },
          },
        }),
      })) as unknown as typeof fetch,
    );

    const map = await fetchDefillamaSpotPricesUsd([
      "0x00000000000000000000000000000000000000a1",
    ]);
    expect(map.get("0x00000000000000000000000000000000000000a1")).toBe(2.5);
  });

  it("dedupes addresses and returns empty map on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }) as unknown as typeof fetch,
    );

    const map = await fetchDefillamaSpotPricesUsd([
      "0x00000000000000000000000000000000000000a1",
      "0x00000000000000000000000000000000000000a1",
    ]);
    expect(map.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
