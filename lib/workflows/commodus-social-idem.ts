import crypto from "node:crypto";

export type SocialEngagementRunType = "webhook" | "manual";

/** Stable idempotency key for `commodus_social_runs`; keep out of `"use workflow"` bundles. */
export function deriveIdemKey(triggerHash: string, runType: SocialEngagementRunType): string {
  return crypto
    .createHash("sha256")
    .update(`${triggerHash}:${runType}`)
    .digest("hex");
}
