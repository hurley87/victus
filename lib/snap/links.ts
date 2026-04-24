import { miniAppTabDeepLink, type MiniAppTab } from "@/lib/commodus/deep-links";

import type { SnapActionLinks } from "./response";

export function snapRouteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${path}`;
}

// FID is threaded through as a query param so the handler can emit an
// `open_snap` link to /api/snaps/standings/:fid for viewers who arrive from a
// FID-aware parent snap.
export function tradeCommandSnapUrl(origin: string, fid: number): string {
  return snapRouteUrl(origin, `/api/snaps/trade-command?fid=${fid}`);
}

export function snapActionLinksForFid(
  origin: string,
  fid: number,
  miniAppTab: MiniAppTab,
): SnapActionLinks {
  return {
    tradeSnap: tradeCommandSnapUrl(origin, fid),
    standingsSnap: snapRouteUrl(origin, `/api/snaps/standings/${fid}`),
    miniApp: miniAppTabDeepLink(miniAppTab),
  };
}
