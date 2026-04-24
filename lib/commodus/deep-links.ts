import { env } from "@/lib/env";

export type MiniAppTab = "wallet" | "trade" | "standings";

function appBaseUrl(): string {
  return env.NEXT_PUBLIC_URL.replace(/\/$/, "");
}

function assertValidFid(fid: number, context: string): void {
  if (!Number.isFinite(fid) || fid <= 0 || !Number.isInteger(fid)) {
    throw new Error(`${context}: fid must be a positive integer`);
  }
}

/**
 * HTTPS URL that opens the Mini App portfolio screen for a given Farcaster FID.
 * Used by `@commodus status` replies so any client resolves the same ledger as
 * the cast author, not the viewer's session default.
 */
export function portfolioDeepLinkForFid(fid: number): string {
  assertValidFid(fid, "portfolioDeepLinkForFid");
  return `${appBaseUrl()}/portfolio?fid=${fid}`;
}

/**
 * HTTPS URL that opens a specific Mini App tab.
 */
export function miniAppTabDeepLink(tab: MiniAppTab): string {
  return `${appBaseUrl()}/?tab=${tab}`;
}

/**
 * HTTPS URL that opens the Mini App wallet tab for onboarding.
 */
export function walletDeepLink(): string {
  return miniAppTabDeepLink("wallet");
}

/**
 * Public HTTPS URL for the `@commodus status` Snap JSON (embed on the reply cast).
 */
export function statusSnapUrlForFid(fid: number): string {
  assertValidFid(fid, "statusSnapUrlForFid");
  return `${appBaseUrl()}/api/snaps/status/${fid}`;
}

/**
 * Public HTTPS URL for a completed trade Snap JSON.
 */
export function tradeSnapUrlForExecution(
  fid: number,
  tradeExecutionId: string,
): string {
  assertValidFid(fid, "tradeSnapUrlForExecution");
  const id = tradeExecutionId.trim();
  if (!id) {
    throw new Error("tradeSnapUrlForExecution: tradeExecutionId is required");
  }
  return `${appBaseUrl()}/api/snaps/trade/${fid}/${encodeURIComponent(id)}`;
}

/**
 * Public HTTPS URL for the no-wallet onboarding Snap JSON.
 */
export function onboardingSnapUrlForFid(fid: number, taunt = false): string {
  assertValidFid(fid, "onboardingSnapUrlForFid");
  const url = `${appBaseUrl()}/api/snaps/onboarding/${fid}`;
  return taunt ? `${url}?taunt=1` : url;
}
