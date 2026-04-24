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

export function standingsSnapUrl(origin: string, fid: number): string {
  return snapRouteUrl(origin, `/api/snaps/standings/${fid}`);
}

/** Canonical "Wallet" snap URL — the status snap doubles as the portfolio card. */
export function walletSnapUrl(origin: string, fid: number): string {
  return snapRouteUrl(origin, `/api/snaps/status/${fid}`);
}

export function snapActionLinksForFid(
  origin: string,
  fid: number,
  miniAppTab: MiniAppTab,
): SnapActionLinks {
  return {
    tradeSnap: tradeCommandSnapUrl(origin, fid),
    standingsSnap: standingsSnapUrl(origin, fid),
    walletSnap: walletSnapUrl(origin, fid),
    miniApp: miniAppTabDeepLink(miniAppTab),
  };
}
