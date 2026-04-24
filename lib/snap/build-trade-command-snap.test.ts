import { describe, expect, it } from "vitest";

import {
  buildTradeCommandConfirmSnapResponse,
  buildTradeCommandSnapResponse,
  type TradeCommandSnapContext,
  type TradeCommandSnapLinks,
} from "./build-trade-command-snap";

const baseCtx: TradeCommandSnapContext = {
  symbols: ["AERO", "DEGEN", "VIRTUAL"],
  defaultSymbol: "AERO",
  amountDefault: "5",
};

const snapLinks: TradeCommandSnapLinks = {
  composeSubmit: "https://app.example/api/snaps/trade-command?fid=123",
  standings: {
    action: "open_snap",
    target: "https://app.example/api/snaps/standings/123",
  },
  wallet: {
    action: "open_snap",
    target: "https://app.example/api/snaps/status/123",
  },
  miniApp: "https://app.example/?tab=trade",
};

describe("buildTradeCommandSnapResponse", () => {
  it("renders the trade form + submit-powered Make Trade CTA + Standings/Wallet nav", () => {
    const snap = buildTradeCommandSnapResponse(baseCtx, snapLinks);
    const { elements, root } = snap.ui;

    expect(snap.version).toBe("2.0");
    expect(root).toBe("root");
    expect(elements.root?.children).toEqual([
      "hdr",
      "body",
      "action",
      "symbol",
      "amount",
      "compose",
      "nav",
      "open_app",
    ]);

    expect(elements.action?.type).toBe("toggle_group");
    expect(elements.action?.props).toMatchObject({
      name: "action",
      options: ["Buy", "Sell"],
      defaultValue: "Buy",
    });

    expect(elements.symbol?.type).toBe("toggle_group");
    expect(elements.symbol?.props).toMatchObject({
      name: "symbol",
      options: baseCtx.symbols,
      defaultValue: "AERO",
    });

    expect(elements.amount?.type).toBe("input");
    expect(elements.amount?.props).toMatchObject({
      name: "amount",
      type: "number",
      defaultValue: "5",
    });

    expect(elements.compose?.type).toBe("button");
    expect(elements.compose?.props?.label).toBe("Make Trade");
    expect(elements.compose?.on?.press).toEqual({
      action: "submit",
      params: { target: snapLinks.composeSubmit },
    });

    expect(elements.nav?.children).toEqual(["act_standings", "act_wallet"]);
    expect(elements.act_standings?.on?.press).toEqual({
      action: "open_snap",
      params: { target: snapLinks.standings.target },
    });
    expect(elements.act_wallet?.on?.press).toEqual({
      action: "open_snap",
      params: { target: snapLinks.wallet.target },
    });

    expect(elements.open_app?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: snapLinks.miniApp },
    });

    const openMiniAppIds = Object.entries(elements)
      .filter(([, el]) => el.on?.press?.action === "open_mini_app")
      .map(([id]) => id);
    expect(openMiniAppIds).toEqual(["open_app"]);
  });

  it("caps the token toggle_group at six options to satisfy the Snap spec", () => {
    const snap = buildTradeCommandSnapResponse(
      {
        ...baseCtx,
        symbols: ["AERO", "DEGEN", "VIRTUAL", "BRETT", "HIGHER", "AIXBT", "TOSHI"],
        defaultSymbol: "AERO",
      },
      snapLinks,
    );

    expect(snap.ui.elements.symbol?.props?.options).toHaveLength(6);
    expect(snap.ui.elements.symbol?.props?.options).toEqual([
      "AERO",
      "DEGEN",
      "VIRTUAL",
      "BRETT",
      "HIGHER",
      "AIXBT",
    ]);
  });

  it("falls back to open_mini_app for Standings/Wallet when no FID is available", () => {
    const snap = buildTradeCommandSnapResponse(baseCtx, {
      ...snapLinks,
      standings: {
        action: "open_mini_app",
        target: "https://app.example/?tab=standings",
      },
      wallet: {
        action: "open_mini_app",
        target: "https://app.example/?tab=wallet",
      },
    });

    expect(snap.ui.elements.act_standings?.on?.press?.action).toBe(
      "open_mini_app",
    );
    expect(snap.ui.elements.act_wallet?.on?.press?.action).toBe(
      "open_mini_app",
    );
  });
});

describe("buildTradeCommandConfirmSnapResponse", () => {
  it("renders a compose_cast primary button with the interpolated text", () => {
    const snap = buildTradeCommandConfirmSnapResponse(
      { castText: "@commo buy 5 usdc of aero" },
      {
        miniApp: "https://app.example/?tab=trade",
        editSnap: "https://app.example/api/snaps/trade-command?fid=123",
      },
    );

    const { elements } = snap.ui;
    expect(elements.root?.children).toEqual([
      "hdr",
      "body",
      "preview",
      "compose",
      "nav",
      "open_app",
    ]);
    expect(elements.preview?.props?.content).toBe("@commo buy 5 usdc of aero");
    expect(elements.compose?.on?.press).toEqual({
      action: "compose_cast",
      params: { text: "@commo buy 5 usdc of aero" },
    });
    expect(elements.act_back?.on?.press).toEqual({
      action: "open_snap",
      params: { target: "https://app.example/api/snaps/trade-command?fid=123" },
    });
    expect(elements.open_app?.on?.press?.action).toBe("open_mini_app");
  });

  it("renders an error state that keeps Edit + Open Mini App available", () => {
    const snap = buildTradeCommandConfirmSnapResponse(
      { castText: "", error: "Pick Buy or Sell to continue." },
      {
        miniApp: "https://app.example/?tab=trade",
        editSnap: "https://app.example/api/snaps/trade-command?fid=123",
      },
    );

    const { elements } = snap.ui;
    expect(elements.body?.props?.content).toBe("Pick Buy or Sell to continue.");
    expect(elements.compose).toBeUndefined();
    expect(elements.act_back?.on?.press?.action).toBe("open_snap");
  });
});
