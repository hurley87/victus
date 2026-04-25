import { env } from "@/lib/env";

export type MiniAppTab = "wallet" | "trade" | "standings";

export function appBaseUrl(): string {
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

export type MiniAppTabParams = {
  token?: string;
  amount?: number;
  mode?: "buy" | "sell";
};

/**
 * HTTPS URL that opens a specific Mini App tab. Optional params are appended
 * as query string values so shared casts can deep-link into a pre-filled
 * trade composer or other tab-specific context.
 */
export function miniAppTabDeepLink(
  tab: MiniAppTab,
  params?: MiniAppTabParams,
): string {
  const search = new URLSearchParams({ tab });
  if (params?.token) {
    const token = params.token.trim().toLowerCase();
    if (token) search.set("token", token);
  }
  if (params?.amount != null && Number.isFinite(params.amount) && params.amount > 0) {
    search.set("amount", String(params.amount));
  }
  if (params?.mode) {
    search.set("mode", params.mode);
  }
  return `${appBaseUrl()}/?${search.toString()}`;
}

/**
 * Public HTTPS URL for the dynamic rank OG card for a given Farcaster FID.
 * Used as a Farcaster cast embed so shared standings render visually in feed.
 */
export function rankCardImageUrl(fid: number): string {
  assertValidFid(fid, "rankCardImageUrl");
  return `${appBaseUrl()}/api/og/rank/${fid}`;
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
