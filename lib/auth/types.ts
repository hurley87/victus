import type { NeynarUser } from "@/lib/neynar";

/**
 * The identity returned by `POST /api/auth/sign-in` and `GET /api/users/me`.
 *
 * Extends the Neynar profile with the resolved Supabase `user_id` so the
 * client has a stable, app-internal identity it can send to downstream
 * endpoints (arena wallets, scoring, etc.) without having to re-resolve
 * by `fid` on every request.
 */
export type AuthenticatedUser = NeynarUser & {
  user_id: string;
};
