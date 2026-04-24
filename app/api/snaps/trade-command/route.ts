import { NextResponse, type NextRequest } from "next/server";

import { getPublicArenaRules } from "@/lib/arena/service";
import type { ArenaRules } from "@/lib/arena/types";
import { miniAppTabDeepLink } from "@/lib/commodus/deep-links";
import {
  buildTradeCommandConfirmSnapResponse,
  buildTradeCommandSnapResponse,
  TRADE_COMMAND_SYMBOL_LIMIT,
  type TradeCommandSnapContext,
  type TradeCommandSnapLinks,
  type StandingsPress,
} from "@/lib/snap/build-trade-command-snap";
import {
  escapeHtml,
  requestAcceptsSnap,
  SNAP_MEDIA,
  snapVaryHeader,
} from "@/lib/snap/http";
import { standingsSnapUrl, walletSnapUrl } from "@/lib/snap/links";
import { interpolateTradeCommand } from "@/lib/snap/trade-command-text";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function snapResourceUrl(request: NextRequest, fid: number | null): string {
  const base = `${request.nextUrl.origin}/api/snaps/trade-command`;
  return fid ? `${base}?fid=${fid}` : base;
}

function htmlFallbackForNonSnapAccept(request: NextRequest): NextResponse {
  const selfUrl = `${request.nextUrl.origin}/api/snaps/trade-command`;
  const tradeUrl = miniAppTabDeepLink("trade");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Victus trade command</title>
</head>
<body>
  <p>Victus trade command Snap</p>
  <p><a href="${escapeHtml(tradeUrl)}">Open Mini App</a></p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      Link: `<${selfUrl}>; rel="alternate"; type="${SNAP_MEDIA}"`,
      Vary: snapVaryHeader(request),
    },
  });
}

function parseFid(request: NextRequest): number | null {
  const raw = request.nextUrl.searchParams.get("fid");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function loadContext(rules: ArenaRules): TradeCommandSnapContext {
  const symbols = rules.whitelist
    .filter((entry) => entry.is_tradable)
    .map((entry) => entry.symbol.toUpperCase())
    .slice(0, TRADE_COMMAND_SYMBOL_LIMIT);
  const defaultBuy = Math.min(5, rules.max_trade_usdc || 5);

  return {
    symbols,
    defaultSymbol: symbols[0] ?? "AERO",
    amountDefault: String(defaultBuy),
  };
}

function navLinksForFid(
  request: NextRequest,
  fid: number | null,
): { standings: StandingsPress; wallet: StandingsPress } {
  if (fid) {
    return {
      standings: {
        action: "open_snap",
        target: standingsSnapUrl(request.nextUrl.origin, fid),
      },
      wallet: {
        action: "open_snap",
        target: walletSnapUrl(request.nextUrl.origin, fid),
      },
    };
  }
  return {
    standings: {
      action: "open_mini_app",
      target: miniAppTabDeepLink("standings"),
    },
    wallet: {
      action: "open_mini_app",
      target: miniAppTabDeepLink("wallet"),
    },
  };
}

function snapHeaders(selfUrl: string, request: NextRequest): HeadersInit {
  return {
    "Content-Type": SNAP_MEDIA,
    "Cache-Control": "no-store",
    Link: `<${selfUrl}>; rel="alternate"; type="${SNAP_MEDIA}"`,
    Vary: snapVaryHeader(request),
  };
}

export async function GET(request: NextRequest) {
  if (!requestAcceptsSnap(request.headers.get("accept"))) {
    return htmlFallbackForNonSnapAccept(request);
  }

  try {
    const rules = await getPublicArenaRules();
    const ctx = loadContext(rules);
    const fid = parseFid(request);
    const nav = navLinksForFid(request, fid);

    const links: TradeCommandSnapLinks = {
      composeSubmit: snapResourceUrl(request, fid),
      standings: nav.standings,
      wallet: nav.wallet,
      miniApp: miniAppTabDeepLink("trade"),
    };

    const snap = buildTradeCommandSnapResponse(ctx, links);
    return NextResponse.json(snap, {
      status: 200,
      headers: snapHeaders(snapResourceUrl(request, fid), request),
    });
  } catch (err) {
    console.error("snaps/trade-command GET failed", err);
    return NextResponse.json({ error: "Failed to load snap" }, { status: 500 });
  }
}

type SubmitBody = { inputs?: Record<string, unknown> };

async function parseSubmitBody(request: NextRequest): Promise<SubmitBody> {
  try {
    return (await request.json()) as SubmitBody;
  } catch {
    return {};
  }
}

/**
 * Snap submit handler — reads the form inputs the client POSTed with the
 * `submit` action, interpolates the trade command, and returns a
 * confirmation snap whose primary button fires `compose_cast` with the
 * fully-rendered text.
 *
 * @see https://docs.farcaster.xyz/snap/buttons#input-data-in-post-requests
 */
export async function POST(request: NextRequest) {
  try {
    const rules = await getPublicArenaRules();
    const ctx = loadContext(rules);
    const fid = parseFid(request);
    const selfUrl = snapResourceUrl(request, fid);
    const body = await parseSubmitBody(request);

    const result = interpolateTradeCommand(body.inputs ?? {}, {
      allowedSymbols: ctx.symbols,
      maxBuyUsdc: rules.max_trade_usdc,
    });

    const snap = buildTradeCommandConfirmSnapResponse(
      result.ok
        ? { castText: result.castText }
        : { castText: "", error: result.error },
      { miniApp: miniAppTabDeepLink("trade"), editSnap: selfUrl },
    );

    return NextResponse.json(snap, {
      status: 200,
      headers: snapHeaders(selfUrl, request),
    });
  } catch (err) {
    console.error("snaps/trade-command POST failed", err);
    return NextResponse.json({ error: "Failed to submit trade" }, { status: 500 });
  }
}
