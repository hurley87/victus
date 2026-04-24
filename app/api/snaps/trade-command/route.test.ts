import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArenaRules } from "@/lib/arena/types";
import { SNAP_MEDIA } from "@/lib/snap/http";

import { GET } from "./route";

const mockRules: ArenaRules = {
  whitelist: [
    { symbol: "AERO", name: "Aerodrome", is_tradable: true },
    { symbol: "DEGEN", name: "Degen", is_tradable: true },
    { symbol: "VIRTUAL", name: "Virtuals", is_tradable: true },
  ],
  max_trade_usdc: 10,
  max_trades_per_day: 3,
  wallet_cap_usdc: 5_000,
  min_mint_deposit_usdc: 5,
  swap_fee_bps: 50,
  swap_fee_min_usdc: 0.1,
};

vi.mock("@/lib/commodus/deep-links", () => ({
  miniAppTabDeepLink: (tab: string) => `https://app.test/?tab=${tab}`,
}));

vi.mock("@/lib/arena/service", () => ({
  getPublicArenaRules: vi.fn(),
}));

import { getPublicArenaRules } from "@/lib/arena/service";

function snapRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: {
      Accept: SNAP_MEDIA,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

type SnapPressAction = {
  action: string;
  params?: { text?: string; target?: string };
};

type SnapJsonBody = {
  version: string;
  ui: {
    root: string;
    elements: Record<
      string,
      {
        type?: string;
        props?: { content?: string; title?: string; label?: string };
        children?: string[];
        on?: { press?: SnapPressAction };
      }
    >;
  };
};

describe("GET /api/snaps/trade-command", () => {
  beforeEach(() => {
    vi.mocked(getPublicArenaRules).mockResolvedValue(mockRules);
  });

  it("returns HTML with Link alternate when Accept is not a Snap media type", async () => {
    const req = new NextRequest("https://example.com/api/snaps/trade-command");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
    const link = res.headers.get("Link");
    expect(link).toContain('rel="alternate"');
    expect(link).toContain("application/vnd.farcaster.snap+json");
    expect(link).toContain("https://example.com/api/snaps/trade-command");
    const html = await res.text();
    expect(html).toContain("Open Mini App");
    expect(html).toContain("https://app.test/?tab=trade");
  });

  it("returns Snap 2.0 compose_cast + Standings/Wallet/Open Mini App card", async () => {
    const req = snapRequest("https://example.com/api/snaps/trade-command");
    const res = await GET(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(SNAP_MEDIA);
    expect(body.version).toBe("2.0");

    expect(body.ui.elements.compose?.on?.press?.action).toBe("compose_cast");
    expect(body.ui.elements.compose?.on?.press?.params?.text).toBe(
      "@commo buy 1 usdc of aero",
    );

    expect(body.ui.elements.nav?.children).toEqual([
      "act_standings",
      "act_wallet",
    ]);
    expect(body.ui.elements.act_wallet?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: "https://app.test/?tab=wallet" },
    });

    expect(body.ui.elements.open_app?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: "https://app.test/?tab=trade" },
    });

    expect(body.ui.elements.mode).toBeUndefined();
    expect(body.ui.elements.token).toBeUndefined();
    expect(body.ui.elements.preview).toBeUndefined();
  });

  it("uses open_snap for Standings when a viewer FID is provided via query", async () => {
    const req = snapRequest(
      "https://example.com/api/snaps/trade-command?fid=123",
    );
    const res = await GET(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(body.ui.elements.act_standings?.on?.press).toEqual({
      action: "open_snap",
      params: { target: "https://example.com/api/snaps/standings/123" },
    });
  });

  it("falls back to open_mini_app for Standings when no valid FID is present", async () => {
    const req = snapRequest(
      "https://example.com/api/snaps/trade-command?fid=0",
    );
    const res = await GET(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(body.ui.elements.act_standings?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: "https://app.test/?tab=standings" },
    });
  });
});
