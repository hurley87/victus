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
  tradeSnap: "https://app.example/api/snaps/trade-command",
  standingsSnap: "https://app.example/api/snaps/standings/123",
  walletSnap: "https://app.example/api/snaps/status/123",
  miniApp: "https://app.example/?tab=wallet",
};

describe("buildStatusSnapResponse", () => {
  it("returns Snap 2.0 with a Wallet header, four rows, snap nav, and mini-app footer", () => {
    const snap = buildStatusSnapResponse(baseCtx, links);
    expect(snap.version).toBe("2.0");
    expect(snap.ui.root).toBe("root");
    const { elements } = snap.ui;
    expect(elements.hdr?.props?.content).toBe("Wallet");
    expect(elements.root?.type).toBe("stack");
    expect(elements.root?.children?.length).toBeLessThanOrEqual(7);
    expect(Object.keys(elements).length).toBeLessThanOrEqual(64);
    expect(elements.actions?.children).toEqual([
      "act_trade",
      "act_standings",
    ]);

    expect(elements.i_rank?.props?.title).toBe("#2");
    expect(elements.i_rank?.props?.description).toBe("Rank");
    expect(elements.i_pts?.props?.description).toBe("Points");
    expect(elements.i_port?.props?.description).toBe("Value");
    expect(elements.i_slots?.props?.description).toBe("Trades left today");
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
});
