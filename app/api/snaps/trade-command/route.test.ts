import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArenaRules } from "@/lib/arena/types";
import { SNAP_MEDIA } from "@/lib/snap/http";

import { GET, POST } from "./route";

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

function snapRequest(
  url: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: {
      Accept: SNAP_MEDIA,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
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
        props?: {
          content?: string;
          title?: string;
          label?: string;
          name?: string;
          options?: string[];
          defaultValue?: string;
        };
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

  it("returns Snap 2.0 with the Trade form and Make Trade submit CTA", async () => {
    const req = snapRequest(
      "https://example.com/api/snaps/trade-command?fid=123",
    );
    const res = await GET(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(SNAP_MEDIA);
    expect(body.version).toBe("2.0");

    expect(body.ui.elements.action?.type).toBe("toggle_group");
    expect(body.ui.elements.action?.props?.options).toEqual(["Buy", "Sell"]);
    expect(body.ui.elements.symbol?.props?.options).toEqual([
      "AERO",
      "DEGEN",
      "VIRTUAL",
    ]);
    expect(body.ui.elements.amount?.type).toBe("input");

    expect(body.ui.elements.compose?.props?.label).toBe("Make Trade");
    expect(body.ui.elements.compose?.on?.press).toEqual({
      action: "submit",
      params: {
        target: "https://example.com/api/snaps/trade-command?fid=123",
      },
    });

    expect(body.ui.elements.act_standings?.on?.press).toEqual({
      action: "open_snap",
      params: { target: "https://example.com/api/snaps/standings/123" },
    });
    expect(body.ui.elements.act_wallet?.on?.press).toEqual({
      action: "open_snap",
      params: { target: "https://example.com/api/snaps/status/123" },
    });

    expect(body.ui.elements.open_app?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: "https://app.test/?tab=trade" },
    });
  });

  it("falls back to open_mini_app for Standings/Wallet when no valid FID is present", async () => {
    const req = snapRequest(
      "https://example.com/api/snaps/trade-command?fid=0",
    );
    const res = await GET(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(body.ui.elements.act_standings?.on?.press?.action).toBe(
      "open_mini_app",
    );
    expect(body.ui.elements.act_wallet?.on?.press?.action).toBe(
      "open_mini_app",
    );
  });
});

describe("POST /api/snaps/trade-command", () => {
  beforeEach(() => {
    vi.mocked(getPublicArenaRules).mockResolvedValue(mockRules);
  });

  it("returns a compose_cast confirmation snap for a valid buy submission", async () => {
    const req = snapRequest(
      "https://example.com/api/snaps/trade-command?fid=123",
      {
        method: "POST",
        body: JSON.stringify({
          inputs: { action: "Buy", symbol: "AERO", amount: "5" },
        }),
      },
    );
    const res = await POST(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(SNAP_MEDIA);
    expect(body.ui.elements.preview?.props?.content).toBe(
      "@commo buy 5 usdc of aero",
    );
    expect(body.ui.elements.compose?.on?.press).toEqual({
      action: "compose_cast",
      params: { text: "@commo buy 5 usdc of aero" },
    });
    expect(body.ui.elements.act_back?.on?.press).toEqual({
      action: "open_snap",
      params: {
        target: "https://example.com/api/snaps/trade-command?fid=123",
      },
    });
    expect(body.ui.elements.open_app?.on?.press?.action).toBe("open_mini_app");
  });

  it("interpolates a sell percentage command", async () => {
    const req = snapRequest(
      "https://example.com/api/snaps/trade-command?fid=123",
      {
        method: "POST",
        body: JSON.stringify({
          inputs: { action: "Sell", symbol: "DEGEN", amount: "50" },
        }),
      },
    );
    const res = await POST(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(body.ui.elements.compose?.on?.press?.params?.text).toBe(
      "@commo sell 50% of degen",
    );
  });

  it("returns an error snap with an Edit button when inputs are invalid", async () => {
    const req = snapRequest(
      "https://example.com/api/snaps/trade-command?fid=123",
      {
        method: "POST",
        body: JSON.stringify({
          inputs: { action: "Buy", symbol: "AERO", amount: "0" },
        }),
      },
    );
    const res = await POST(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(body.ui.elements.body?.props?.content).toContain("Enter an amount");
    expect(body.ui.elements.compose).toBeUndefined();
    expect(body.ui.elements.act_back?.on?.press?.action).toBe("open_snap");
  });

  it("rejects amounts above the arena's max buy", async () => {
    const req = snapRequest(
      "https://example.com/api/snaps/trade-command?fid=123",
      {
        method: "POST",
        body: JSON.stringify({
          inputs: { action: "Buy", symbol: "AERO", amount: "25" },
        }),
      },
    );
    const res = await POST(req);
    const body = (await res.json()) as SnapJsonBody;

    expect(body.ui.elements.body?.props?.content).toContain("Max buy is 10");
  });
});
