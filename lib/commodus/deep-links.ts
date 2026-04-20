import { env } from "@/lib/env";

/**
 * HTTPS URL that opens the Mini App portfolio screen for a given Farcaster FID.
 * Used by `@commodus status` replies (issue #13) so any client resolves the same
 * ledger as the cast author, not the viewer's session default.
 */
export function portfolioDeepLinkForFid(fid: number): string {
  if (!Number.isFinite(fid) || fid <= 0 || !Number.isInteger(fid)) {
    throw new Error("portfolioDeepLinkForFid: fid must be a positive integer");
  }
  const base = env.NEXT_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/portfolio?fid=${fid}`;
}
