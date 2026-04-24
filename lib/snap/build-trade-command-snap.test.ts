import { describe, expect, it } from "vitest";

import {
  buildTradeCommandSnapResponse,
  type TradeCommandSnapContext,
} from "./build-trade-command-snap";

const baseCtx: TradeCommandSnapContext = {
  mode: "buy",
  token: "AERO",
  tokens: ["AERO", "DEGEN", "VIRTUAL"],
  buyAmount: "3",
  sellPercent: "50",
  maxTradeUsdc: 10,
  command: null,
  error: null,
  submitUrl: "https://app.example/api/snaps/trade-command",
  editUrl: "https://app.example/api/snaps/trade-command",
};

const links = {
  miniApp: "https://app.example/?tab=trade",
};

describe("buildTradeCommandSnapResponse", () => {
  it("renders a snap form for side, token, and amounts", () => {
    const snap = buildTradeCommandSnapResponse(baseCtx, links);
    const { elements } = snap.ui;

    expect(snap.version).toBe("2.0");
    expect(elements.root?.children?.length).toBeLessThanOrEqual(7);
    expect(Object.keys(elements).length).toBeLessThanOrEqual(64);
    expect(elements.mode?.type).toBe("toggle_group");
    expect(elements.token?.type).toBe("toggle_group");
    expect(elements.buy_amount?.type).toBe("input");
    expect(elements.sell_percent?.type).toBe("input");
    expect(elements.preview?.on?.press).toEqual({
      action: "submit",
      params: { target: baseCtx.submitUrl },
    });
    expect(elements.open_app?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: links.miniApp },
    });
  });

  it("renders a compose preview for a valid command", () => {
    const snap = buildTradeCommandSnapResponse(
      {
        ...baseCtx,
        command: "buy 3 usdc of aero",
      },
      links,
    );

    const { elements } = snap.ui;
    expect(elements.cast?.props?.content).toBe("@commo buy 3 usdc of aero");
    expect(elements.compose?.on?.press).toEqual({
      action: "compose_cast",
      params: { text: "@commo buy 3 usdc of aero" },
    });
    expect(elements.edit?.on?.press).toEqual({
      action: "open_snap",
      params: { target: baseCtx.editUrl },
    });
  });

  it("keeps validation errors on the form instead of composing", () => {
    const snap = buildTradeCommandSnapResponse(
      {
        ...baseCtx,
        error: "Max buy is 10 USDC.",
      },
      links,
    );

    const { elements } = snap.ui;
    expect(elements.note?.props?.content).toBe("Max buy is 10 USDC.");
    expect(elements.compose).toBeUndefined();
    expect(elements.preview?.on?.press?.action).toBe("submit");
  });
});
