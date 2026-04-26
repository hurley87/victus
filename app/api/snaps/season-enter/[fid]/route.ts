import { NextResponse, type NextRequest } from "next/server";

import { arenaDeepLink } from "@/lib/commodus/deep-links";
import { buildSeasonEnterSnapResponse } from "@/lib/snap/build-season-enter-snap";
import {
  escapeHtml,
  requestAcceptsSnap,
  SNAP_MEDIA,
  snapVaryHeader,
} from "@/lib/snap/http";

export const dynamic = "force-dynamic";

/** Same origin the client used — important for tunnel / preview URLs. */
function snapResourceUrl(request: NextRequest, fid: number): string {
  return `${request.nextUrl.origin}/api/snaps/season-enter/${fid}`;
}

/**
 * Plain GET (no Snap Accept) — e.g. Warpcast unfurl, crawlers — must still discover
 * the Snap per https://docs.farcaster.xyz/snap/http-headers (`Link` alternate).
 */
function htmlFallbackForNonSnapAccept(
  request: NextRequest,
  fid: number,
): NextResponse {
  const selfUrl = snapResourceUrl(request, fid);
  const arenaUrl = arenaDeepLink();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Enter Victus week</title>
</head>
<body>
  <p>Join this week's arena to trade.</p>
  <p><a href="${escapeHtml(arenaUrl)}">Open arena</a></p>
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
  if (!Number.isInteger(fid) || fid <= 0) {
    return NextResponse.json({ error: "Invalid fid" }, { status: 400 });
  }

  if (!requestAcceptsSnap(request.headers.get("accept"))) {
    return htmlFallbackForNonSnapAccept(request, fid);
  }

  const selfSnapUrl = snapResourceUrl(request, fid);
  const snap = buildSeasonEnterSnapResponse({
    miniAppArenaUrl: arenaDeepLink(),
  });

  return NextResponse.json(snap, {
    status: 200,
    headers: {
      "Content-Type": SNAP_MEDIA,
      "Cache-Control": "no-store",
      Link: `<${selfSnapUrl}>; rel="alternate"; type="${SNAP_MEDIA}"`,
      Vary: snapVaryHeader(request),
    },
  });
}
