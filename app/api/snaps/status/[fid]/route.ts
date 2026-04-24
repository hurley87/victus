import { NextResponse, type NextRequest } from "next/server";

import { miniAppTabDeepLink } from "@/lib/commodus/deep-links";
import { buildStatusSnapResponse } from "@/lib/snap/build-status-snap";
import {
  escapeHtml,
  requestAcceptsSnap,
  SNAP_MEDIA,
  snapVaryHeader,
} from "@/lib/snap/http";
import { snapActionLinksForFid } from "@/lib/snap/links";
import { loadStatusViewContext } from "@/lib/status/load-context";

export const dynamic = "force-dynamic";

/** Same origin the client used — important for tunnel / preview URLs. */
function snapResourceUrl(request: NextRequest, fid: number): string {
  return `${request.nextUrl.origin}/api/snaps/status/${fid}`;
}

/**
 * Plain GET (no Snap Accept) — e.g. Warpcast unfurl, crawlers — must still discover
 * the Snap per https://docs.farcaster.xyz/snap/http-headers (`Link` alternate).
 * A 307 to the Mini App URL makes clients preview the wrong surface; do not redirect.
 */
function htmlFallbackForNonSnapAccept(
  request: NextRequest,
  fid: number,
): NextResponse {
  const selfUrl = snapResourceUrl(request, fid);
  const walletUrl = miniAppTabDeepLink("wallet");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Commodus status</title>
</head>
<body>
  <p>Commodus status Snap</p>
  <p><a href="${escapeHtml(walletUrl)}">Open Mini App</a></p>
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
  context: { params: Promise<{ fid: string }> },
) {
  const { fid: fidRaw } = await context.params;
  const fid = Number(fidRaw);
  if (!Number.isFinite(fid) || fid <= 0 || !Number.isInteger(fid)) {
    return NextResponse.json({ error: "Invalid fid" }, { status: 400 });
  }

  if (!requestAcceptsSnap(request.headers.get("accept"))) {
    return htmlFallbackForNonSnapAccept(request, fid);
  }

  try {
    const view = await loadStatusViewContext(fid);
    if (!view) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const snap = buildStatusSnapResponse(
      view,
      snapActionLinksForFid(request.nextUrl.origin, fid, "wallet"),
    );
    const selfSnapUrl = snapResourceUrl(request, fid);

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
    console.error("snaps/status GET failed", err);
    return NextResponse.json({ error: "Failed to load snap" }, { status: 500 });
  }
}
