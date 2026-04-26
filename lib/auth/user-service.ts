import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { NeynarUser } from "@/lib/neynar";
import { recordReferralSignup } from "@/lib/referrals/service";

/**
 * Idempotently resolve the Supabase `user_id` for a Farcaster account.
 *
 * - On first sign-in for a `fid`: creates a `users` row and a
 *   `farcaster_accounts` row referencing it, then returns the new `user_id`.
 * - On repeat sign-in: updates the mutable profile fields
 *   (`username`, `display_name`, `pfp_url`, `verifications`) and returns
 *   the existing `user_id`.
 *
 * Concurrency: if two first-sign-in requests race for the same `fid`,
 * exactly one will succeed on the unique `(fid)` constraint. The loser
 * re-selects the winner's `user_id` and compensates by deleting the
 * orphan `users` row it had already inserted. This keeps the end state
 * consistent with a single logical upsert.
 */
export async function resolveOrCreateFarcasterUser(
  fid: number,
  profile: NeynarUser,
  referrerFid?: number | null,
): Promise<string> {
  const profileUpdate = {
    username: profile.username ?? null,
    display_name: profile.display_name ?? null,
    pfp_url: profile.pfp_url ?? null,
    verifications: profile.verifications ?? [],
  } as const;

  const { data: existing, error: selectErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id")
    .eq("fid", fid)
    .maybeSingle();

  if (selectErr) {
    throw new Error(
      `Failed to look up farcaster_accounts by fid: ${selectErr.message}`,
    );
  }

  if (existing?.user_id) {
    const { error: updateErr } = await supabaseAdmin
      .from("farcaster_accounts")
      .update(profileUpdate)
      .eq("fid", fid);

    if (updateErr) {
      throw new Error(
        `Failed to refresh farcaster_accounts profile: ${updateErr.message}`,
      );
    }

    return existing.user_id;
  }

  const { data: newUser, error: userErr } = await supabaseAdmin
    .from("users")
    .insert({})
    .select("id")
    .single();

  if (userErr || !newUser) {
    throw new Error(
      `Failed to create users row: ${userErr?.message ?? "no row returned"}`,
    );
  }

  const { error: insertErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .insert({
      user_id: newUser.id,
      fid,
      ...profileUpdate,
    });

  if (!insertErr) {
    try {
      await recordReferralSignup({
        referrerFid,
        referredFid: fid,
        referredUserId: newUser.id,
      });
    } catch (err) {
      console.error("Failed to record referral signup", err);
    }
    return newUser.id;
  }

  // Insert failed. The most likely cause is a concurrent first sign-in
  // that already inserted a row with this fid (unique violation). Recover
  // by re-selecting and deleting the orphan users row we just created.
  const { data: raced } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id")
    .eq("fid", fid)
    .maybeSingle();

  await supabaseAdmin.from("users").delete().eq("id", newUser.id);

  if (raced?.user_id) {
    return raced.user_id;
  }

  throw new Error(
    `Failed to create farcaster_accounts row: ${insertErr.message}`,
  );
}
