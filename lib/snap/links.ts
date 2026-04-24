import { miniAppTabDeepLink, type MiniAppTab } from "@/lib/commodus/deep-links";

import type { SnapActionLinks } from "./response";

export function snapRouteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${path}`;
}

/**
 * The trade-command snap has no per-FID data, but its inline Standings button
 * should link to the viewer's standings snap. We encode the FID in the query
 * string so the handler can relay it downstream.
 */
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
    walletMiniApp: miniAppTabDeepLink("wallet"),
  };
}
