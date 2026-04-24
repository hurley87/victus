import { describe, expect, it } from "vitest";

import { interpolateTradeCommand } from "./trade-command-text";

const constraints = {
  allowedSymbols: ["AERO", "DEGEN", "VIRTUAL"],
  maxBuyUsdc: 10,
};

describe("interpolateTradeCommand", () => {
  it("composes a buy command with the lowercase symbol", () => {
    expect(
      interpolateTradeCommand(
        { action: "Buy", symbol: "AERO", amount: "5" },
        constraints,
      ),
    ).toEqual({ ok: true, castText: "@commo buy 5 usdc of aero" });
  });

  it("composes a sell command with a percent suffix", () => {
    expect(
      interpolateTradeCommand(
        { action: "Sell", symbol: "DEGEN", amount: "50" },
        constraints,
      ),
    ).toEqual({ ok: true, castText: "@commo sell 50% of degen" });
  });

  it("rejects tokens outside the whitelist", () => {
    expect(
      interpolateTradeCommand(
        { action: "Buy", symbol: "WIF", amount: "5" },
        constraints,
      ),
    ).toEqual({ ok: false, error: "Pick a token from the whitelist." });
  });

  it("rejects buys above the arena cap", () => {
    expect(
      interpolateTradeCommand(
        { action: "Buy", symbol: "AERO", amount: "25" },
        constraints,
      ),
    ).toEqual({ ok: false, error: "Max buy is 10 USDC." });
  });

  it("rejects sell percentages above 100", () => {
    expect(
      interpolateTradeCommand(
        { action: "Sell", symbol: "AERO", amount: "150" },
        constraints,
      ),
    ).toEqual({
      ok: false,
      error: "Sell percent must be between 1 and 100.",
    });
  });

  it("rejects non-positive amounts", () => {
    expect(
      interpolateTradeCommand(
        { action: "Buy", symbol: "AERO", amount: "0" },
        constraints,
      ),
    ).toEqual({ ok: false, error: "Enter an amount greater than 0." });
  });

  it("rejects missing action", () => {
    expect(
      interpolateTradeCommand(
        { symbol: "AERO", amount: "5" },
        constraints,
      ),
    ).toEqual({ ok: false, error: "Pick Buy or Sell to continue." });
  });
});
