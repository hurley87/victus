import { describe, expect, it } from "vitest";

import { COMMAND_BOT_HANDLE } from "@/lib/commodus/bot";

import {
  buildTradeCommandSnapResponse,
  type TradeCommandSnapContext,
  type TradeCommandSnapLinks,
} from "./build-trade-command-snap";

const baseCtx: TradeCommandSnapContext = {
  starterCommand: `${COMMAND_BOT_HANDLE} buy 1 usdc of aero`,
  buyExample: "buy 5 usdc of aero",
  sellExample: "sell 50% of aero",
};

const snapLinks: TradeCommandSnapLinks = {
  standings: {
    action: "open_snap",
    target: "https://app.example/api/snaps/standings/123",
  },
  walletMiniApp: "https://app.example/?tab=wallet",
  miniApp: "https://app.example/?tab=trade",
};

describe("buildTradeCommandSnapResponse", () => {
  it("renders a compose-first card with Standings and Wallet between the CTA and Open Mini App", () => {
    const snap = buildTradeCommandSnapResponse(baseCtx, snapLinks);
    const { elements, root } = snap.ui;

    expect(snap.version).toBe("2.0");
    expect(root).toBe("root");
    expect(elements.root?.children).toEqual([
      "hdr",
      "body",
      "examples",
      "compose",
      "nav",
      "open_app",
    ]);

    expect(elements.examples?.type).toBe("item_group");
    expect(elements.examples?.children).toEqual(["ex_buy", "ex_sell"]);
    expect(elements.ex_buy?.props?.title).toBe(
      `${COMMAND_BOT_HANDLE} ${baseCtx.buyExample}`,
    );
    expect(elements.ex_sell?.props?.title).toBe(
      `${COMMAND_BOT_HANDLE} ${baseCtx.sellExample}`,
    );

    expect(elements.compose?.type).toBe("button");
    expect(elements.compose?.on?.press).toEqual({
      action: "compose_cast",
      params: { text: baseCtx.starterCommand },
    });

    expect(elements.nav?.children).toEqual(["act_standings", "act_wallet"]);
    expect(elements.act_standings?.on?.press).toEqual({
      action: "open_snap",
      params: { target: "https://app.example/api/snaps/standings/123" },
    });
    expect(elements.act_wallet?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: snapLinks.walletMiniApp },
    });

    expect(elements.open_app?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: snapLinks.miniApp },
    });
  });

  it("falls back to open_mini_app for Standings when no FID context is available", () => {
    const snap = buildTradeCommandSnapResponse(baseCtx, {
      ...snapLinks,
      standings: {
        action: "open_mini_app",
        target: "https://app.example/?tab=standings",
      },
    });

    expect(snap.ui.elements.act_standings?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: "https://app.example/?tab=standings" },
    });
  });

  it("omits form inputs — no submit/signature path, no toggles, no text inputs", () => {
    const snap = buildTradeCommandSnapResponse(baseCtx, snapLinks);
    const { elements } = snap.ui;

    expect(elements.mode).toBeUndefined();
    expect(elements.token).toBeUndefined();
    expect(elements.buy_amount).toBeUndefined();
    expect(elements.sell_percent).toBeUndefined();
    expect(elements.preview).toBeUndefined();
    expect(elements.edit).toBeUndefined();

    const actions = Object.values(elements)
      .map((el) => el.on?.press?.action)
      .filter(Boolean);
    expect(actions).not.toContain("submit");
  });
});
