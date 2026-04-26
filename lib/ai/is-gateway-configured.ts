import "server-only";

import { env } from "@/lib/env";

/** Vercel AI Gateway can run: explicit key, or OIDC on Vercel without a manual key. */
export function isAiGatewayConfigured(): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}
