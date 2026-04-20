import { NextResponse, type NextRequest } from "next/server";

import { portfolioDeepLinkForFid } from "@/lib/commodus/deep-links";
import { buildStatusSnapResponse } from "@/lib/snap/build-status-snap";
import { loadStatusViewContext } from "@/lib/status/load-context";

export const dynamic = "force-dynamic";

const SNAP_MEDIA = "application/vnd.farcaster.snap+json";

/** Same host the client used (important for tunnel / preview URLs). */
function snapResourceUrl(request: NextRequest, fid: number): string {
  const u = new URL(request.url);
  return `${u.origin}/api/snaps/status/${fid}`;
}

function requestAcceptsSnap(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false;
  return acceptHeader.split(",").some((part) => {
    const raw = part.trim().split(";")[0];
    return raw?.trim() === SNAP_MEDIA;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
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
  const portfolioUrl = portfolioDeepLinkForFid(fid);
  const linkHeader = `<${selfUrl}>; rel="alternate"; type="${SNAP_MEDIA}"`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Commodus status</title>
</head>
<body>
  <p>Commodus status Snap</p>
  <p><a href="${escapeHtml(portfolioUrl)}">Open portfolio</a></p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      Link: linkHeader,
      Vary: request.headers.get("origin") ? "Accept, Origin" : "Accept",
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

    const miniAppUrl = portfolioDeepLinkForFid(fid);
    const snap = buildStatusSnapResponse(view, miniAppUrl);

    const linkDiscovery = `<${snapResourceUrl(request, fid)}>; rel="alternate"; type="${SNAP_MEDIA}"`;

    return NextResponse.json(snap, {
      status: 200,
      headers: {
        "Content-Type": SNAP_MEDIA,
        "Cache-Control": "no-store",
        Link: linkDiscovery,
        Vary: request.headers.get("origin") ? "Accept, Origin" : "Accept",
      },
    });
  } catch (err) {
    console.error("snaps/status GET failed", err);
    return NextResponse.json({ error: "Failed to load snap" }, { status: 500 });
  }
}
