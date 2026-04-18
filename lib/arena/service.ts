import "server-only";

import { fetchUser } from "@/lib/neynar";
import { supabaseAdmin } from "@/lib/supabase/server";

import type { ArenaProfile, ArenaRules, WhitelistEntry } from "./types";

export class InvalidAddressError extends Error {
  constructor(message = "Invalid Ethereum address") {
    super(message);
    this.name = "InvalidAddressError";
  }
}

export class AddressNotVerifiedError extends Error {
  constructor(message = "Address is not a Farcaster-verified address") {
    super(message);
    this.name = "AddressNotVerifiedError";
  }
}

export class AddressAlreadyClaimedError extends Error {
  constructor(message = "Address already designated by another user") {
    super(message);
    this.name = "AddressAlreadyClaimedError";
  }
}

const ADDRESS_REGEX = /^0x[a-f0-9]{40}$/;

/**
 * Policy defaults mirrored from the Postgres defaults on `wallet_policies`.
 *
 * These render on the Arena rules card before the user has a wallet row,
 * so the page is useful during onboarding. Once designation creates a
 * `wallet_policies` row, its actual values are preferred.
 *
 * Keep these in sync with `supabase/migrations/**` definitions.
 */
const DEFAULT_POLICY = {
  max_trade_usdc: 10,
  max_trades_per_day: 10,
} as const;

/**
 * Normalize and validate a hex Ethereum address.
 *
 * Accepts mixed case and leading/trailing whitespace. Returns the
 * lowercase canonical form used throughout the system
 * (`arena_wallets.wallet_address` and `verifications[]` are stored
 * lowercase). Throws `InvalidAddressError` for anything that isn't a
 * 40-char lowercase hex with `0x` prefix after normalization.
 */
function normalizeAddress(input: string): string {
  const trimmed = input?.trim().toLowerCase() ?? "";
  if (!ADDRESS_REGEX.test(trimmed)) {
    throw new InvalidAddressError();
  }
  return trimmed;
}

async function loadWhitelist(): Promise<WhitelistEntry[]> {
  const { data, error } = await supabaseAdmin
    .from("asset_whitelist")
    .select("symbol, name")
    .eq("is_tradable", true)
    .eq("is_blocklisted", false)
    .eq("active", true)
    .order("symbol");

  if (error) {
    throw new Error(`Failed to load asset whitelist: ${error.message}`);
  }

  return data ?? [];
}

async function loadCachedVerifications(fid: number): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("verifications")
    .eq("fid", fid)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read verifications: ${error.message}`);
  }

  const raw = data?.verifications;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());
}

/**
 * Load the Arena profile for a signed-in user.
 *
 * Returns enough for the onboarding UI to render every state:
 * not-designated (with 0/1/2+ verifications) or designated. The
 * verifications come from the cached `farcaster_accounts` row written
 * on sign-in — fresh enough for rendering, and `designateArenaAddress`
 * re-checks against Neynar before any write.
 */
export async function getArenaProfile(
  userId: string,
  fid: number,
): Promise<ArenaProfile> {
  const [wallet, verifications, whitelist] = await Promise.all([
    supabaseAdmin
      .from("arena_wallets")
      .select("id, wallet_address")
      .eq("user_id", userId)
      .maybeSingle(),
    loadCachedVerifications(fid),
    loadWhitelist(),
  ]);

  if (wallet.error) {
    throw new Error(`Failed to read arena_wallets: ${wallet.error.message}`);
  }

  let rules: ArenaRules = {
    whitelist,
    max_trade_usdc: DEFAULT_POLICY.max_trade_usdc,
    max_trades_per_day: DEFAULT_POLICY.max_trades_per_day,
  };

  if (wallet.data?.id) {
    const { data: policy, error: policyErr } = await supabaseAdmin
      .from("wallet_policies")
      .select("max_trade_usdc, max_trades_per_day")
      .eq("wallet_id", wallet.data.id)
      .maybeSingle();

    if (policyErr) {
      throw new Error(
        `Failed to read wallet_policies: ${policyErr.message}`,
      );
    }

    if (policy) {
      rules = {
        whitelist,
        max_trade_usdc: Number(policy.max_trade_usdc),
        max_trades_per_day: policy.max_trades_per_day,
      };
    }
  }

  return {
    arena_address: wallet.data?.wallet_address ?? null,
    verifications,
    is_designated: Boolean(wallet.data?.wallet_address),
    rules,
  };
}

/**
 * Designate the Arena address for `userId`.
 *
 * Fetches fresh verifications from Neynar (not the cached copy on
 * `farcaster_accounts`) so a revoked verification can't be designated
 * during the window before the cache catches up. The DB-level UNIQUE
 * on `arena_wallets.wallet_address` is the backstop for the claim
 * check — the pre-read just lets us return a clean 409 instead of
 * leaking a constraint error.
 *
 * Idempotent: re-designating the same address succeeds silently.
 * Swapping to a different address updates the existing row (the
 * wallet `id` — and any `wallet_policies` tied to it — is preserved).
 */
export async function designateArenaAddress(params: {
  userId: string;
  fid: number;
  address: string;
}): Promise<string> {
  const { userId, fid } = params;
  const normalized = normalizeAddress(params.address);

  const profile = await fetchUser(fid.toString());
  const fresh = (profile.verifications ?? []).map((v) => v.toLowerCase());

  if (!fresh.includes(normalized)) {
    throw new AddressNotVerifiedError();
  }

  // Only on the happy path do we pay for the cache refresh + claim
  // check; they're independent so we run them concurrently.
  const [cacheRes, claimRes] = await Promise.all([
    supabaseAdmin
      .from("farcaster_accounts")
      .update({ verifications: fresh })
      .eq("fid", fid),
    supabaseAdmin
      .from("arena_wallets")
      .select("user_id")
      .eq("wallet_address", normalized)
      .maybeSingle(),
  ]);

  if (cacheRes.error) {
    // Non-fatal: the next successful designation / sign-in refreshes
    // this cache, and the UI re-fetches /api/arena/me on write.
    console.error("Failed to refresh cached verifications", cacheRes.error);
  }

  if (claimRes.error) {
    throw new Error(
      `Failed to check arena_wallets ownership: ${claimRes.error.message}`,
    );
  }

  if (claimRes.data && claimRes.data.user_id !== userId) {
    throw new AddressAlreadyClaimedError();
  }

  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from("arena_wallets")
    .upsert(
      {
        user_id: userId,
        wallet_address: normalized,
        source: "user_verified",
        status: "active",
      },
      { onConflict: "user_id" },
    )
    .select("id, wallet_address")
    .single();

  if (upsertErr || !upserted) {
    throw new Error(
      `Failed to upsert arena_wallets: ${upsertErr?.message ?? "no row"}`,
    );
  }

  const { error: policyErr } = await supabaseAdmin
    .from("wallet_policies")
    .upsert(
      { wallet_id: upserted.id },
      { onConflict: "wallet_id", ignoreDuplicates: true },
    );

  if (policyErr) {
    throw new Error(`Failed to ensure wallet_policies: ${policyErr.message}`);
  }

  return upserted.wallet_address;
}
