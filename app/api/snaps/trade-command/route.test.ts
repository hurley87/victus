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

vi.mock("@/lib/snap/jfs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/snap/jfs")>();
  return {
    ...mod,
    verifySnapActionRequest: vi.fn(),
  };
});

import { getPublicArenaRules } from "@/lib/arena/service";
import { SnapJfsError, verifySnapActionRequest } from "@/lib/snap/jfs";

function snapRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: { Accept: SNAP_MEDIA, ...(init?.headers as Record<string, string> | undefined) },
  });
}

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

  it("returns Snap 2.0 form JSON when Accept is the Snap media type", async () => {
    const req = snapRequest("https://example.com/api/snaps/trade-command");
    const res = await GET(req);
    const body = (await res.json()) as {
      version: string;
      ui: { elements: Record<string, { on?: { press?: { action: string } } }> },
    };

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(SNAP_MEDIA);
    expect(body.version).toBe("2.0");
    expect(body.ui.elements.compose).toBeUndefined();
    expect(body.ui.elements.cast).toBeUndefined();
    expect(body.ui.elements.preview?.on?.press).toBeDefined();
  });
});

describe("POST /api/snaps/trade-command", () => {
  beforeEach(() => {
    vi.mocked(getPublicArenaRules).mockResolvedValue(mockRules);
  });

  it("returns compose preview for a valid buy", async () => {
    vi.mocked(verifySnapActionRequest).mockResolvedValue({
      fid: 1,
      payload: {
        inputs: {
          mode: "Buy",
          token: "AERO",
          buyAmount: "3",
        },
      },
    });

    const req = snapRequest("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    const body = (await res.json()) as {
      ui: { elements: Record<string, { props?: { content?: string }; on?: { press?: { action: string; params?: { text?: string } } } }> },
    };

    expect(res.status).toBe(200);
    expect(body.ui.elements.cast?.props?.content).toBe(
      "@commo buy 3 usdc of aero",
    );
    expect(body.ui.elements.compose?.on?.press).toEqual({
      action: "compose_cast",
      params: { text: "@commo buy 3 usdc of aero" },
    });
  });

  it("returns compose preview for a valid sell", async () => {
    vi.mocked(verifySnapActionRequest).mockResolvedValue({
      fid: 1,
      payload: {
        inputs: {
          mode: "Sell",
          token: "AERO",
          sellPercent: "50",
        },
      },
    });

    const req = snapRequest("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    const body = (await res.json()) as {
      ui: { elements: Record<string, { props?: { content?: string } }> },
    };

    expect(body.ui.elements.cast?.props?.content).toBe(
      "@commo sell 50% of aero",
    );
  });

  it("returns over-cap buy error on the form without compose", async () => {
    vi.mocked(verifySnapActionRequest).mockResolvedValue({
      fid: 1,
      payload: {
        inputs: {
          mode: "Buy",
          token: "AERO",
          buyAmount: "999",
        },
      },
    });

    const req = snapRequest("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    const body = (await res.json()) as {
      ui: { elements: Record<string, { props?: { content?: string } }> },
    };

    expect(body.ui.elements.note?.props?.content).toMatch(
      /^Max buy is 10 USDC\./,
    );
    expect(body.ui.elements.compose).toBeUndefined();
  });

  it.each([
    { sellPercent: "0" },
    { sellPercent: "150" },
    { sellPercent: "12.5" },
  ] as const)("rejects sell percent $sellPercent", async ({ sellPercent }) => {
    vi.mocked(verifySnapActionRequest).mockResolvedValue({
      fid: 1,
      payload: {
        inputs: {
          mode: "Sell",
          token: "AERO",
          sellPercent,
        },
      },
    });

    const req = snapRequest("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    const body = (await res.json()) as {
      ui: { elements: Record<string, { props?: { content?: string } }> },
    };

    expect(body.ui.elements.note?.props?.content).toBe(
      "Sell amount must be a whole percent from 1 to 100.",
    );
    expect(body.ui.elements.compose).toBeUndefined();
  });

  it("rejects a non-whitelisted token", async () => {
    vi.mocked(verifySnapActionRequest).mockResolvedValue({
      fid: 1,
      payload: {
        inputs: {
          mode: "Buy",
          token: "ZZZ",
          buyAmount: "1",
        },
      },
    });

    const req = snapRequest("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    const body = (await res.json()) as {
      ui: { elements: Record<string, { props?: { content?: string } }> },
    };

    expect(body.ui.elements.note?.props?.content).toBe("Pick a live arena token.");
    expect(body.ui.elements.compose).toBeUndefined();
  });

  it("returns 401 when verifySnapActionRequest throws SnapJfsError", async () => {
    vi.mocked(verifySnapActionRequest).mockRejectedValue(
      new SnapJfsError("Invalid snap signature", 401),
    );

    const req = snapRequest("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    const errBody = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(errBody.error).toBe("Invalid snap signature");
  });
});
