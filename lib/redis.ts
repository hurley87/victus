import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

/**
 * Upstash Redis client (REST over HTTPS).
 *
 * Auto-wired from the Vercel-Upstash integration env vars. Used for:
 * - Webhook idempotency (deduping Neynar cast webhooks)
 * - Rate limiting (per-FID command throttling)
 * - Short-lived session / cache state
 */
export const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * Pre-configured rate limiters. Use these instead of constructing ad-hoc
 * limiters at call sites to keep quotas visible and consistent.
 *
 * Each limiter uses a sliding window + ephemeral in-memory cache to avoid
 * a Redis round-trip on obviously-denied requests.
 */
export const ratelimit = {
  /** Per-FID command throttle: 10 commands per 10s. */
  command: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "10 s"),
    analytics: true,
    prefix: "rl:cmd",
  }),
  /** Webhook ingress throttle: 60 events per 1m per source. */
  webhook: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    analytics: true,
    prefix: "rl:webhook",
  }),
  /** Auth / sign-in throttle: 5 attempts per 1m per identifier. */
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1 m"),
    analytics: true,
    prefix: "rl:auth",
  }),
} as const;

/**
 * Webhook idempotency check. Returns `true` if this event id has already
 * been processed within `ttlSeconds`. Uses Redis SET NX for an atomic
 * check-and-set so concurrent deliveries can't both claim the slot.
 *
 * @example
 * if (await wasProcessed(`neynar:${event.id}`)) return new Response(null, { status: 200 });
 */
export async function wasProcessed(
  key: string,
  ttlSeconds = 60 * 60 * 24,
): Promise<boolean> {
  const result = await redis.set(`idem:${key}`, "1", {
    nx: true,
    ex: ttlSeconds,
  });
  return result !== "OK";
}
