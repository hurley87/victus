/**
 * Minimal env for unit tests that import modules using `lib/env`.
 * CI / local `.env.local` can override; we only set missing keys.
 */
const testEnv: Record<string, string> = {
  NEYNAR_API_KEY: "test-neynar-api-key",
  NEYNAR_WEBHOOK_SECRET: "test-webhook-secret",
  JWT_SECRET: "test-jwt-secret-min-32-chars-long!!",
  KV_REST_API_URL: "https://example.upstash.io",
  KV_REST_API_TOKEN: "test-kv-token",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  NEXT_PUBLIC_URL: "http://localhost:3000",
  NEXT_PUBLIC_FARCASTER_HEADER: "test",
  NEXT_PUBLIC_FARCASTER_PAYLOAD: "test",
  NEXT_PUBLIC_FARCASTER_SIGNATURE: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-pub",
};

for (const [k, v] of Object.entries(testEnv)) {
  if (process.env[k] == null || process.env[k] === "") {
    process.env[k] = v;
  }
}
