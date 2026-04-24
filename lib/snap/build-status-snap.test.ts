import { describe, expect, it } from "vitest";

import { buildStatusSnapResponse } from "./build-status-snap";

import type { StatusViewContext } from "@/lib/status/load-context";

const baseCtx: StatusViewContext = {
  fid: 123,
  displayHandle: "Maximus",
  rank: 2,
  points: 40,
  portfolioUsdc: 100,
  dailySlotsRemaining: 3,
  topTenCutoffPoints: 80,
};

const links = {
  wallet: "https://app.example/?tab=wallet",
  trade: "https://app.example/?tab=trade",
  standings: "https://app.example/?tab=standings",
};

describe("buildStatusSnapResponse", () => {
  it("returns Snap 2.0 with status data and three mini-app actions", () => {
    const snap = buildStatusSnapResponse(baseCtx, links);
    expect(snap.version).toBe("2.0");
    expect(snap.ui.root).toBe("root");
    const { elements } = snap.ui;
    expect(elements.root?.type).toBe("stack");
    expect(elements.root?.children?.length).toBeLessThanOrEqual(7);
    expect(Object.keys(elements).length).toBeLessThanOrEqual(64);
    expect(elements.actions?.children).toEqual([
      "act_wallet",
      "act_trade",
      "act_standings",
    ]);

    expect(elements.act_wallet?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: links.wallet },
    });
    expect(elements.act_trade?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: links.trade },
    });
    expect(elements.act_standings?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: links.standings },
    });
  });
});
