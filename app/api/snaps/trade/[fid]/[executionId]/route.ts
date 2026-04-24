import { NextResponse, type NextRequest } from "next/server";

import { miniAppSnapLinks } from "@/lib/commodus/deep-links";
import { buildTradeSnapResponse } from "@/lib/snap/build-trade-snap";
import {
  escapeHtml,
  requestAcceptsSnap,
  SNAP_MEDIA,
  snapVaryHeader,
} from "@/lib/snap/http";
import { loadTradeSnapContext } from "@/lib/snap/load-trade-snap-context";

export const dynamic = "force-dynamic";

function snapResourceUrl(
  request: NextRequest,
  fid: number,
  executionId: string,
): string {
  return `${request.nextUrl.origin}/api/snaps/trade/${fid}/${encodeURIComponent(executionId)}`;
}

function htmlFallbackForNonSnapAccept(
  request: NextRequest,
  fid: number,
  executionId: string,
): NextResponse {
  const selfUrl = snapResourceUrl(request, fid, executionId);
  const links = miniAppSnapLinks();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Victus trade</title>
</head>
<body>
  <p>Victus trade Snap</p>
  <p><a href="${escapeHtml(links.wallet)}">View Wallet</a></p>
  <p><a href="${escapeHtml(links.trade)}">Trade</a></p>
  <p><a href="${escapeHtml(links.standings)}">Standings</a></p>
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ fid: string; executionId: string }> },
) {
  const { fid: fidRaw, executionId: executionIdRaw } = await context.params;
  const fid = Number(fidRaw);
  const executionId = decodeURIComponent(executionIdRaw).trim();

  if (!Number.isInteger(fid) || fid <= 0) {
    return NextResponse.json({ error: "Invalid fid" }, { status: 400 });
  }
  if (!executionId) {
    return NextResponse.json({ error: "Invalid execution id" }, { status: 400 });
  }

  if (!requestAcceptsSnap(request.headers.get("accept"))) {
    return htmlFallbackForNonSnapAccept(request, fid, executionId);
  }

  try {
    const view = await loadTradeSnapContext(fid, executionId);
    if (!view) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const snap = buildTradeSnapResponse(view, miniAppSnapLinks());
    const selfSnapUrl = snapResourceUrl(request, fid, executionId);

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
    console.error("snaps/trade GET failed", err);
    return NextResponse.json({ error: "Failed to load snap" }, { status: 500 });
  }
}
