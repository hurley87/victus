import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

import type { Database } from "./types";

/**
 * Browser-safe Supabase client, authenticated with the publishable key.
 *
 * In MVP we don't grant the client direct table access — RLS denies all
 * anon/authenticated reads and writes (see `docs/supabase.md`). This client
 * exists for the future path where we:
 *   - add read policies for leaderboard/portfolio pages, or
 *   - subscribe to Realtime channels (e.g. live leaderboard).
 *
 * Lazy-instantiated so we don't run `createClient` during RSC render.
 */
let browserClient: SupabaseClient<Database> | undefined;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    browserClient = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return browserClient;
}
