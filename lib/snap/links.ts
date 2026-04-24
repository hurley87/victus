import { miniAppTabDeepLink, type MiniAppTab } from "@/lib/commodus/deep-links";

import type { SnapActionLinks } from "./response";

export function snapRouteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${path}`;
}

export function snapActionLinksForFid(
  origin: string,
  fid: number,
  miniAppTab: MiniAppTab,
): SnapActionLinks {
  return {
    tradeSnap: snapRouteUrl(origin, "/api/snaps/trade-command"),
    standingsSnap: snapRouteUrl(origin, `/api/snaps/standings/${fid}`),
    miniApp: miniAppTabDeepLink(miniAppTab),
  };
}
