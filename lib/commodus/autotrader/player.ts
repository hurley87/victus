import "server-only";

import { env } from "@/lib/env";
import { createServerWallet, PrivyNotConfiguredError } from "@/lib/privy/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchUser } from "@/lib/neynar";

import type { CommodusPlayer } from "./types";

const COMMODUS_DISPLAY_NAME = "Commodus";
const ARENA_STATUS_ACTIVE = "active";

/**
 * Commodus FID and arena wallet, keyed from env. Used only for the autotrader
 * and leaderboard highlight — never for user wallets.
 */
export async function loadCommodusPlayer(): Promise<CommodusPlayer | null> {
  const fid = env.COMMODUS_FID;
  if (fid == null) return null;

  const { data: account, error: acctErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id")
    .eq("fid", fid)
    .maybeSingle();

  if (acctErr) {
    throw new Error(`commodus: farcaster_accounts ${acctErr.message}`);
  }
  if (!account) return null;

  const { data: wallet, error: wErr } = await supabaseAdmin
    .from("arena_wallets")
    .select("id, wallet_address, privy_wallet_id")
    .eq("user_id", account.user_id)
    .maybeSingle();

  if (wErr) {
    throw new Error(`commodus: arena_wallets ${wErr.message}`);
  }
  if (!wallet) return null;

  return {
    userId: account.user_id,
    fid: Number(fid),
    walletId: wallet.id,
    walletAddress: wallet.wallet_address,
    privyWalletId: wallet.privy_wallet_id,
  };
}

export type ProvisionCommodusPlayerResult = {
  created: boolean;
  player: CommodusPlayer;
};

/**
 * One-time (idempotent) provisioning: `users` + `farcaster_accounts` (COMMODUS_FID)
 * + `arena_wallets` (Privy) + `wallet_policies` + `funded_at` for policy gate.
 */
export async function provisionCommodusPlayer(): Promise<ProvisionCommodusPlayerResult> {
  const fid = env.COMMODUS_FID;
  if (fid == null) {
    throw new Error("COMMODUS_FID is not configured");
  }

  const existing = await loadCommodusPlayer();
  if (existing) {
    return { created: false, player: existing };
  }

  let neynarUser: Awaited<ReturnType<typeof fetchUser>> | null = null;
  try {
    neynarUser = await fetchUser(String(fid));
  } catch {
    neynarUser = null;
  }

  const { data: userRow, error: userErr } = await supabaseAdmin
    .from("users")
    .insert({})
    .select("id")
    .single();

  if (userErr || !userRow) {
    throw new Error(`commodus: users insert ${userErr?.message ?? "no row"}`);
  }

  const userId = userRow.id;
  const nowIso = new Date().toISOString();

  const { error: faErr } = await supabaseAdmin.from("farcaster_accounts").insert({
    user_id: userId,
    fid: Number(fid),
    username: neynarUser?.username ?? "commodus",
    display_name: neynarUser?.display_name ?? COMMODUS_DISPLAY_NAME,
    pfp_url: neynarUser?.pfp_url ?? null,
  });

  if (faErr) {
    throw new Error(`commodus: farcaster_accounts insert ${faErr.message}`);
  }

  let wallet: { id: string; address: string; privyId: string };
  try {
    const created = await createServerWallet();
    wallet = {
      id: created.id,
      address: created.address.toLowerCase(),
      privyId: created.id,
    };
  } catch (err) {
    if (err instanceof PrivyNotConfiguredError) {
      throw new Error("Privy is not configured; cannot provision Commodus wallet");
    }
    throw err;
  }

  const { data: wRow, error: wIns } = await supabaseAdmin
    .from("arena_wallets")
    .insert({
      user_id: userId,
      wallet_address: wallet.address,
      privy_wallet_id: wallet.privyId,
      status: ARENA_STATUS_ACTIVE,
      funded_at: nowIso,
    })
    .select("id, wallet_address, privy_wallet_id")
    .single();

  if (wIns || !wRow) {
    throw new Error(`commodus: arena_wallets insert ${wIns?.message ?? "no row"}`);
  }

  const { error: polErr } = await supabaseAdmin.from("wallet_policies").insert({
    wallet_id: wRow.id,
  });
  if (polErr) {
    throw new Error(`commodus: wallet_policies insert ${polErr.message}`);
  }

  return {
    created: true,
    player: {
      userId,
      fid: Number(fid),
      walletId: wRow.id,
      walletAddress: wRow.wallet_address,
      privyWalletId: wRow.privy_wallet_id,
    },
  };
}
