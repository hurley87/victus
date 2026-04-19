import { describe, expect, it } from "vitest";

import {
  CommandIntentSchema,
  TradeIntentSchema,
  isTradeIntent,
  isUsdcInIntent,
} from "./intents";

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

  it("rejects buys without the usdc_in discriminant", () => {
    // Discriminated union: `action: "buy"` pins `amount_type: "usdc_in"`.
    expect(() =>
      TradeIntentSchema.parse({
        action: "buy",
        symbol: "AERO",
        amount_type: "percent_out",
        amount_value: 5,
      }),
    ).toThrow();
  });

  it("rejects lowercased or dashed symbols", () => {
    expect(() =>
      TradeIntentSchema.parse({
        action: "buy",
        symbol: "aero",
        amount_type: "usdc_in",
        amount_value: 1,
      }),
    ).toThrow();
  });

  it("rejects zero or negative buy amounts", () => {
    expect(() =>
      TradeIntentSchema.parse({
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 0,
      }),
    ).toThrow();
    expect(() =>
      TradeIntentSchema.parse({
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: -1,
      }),
    ).toThrow();
  });

  it("accepts a canonical sell intent", () => {
    const parsed = TradeIntentSchema.parse({
      action: "sell",
      symbol: "AERO",
      amount_type: "percent_out",
      amount_value: 50,
    });
    expect(parsed.action).toBe("sell");
  });

  it("rejects sell percents outside [1, 100]", () => {
    for (const amount of [0, 101, 150, -10, 33.5]) {
      expect(() =>
        TradeIntentSchema.parse({
          action: "sell",
          symbol: "AERO",
          amount_type: "percent_out",
          amount_value: amount,
        }),
      ).toThrow();
    }
  });

  it("rejects sells sized in USDC (must be percent_out)", () => {
    expect(() =>
      TradeIntentSchema.parse({
        action: "sell",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 5,
      }),
    ).toThrow();
  });
});

describe("CommandIntentSchema", () => {
  it("accepts a status intent with no other fields", () => {
    const parsed = CommandIntentSchema.parse({ action: "status" });
    expect(parsed).toEqual({ action: "status" });
  });

  it("accepts buy and sell intents via the trade arms", () => {
    expect(
      CommandIntentSchema.parse({
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 5,
      }).action,
    ).toBe("buy");
    expect(
      CommandIntentSchema.parse({
        action: "sell",
        symbol: "AERO",
        amount_type: "percent_out",
        amount_value: 25,
      }).action,
    ).toBe("sell");
  });

  it("rejects unknown actions", () => {
    expect(() =>
      CommandIntentSchema.parse({ action: "cancel", symbol: "AERO" }),
    ).toThrow();
  });
});

describe("isUsdcInIntent", () => {
  it("narrows the type on buy intents", () => {
    const intent = TradeIntentSchema.parse({
      action: "buy",
      symbol: "AERO",
      amount_type: "usdc_in",
      amount_value: 1,
    });
    expect(isUsdcInIntent(intent)).toBe(true);
  });

  it("rejects sell intents", () => {
    const intent = TradeIntentSchema.parse({
      action: "sell",
      symbol: "AERO",
      amount_type: "percent_out",
      amount_value: 50,
    });
    expect(isUsdcInIntent(intent)).toBe(false);
  });
});

describe("isTradeIntent", () => {
  it("accepts buy and sell intents", () => {
    expect(
      isTradeIntent({
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 1,
      }),
    ).toBe(true);
    expect(
      isTradeIntent({
        action: "sell",
        symbol: "AERO",
        amount_type: "percent_out",
        amount_value: 50,
      }),
    ).toBe(true);
  });

  it("rejects status intents", () => {
    expect(isTradeIntent({ action: "status" })).toBe(false);
  });
});
