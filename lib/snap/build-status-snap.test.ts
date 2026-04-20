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

describe("buildStatusSnapResponse", () => {
  it("returns Snap 2.0 with expected root and shallow tree", () => {
    const snap = buildStatusSnapResponse(baseCtx, "https://app.example/portfolio?fid=123");
    expect(snap.version).toBe("2.0");
    expect(snap.ui.root).toBe("root");
    const { elements } = snap.ui;
    expect(elements.root?.type).toBe("stack");
    expect(elements.root?.children?.length).toBeLessThanOrEqual(7);
    expect(Object.keys(elements).length).toBeLessThanOrEqual(64);
    expect(elements.cta?.on?.press?.action).toBe("open_mini_app");
    expect(elements.cta?.on?.press?.params).toEqual({
      target: "https://app.example/portfolio?fid=123",
    });
  });
});
