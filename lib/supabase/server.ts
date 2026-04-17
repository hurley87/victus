import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

import type { Database } from "./types";

/**
 * Server-side Supabase client, authenticated with the service role key.
 *
 * - **Bypasses RLS.** Use this anywhere we are the source of truth:
 *   webhook handlers, workflow steps, API routes, server actions, crons.
 * - **Never import this from a client component.** The `server-only` import
 *   above turns any accidental client import into a build-time error.
 * - The client is stateless; we reuse a single instance per server runtime
 *   to avoid paying the construction cost on every request.
 *
 * See `docs/supabase.md` for the full read/write posture.
 */
export const supabaseAdmin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "X-Client-Info": "commodus-server",
      },
    },
  },
);

export type { Database } from "./types";
