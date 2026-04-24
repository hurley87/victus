import { NextResponse, type NextRequest } from "next/server";

import { getPublicArenaRules } from "@/lib/arena/service";
import { COMMAND_BOT_HANDLE } from "@/lib/commodus/bot";
import { miniAppTabDeepLink } from "@/lib/commodus/deep-links";
import {
  buildTradeCommandSnapResponse,
  type TradeCommandSnapContext,
} from "@/lib/snap/build-trade-command-snap";
import {
  escapeHtml,
  requestAcceptsSnap,
  SNAP_MEDIA,
  snapVaryHeader,
} from "@/lib/snap/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function snapResourceUrl(request: NextRequest): string {
  return `${request.nextUrl.origin}/api/snaps/trade-command`;
}

function htmlFallbackForNonSnapAccept(request: NextRequest): NextResponse {
  const selfUrl = snapResourceUrl(request);
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

async function loadContext(): Promise<TradeCommandSnapContext> {
  const rules = await getPublicArenaRules();
  const firstToken =
    rules.whitelist
      .filter((entry) => entry.is_tradable)
      .map((entry) => entry.symbol.toUpperCase())
      .find(Boolean) ?? "AERO";

  return {
    starterCommand: `${COMMAND_BOT_HANDLE} buy 1 usdc of ${firstToken.toLowerCase()}`,
    buyExample: `buy 5 usdc of ${firstToken.toLowerCase()}`,
    sellExample: `sell 50% of ${firstToken.toLowerCase()}`,
  };
}

export async function GET(request: NextRequest) {
  if (!requestAcceptsSnap(request.headers.get("accept"))) {
    return htmlFallbackForNonSnapAccept(request);
  }

  try {
    const ctx = await loadContext();
    const fidParam = request.nextUrl.searchParams.get("fid");
    const fid = fidParam ? Number(fidParam) : NaN;
    const standings =
      Number.isInteger(fid) && fid > 0
        ? {
            action: "open_snap" as const,
            target: `${request.nextUrl.origin}/api/snaps/standings/${fid}`,
          }
        : {
            action: "open_mini_app" as const,
            target: miniAppTabDeepLink("standings"),
          };

    const snap = buildTradeCommandSnapResponse(ctx, {
      standings,
      walletMiniApp: miniAppTabDeepLink("wallet"),
      miniApp: miniAppTabDeepLink("trade"),
    });
    const selfSnapUrl = snapResourceUrl(request);

    return NextResponse.json(snap, {
      status: 200,
      headers: {
        "Content-Type": SNAP_MEDIA,
        "Cache-Control": "no-store",
        Link: `<${selfSnapUrl}>; rel="alternate"; type="${SNAP_MEDIA}"`,
        Vary: snapVaryHeader(request),
      },
    });
  } catch (err) {
    console.error("snaps/trade-command GET failed", err);
    return NextResponse.json({ error: "Failed to load snap" }, { status: 500 });
  }
}
