import { describe, expect, it } from "vitest";

import { TradeIntentSchema, isUsdcInIntent } from "./intents";

describe("TradeIntentSchema", () => {
  it("accepts a canonical buy intent", () => {
    const parsed = TradeIntentSchema.parse({
      action: "buy",
      symbol: "AERO",
      amount_type: "usdc_in",
      amount_value: 5,
    });
    expect(parsed).toEqual({
      action: "buy",
      symbol: "AERO",
      amount_type: "usdc_in",
      amount_value: 5,
    });
  });

  it("defaults amount_type to usdc_in", () => {
    const parsed = TradeIntentSchema.parse({
      action: "buy",
      symbol: "AERO",
      amount_value: 1,
    });
    expect(parsed.amount_type).toBe("usdc_in");
  });

  it("rejects lowercased or dashed symbols", () => {
    expect(() =>
      TradeIntentSchema.parse({
        action: "buy",
        symbol: "aero",
        amount_value: 1,
      }),
    ).toThrow();
  });

  it("rejects zero or negative amounts", () => {
    expect(() =>
      TradeIntentSchema.parse({
        action: "buy",
        symbol: "AERO",
        amount_value: 0,
      }),
    ).toThrow();
    expect(() =>
      TradeIntentSchema.parse({
        action: "buy",
        symbol: "AERO",
        amount_value: -1,
      }),
    ).toThrow();
  });

  it("accepts sell intents for forward compat", () => {
    const parsed = TradeIntentSchema.parse({
      action: "sell",
      symbol: "AERO",
      amount_type: "percent_out",
      amount_value: 100,
    });
    expect(parsed.action).toBe("sell");
  });
});

describe("isUsdcInIntent", () => {
  it("narrows the type on usdc_in intents", () => {
    const intent = TradeIntentSchema.parse({
      action: "buy",
      symbol: "AERO",
      amount_value: 1,
    });
    expect(isUsdcInIntent(intent)).toBe(true);
  });

  it("rejects percent_out intents", () => {
    const intent = TradeIntentSchema.parse({
      action: "sell",
      symbol: "AERO",
      amount_type: "percent_out",
      amount_value: 50,
    });
    expect(isUsdcInIntent(intent)).toBe(false);
  });
});
