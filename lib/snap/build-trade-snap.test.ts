import { describe, expect, it } from "vitest";

import { buildTradeSnapResponse, type TradeSnapContext } from "./build-trade-snap";

const links = {
  tradeSnap: "https://app.example/api/snaps/trade-command",
  standingsSnap: "https://app.example/api/snaps/standings/123",
  miniApp: "https://app.example/?tab=trade",
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
  it("renders four summary rows with snap nav and mini-app footer", () => {
    const snap = buildTradeSnapResponse(baseCtx, links);
    const { elements } = snap.ui;

    expect(snap.version).toBe("2.0");
    expect(elements.root?.type).toBe("stack");
    expect(elements.root?.children?.length).toBeLessThanOrEqual(7);
    expect(Object.keys(elements).length).toBeLessThanOrEqual(64);
    expect(elements.stats?.children).toEqual([
      "i_rank",
      "i_pts",
      "i_port",
      "i_slots",
    ]);
    expect(elements.i_rank?.props?.title).toBe("#2");
    expect(elements.i_pts?.props?.description).toBe("Points");
    expect(elements.i_port?.props?.description).toBe("Value");
    expect(elements.i_slots?.props?.description).toBe("Trades left today");
    expect(elements.i_trade).toBeUndefined();
    expect(elements.i_proof).toBeUndefined();
    expect(elements.act_trade?.on?.press).toEqual({
      action: "open_snap",
      params: { target: links.tradeSnap },
    });
    expect(elements.act_standings?.on?.press).toEqual({
      action: "open_snap",
      params: { target: links.standingsSnap },
    });
    expect(elements.open_app?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: links.miniApp },
    });
  });

  it("uses sell accent for sell trades without adding trade-detail rows", () => {
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
    expect(snap.theme?.accent).toBe("green");
    expect(elements.i_pnl).toBeUndefined();
    expect(elements.i_proof).toBeUndefined();
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
    expect(elements.i_rank?.props?.title).toBe("Unranked");
    expect(elements.act_trade?.on?.press?.action).toBe("open_snap");
    expect(elements.open_app?.on?.press?.action).toBe("open_mini_app");
  });
});
