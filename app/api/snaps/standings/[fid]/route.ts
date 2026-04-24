import { NextResponse, type NextRequest } from "next/server";

import { miniAppTabDeepLink } from "@/lib/commodus/deep-links";
import { buildStandingsSnapResponse } from "@/lib/snap/build-standings-snap";
import {
  escapeHtml,
  requestAcceptsSnap,
  SNAP_MEDIA,
  snapVaryHeader,
} from "@/lib/snap/http";
import { snapActionLinksForFid } from "@/lib/snap/links";
import { loadStandingsSnapContext } from "@/lib/snap/load-standings-snap-context";

export const dynamic = "force-dynamic";

function snapResourceUrl(request: NextRequest, fid: number): string {
  return `${request.nextUrl.origin}/api/snaps/standings/${fid}`;
}

function htmlFallbackForNonSnapAccept(
  request: NextRequest,
  fid: number,
): NextResponse {
  const selfUrl = snapResourceUrl(request, fid);
  const standingsUrl = miniAppTabDeepLink("standings");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Victus standings</title>
</head>
<body>
  <p>Victus standings Snap</p>
  <p><a href="${escapeHtml(standingsUrl)}">Open Mini App</a></p>
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

  try {
    const view = await loadStandingsSnapContext(fid);
    if (!view) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const snap = buildStandingsSnapResponse(
      view,
      snapActionLinksForFid(request.nextUrl.origin, fid, "standings"),
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
    console.error("snaps/standings GET failed", err);
    return NextResponse.json({ error: "Failed to load snap" }, { status: 500 });
  }
}
