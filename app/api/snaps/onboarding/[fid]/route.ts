import { NextResponse, type NextRequest } from "next/server";

import { walletDeepLink } from "@/lib/commodus/deep-links";
import { buildOnboardingSnapResponse } from "@/lib/snap/build-onboarding-snap";
import {
  escapeHtml,
  requestAcceptsSnap,
  SNAP_MEDIA,
  snapVaryHeader,
} from "@/lib/snap/http";

export const dynamic = "force-dynamic";

/** Same origin the client used — important for tunnel / preview URLs. */
function snapResourceUrl(request: NextRequest, fid: number, taunt: boolean): string {
  const url = `${request.nextUrl.origin}/api/snaps/onboarding/${fid}`;
  return taunt ? `${url}?taunt=1` : url;
}

/**
 * Plain GET (no Snap Accept) — e.g. Warpcast unfurl, crawlers — must still discover
 * the Snap per https://docs.farcaster.xyz/snap/http-headers (`Link` alternate).
 */
function htmlFallbackForNonSnapAccept(
  request: NextRequest,
  fid: number,
): NextResponse {
  const selfUrl = snapResourceUrl(request, fid, false);
  const walletUrl = walletDeepLink();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Victus arena challenge</title>
</head>
<body>
  <p>Commodus waits in the Victus games.</p>
  <p><a href="${escapeHtml(walletUrl)}">Enter the Mini App</a></p>
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

  const taunt = request.nextUrl.searchParams.get("taunt") === "1";
  const selfSnapUrl = snapResourceUrl(request, fid, false);
  const snap = buildOnboardingSnapResponse({
    taunt,
    tauntUrl: snapResourceUrl(request, fid, true),
    miniAppWalletUrl: walletDeepLink(),
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
