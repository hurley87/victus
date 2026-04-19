import { describe, expect, it } from "vitest";

import { computeSwapFeeUsdc, netBuyNotionalUsdc } from "./fees";

const DEFAULTS = {
  swapFeeBps: 50,
  swapFeeMinUsdc: 0.05,
};

describe("computeSwapFeeUsdc", () => {
  it("charges the percentage above the floor", () => {
    // $100 * 50bps = $0.50, well above the $0.05 floor
    expect(
      computeSwapFeeUsdc({ notionalUsdc: 100, ...DEFAULTS }),
    ).toBeCloseTo(0.5, 10);
  });

  it("clamps to the floor for dust trades", () => {
    // $1 * 50bps = $0.005, below the $0.05 floor
    expect(
      computeSwapFeeUsdc({ notionalUsdc: 1, ...DEFAULTS }),
    ).toBeCloseTo(0.05, 10);
  });

  it("hits the floor exactly at the break-even", () => {
    // floor of $0.05 matches 50bps on $10 exactly
    expect(
      computeSwapFeeUsdc({ notionalUsdc: 10, ...DEFAULTS }),
    ).toBeCloseTo(0.05, 10);
  });

  it("rejects non-positive notionals", () => {
    expect(() =>
      computeSwapFeeUsdc({ notionalUsdc: 0, ...DEFAULTS }),
    ).toThrow();
    expect(() =>
      computeSwapFeeUsdc({ notionalUsdc: -1, ...DEFAULTS }),
    ).toThrow();
  });

  it("rejects fractional basis points", () => {
    expect(() =>
      computeSwapFeeUsdc({ notionalUsdc: 100, swapFeeBps: 12.5, swapFeeMinUsdc: 0 }),
    ).toThrow();
  });
});

describe("netBuyNotionalUsdc", () => {
  it("returns notional minus fee on normal trades", () => {
    expect(
      netBuyNotionalUsdc({ notionalUsdc: 5, ...DEFAULTS }),
    ).toBeCloseTo(5 - 0.05, 10);
  });

  it("clamps to zero if the floor exceeds the notional", () => {
    // $0.01 trade with $0.05 floor — the fee would eat the whole thing
    expect(
      netBuyNotionalUsdc({ notionalUsdc: 0.01, ...DEFAULTS }),
    ).toBe(0);
  });
});
