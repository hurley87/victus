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
    const url = portfolioDeepLinkForFid(fid);
    return NextResponse.redirect(url, { status: 307 });
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
