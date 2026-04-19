import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// https://env.t3.gg/docs/nextjs
export const env = createEnv({
  server: {
    NEYNAR_API_KEY: z.string().min(1),
    NEYNAR_WEBHOOK_SECRET: z.string().min(1),
    // UUID of the managed signer used to publish Commodus replies. Optional
    // at build time so the app can start without it; the reply publisher
    // throws a FatalError at runtime if unset.
    NEYNAR_SIGNER_UUID: z.string().uuid().optional(),
    JWT_SECRET: z.string().min(1),
    // Farcaster FID of the Commodus bot. Optional until the bot account is
    // created; required at runtime by the webhook handler and reply publisher.
    COMMODUS_FID: z.coerce.number().int().positive().optional(),
    // Upstash Redis REST API (auto-injected by Vercel-Upstash integration).
    // Used by @upstash/redis and @upstash/ratelimit over HTTPS.
    KV_REST_API_URL: z.string().url(),
    KV_REST_API_TOKEN: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    // Privy server-wallet API credentials. Optional at build so the app
    // can start without them; the mint endpoint throws a clean 500 at
    // runtime when either is missing. See README § Privy setup.
    PRIVY_APP_ID: z.string().min(1).optional(),
    PRIVY_APP_SECRET: z.string().min(1).optional(),
    // Base-mainnet EOA that receives fee-on-swap transfers. Required at
    // runtime by the execution pipeline (#8) but not by mint itself; kept
    // optional here so environments that haven't wired it yet still boot.
    OPERATOR_TREASURY_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    // Base mainnet RPC for reading on-chain state (USDC + position
    // balances). Defaults to the public endpoint; override for production.
    BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  },
  client: {
    NEXT_PUBLIC_URL: z.string().min(1),
    NEXT_PUBLIC_APP_ENV: z
      .enum(["development", "production"])
      .optional()
      .default("development"),
    NEXT_PUBLIC_FARCASTER_HEADER: z.string().min(1),
    NEXT_PUBLIC_FARCASTER_PAYLOAD: z.string().min(1),
    NEXT_PUBLIC_FARCASTER_SIGNATURE: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  },
  // For Next.js >= 13.4.4, you only need to destructure client variables:
  experimental__runtimeEnv: {
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_FARCASTER_HEADER: process.env.NEXT_PUBLIC_FARCASTER_HEADER,
    NEXT_PUBLIC_FARCASTER_PAYLOAD: process.env.NEXT_PUBLIC_FARCASTER_PAYLOAD,
    NEXT_PUBLIC_FARCASTER_SIGNATURE: process.env.NEXT_PUBLIC_FARCASTER_SIGNATURE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
});
