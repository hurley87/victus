import { describe, expect, it } from "vitest";

import { buildTradeSnapResponse, type TradeSnapContext } from "./build-trade-snap";

const links = {
  wallet: "https://app.example/?tab=wallet",
  trade: "https://app.example/?tab=trade",
  standings: "https://app.example/?tab=standings",
};

const baseCtx: TradeSnapContext = {
  displayHandle: "Maximus",
  rank: 2,
  points: 40,
  portfolioUsdc: 100,
  dailySlotsRemaining: 3,
  trade: {
    action: "buy",
    symbol: "AERO",
    status: "confirmed",
    quantity: 6.880661,
    notionalUsdc: 2.95,
    realizedPnlUsdc: null,
    txHash: "0x9ea73b491234567890abcdef",
  },
};

describe("buildTradeSnapResponse", () => {
  it("renders buy trade details with mini-app actions", () => {
    const snap = buildTradeSnapResponse(baseCtx, links);
    const { elements } = snap.ui;

    expect(snap.version).toBe("2.0");
    expect(elements.root?.type).toBe("stack");
    expect(elements.root?.children?.length).toBeLessThanOrEqual(6);
    expect(Object.keys(elements).length).toBeLessThanOrEqual(64);
    expect(elements.i_trade?.props?.title).toBe("Bought AERO");
    expect(elements.i_qty?.props?.title).toBe("6.880661 AERO");
    expect(elements.i_notional?.props?.title).toBe("2.95 USDC");
    expect(elements.i_proof?.props?.title).toBe("0x9ea73b49...");
    expect(elements.i_pnl).toBeUndefined();
    expect(elements.act_wallet?.on?.press?.params).toEqual({
      target: links.wallet,
    });
    expect(elements.act_trade?.on?.press?.params).toEqual({
      target: links.trade,
    });
    expect(elements.act_standings?.on?.press?.params).toEqual({
      target: links.standings,
    });
  });

  it("renders realized PnL for sell trades", () => {
    const snap = buildTradeSnapResponse(
      {
        ...baseCtx,
        trade: {
          ...baseCtx.trade,
          action: "sell",
          quantity: 2,
          notionalUsdc: 10,
          realizedPnlUsdc: 1.25,
        },
      },
      links,
    );

    const { elements } = snap.ui;
    expect(elements.i_trade?.props?.title).toBe("Sold AERO");
    expect(elements.i_notional?.props?.description).toBe("USDC received gross");
    expect(elements.i_pnl?.props?.title).toBe("+1.25 USDC");
    expect(elements.i_pnl?.props?.description).toBe("Realized PnL");
  });

  it("handles failed or incomplete trade fields without dead-ending actions", () => {
    const snap = buildTradeSnapResponse(
      {
        ...baseCtx,
        rank: null,
        trade: {
          ...baseCtx.trade,
          status: "failed",
          quantity: null,
          notionalUsdc: null,
          txHash: null,
        },
      },
      links,
    );

    const { elements } = snap.ui;
    expect(elements.hdr?.props?.content).toBe("Maximus - failed");
    expect(elements.i_qty?.props?.title).toBe("n/a AERO");
    expect(elements.i_notional?.props?.title).toBe("n/a USDC");
    expect(elements.i_proof?.props?.title).toBe("Proof pending");
    expect(elements.i_rank?.props?.title).toBe("Rank n/a");
    expect(elements.act_trade?.on?.press?.action).toBe("open_mini_app");
  });
});
