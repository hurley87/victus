import "server-only";

import { DEFAULT_POLICY } from "@/lib/arena/policy";
import { createServerWallet, PrivyNotConfiguredError } from "@/lib/privy/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Gladiator mint service — creates a Privy server wallet, an
 * `arena_wallets` row, and a `gladiators` row (status `pending_funding`)
 * for the signed-in user. Wrapped in custom errors so the HTTP route
 * can render specific status codes.
 */

export class InvalidGladiatorNameError extends Error {
  constructor(message = "Invalid gladiator name") {
    super(message);
    this.name = "InvalidGladiatorNameError";
  }
}

export class GladiatorNameTakenError extends Error {
  constructor() {
    super("That name belongs to another gladiator");
    this.name = "GladiatorNameTakenError";
  }
}

export class GladiatorMintUnavailableError extends Error {
  constructor(message = "Mint temporarily unavailable") {
    super(message);
    this.name = "GladiatorMintUnavailableError";
  }
}

const NAME_CHARSET_REGEX = /^[A-Za-z0-9][A-Za-z0-9 \-]{2,31}$/;

/**
 * Derive a gladiator name from a Farcaster account when the user didn't
 * supply one. Preference order:
 *   1. Farcaster username — globally unique by construction, [a-z0-9-],
 *      1–16 chars. Used as-is when it matches our 3–32 charset guard.
 *   2. Fallback `gladiator-{fid}` — also unique by construction.
 *
 * We intentionally skip `display_name`: it is unicode-permissive (emoji,
 * spaces, non-ASCII), not unique, and would need aggressive sanitization
 * that could produce collisions between users. Username + fid-fallback
 * is enough to guarantee a valid, unique name with zero user input.
 */
export async function deriveGladiatorName(fid: number): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("username")
    .eq("fid", fid)
    .maybeSingle();

  if (error) {
    throw new GladiatorMintUnavailableError(
      `Failed to read farcaster_accounts: ${error.message}`,
    );
  }

  const username = data?.username?.trim() ?? "";
  if (username.length >= 3 && NAME_CHARSET_REGEX.test(username)) {
    return username;
  }

  return `gladiator-${fid}`;
}

export type MintedGladiator = {
  arena_address: string;
  gladiator: {
    id: string;
    name: string;
    status: "pending_funding" | "alive";
    minted_at: string;
    funded_at: string | null;
  };
  min_mint_deposit_usdc: number;
  /**
   * `true` when the returned row already existed (idempotent replay).
   * Callers can use this to short-circuit telemetry that should only
   * fire once per actual mint.
   */
  replayed: boolean;
};

/**
 * Normalize a gladiator name: trim, collapse internal whitespace. Case
 * is preserved for display (the DB unique is case-sensitive on the
 * raw name — two gladiators named "Maximus" and "maximus" are distinct
 * per `gladiators_name_charset`, which matches the brief).
 */
function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/**
 * Mint a gladiator for `userId`.
 *
 * Idempotency posture:
 * - If the user already has a gladiator + arena wallet, return them with
 *   `replayed: true` WITHOUT calling Privy. This is the double-click /
 *   retry path; creating a second Privy wallet here would orphan the
 *   first one.
 * - Name-collision is guarded by the DB unique index on `gladiators.name`.
 *   We pre-check to return a clean 409 and — critically — we do NOT call
 *   Privy until AFTER the pre-check passes, so a losing name race never
 *   leaves a dangling server wallet. A race that survives the pre-check
 *   (two users, same name, tight window) surfaces as an insert error
 *   which we re-map to `GladiatorNameTakenError`; the Privy wallet +
 *   `arena_wallets` insert that DID succeed in that path become orphans
 *   of their own — logged for manual cleanup, but the user still sees a
 *   clean 409. Documented as a known rough edge: at MVP scale the race
 *   window is sub-second, and a cleanup cron is a trivial follow-up.
 */
export async function mintGladiator(params: {
  userId: string;
  fid: number;
  name?: string;
}): Promise<MintedGladiator> {
  // Idempotent replay runs BEFORE we resolve a name. A user who already
  // minted as "hurley" and then changes their Farcaster username shouldn't
  // trigger a second Privy wallet or a 409 against their own row.
  const existing = await loadExistingMint(params.userId);
  if (existing) {
    const threshold = await loadMintThreshold(existing.wallet_id);
    return {
      arena_address: existing.wallet_address,
      gladiator: existing.gladiator,
      min_mint_deposit_usdc: threshold,
      replayed: true,
    };
  }

  const name = params.name
    ? normalizeName(params.name)
    : await deriveGladiatorName(params.fid);

  if (!NAME_CHARSET_REGEX.test(name)) {
    throw new InvalidGladiatorNameError(
      "Name must be 3–32 chars, letters / numbers / spaces / hyphens, starting with a letter or digit",
    );
  }

  const { data: nameCollision, error: nameCheckErr } = await supabaseAdmin
    .from("gladiators")
    .select("user_id")
    .eq("name", name)
    .maybeSingle();

  if (nameCheckErr) {
    throw new GladiatorMintUnavailableError(
      `Failed name pre-check: ${nameCheckErr.message}`,
    );
  }
  if (nameCollision && nameCollision.user_id !== params.userId) {
    throw new GladiatorNameTakenError();
  }

  let wallet: { id: string; address: string };
  try {
    const created = await createServerWallet();
    wallet = { id: created.id, address: created.address.toLowerCase() };
  } catch (err) {
    if (err instanceof PrivyNotConfiguredError) {
      throw new GladiatorMintUnavailableError(
        "Arena wallet provisioning is not configured",
      );
    }
    throw err;
  }

  const { data: walletRow, error: walletErr } = await supabaseAdmin
    .from("arena_wallets")
    .insert({
      user_id: params.userId,
      wallet_address: wallet.address,
      privy_wallet_id: wallet.id,
    })
    .select("id, wallet_address")
    .single();

  if (walletErr || !walletRow) {
    throw new GladiatorMintUnavailableError(
      `Failed to insert arena_wallets: ${walletErr?.message ?? "no row"}`,
    );
  }

  const { error: policyErr } = await supabaseAdmin
    .from("wallet_policies")
    .insert({ wallet_id: walletRow.id });

  if (policyErr) {
    throw new GladiatorMintUnavailableError(
      `Failed to seed wallet_policies: ${policyErr.message}`,
    );
  }

  const { data: gladiatorRow, error: gladiatorErr } = await supabaseAdmin
    .from("gladiators")
    .insert({
      user_id: params.userId,
      name,
      status: "pending_funding",
    })
    .select("id, name, status, minted_at, funded_at")
    .single();

  if (gladiatorErr || !gladiatorRow) {
    if (/duplicate key value/i.test(gladiatorErr?.message ?? "")) {
      throw new GladiatorNameTakenError();
    }
    throw new GladiatorMintUnavailableError(
      `Failed to insert gladiators: ${gladiatorErr?.message ?? "no row"}`,
    );
  }

  const threshold = await loadMintThreshold(walletRow.id);

  return {
    arena_address: walletRow.wallet_address,
    gladiator: {
      id: gladiatorRow.id,
      name: gladiatorRow.name,
      status: gladiatorRow.status as "pending_funding" | "alive",
      minted_at: gladiatorRow.minted_at,
      funded_at: gladiatorRow.funded_at,
    },
    min_mint_deposit_usdc: threshold,
    replayed: false,
  };
}

type ExistingMint = {
  wallet_id: string;
  wallet_address: string;
  gladiator: MintedGladiator["gladiator"];
};

async function loadExistingMint(userId: string): Promise<ExistingMint | null> {
  const [{ data: wallet, error: walletErr }, { data: gladiator, error: glErr }] =
    await Promise.all([
      supabaseAdmin
        .from("arena_wallets")
        .select("id, wallet_address")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("gladiators")
        .select("id, name, status, minted_at, funded_at")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  if (walletErr) {
    throw new GladiatorMintUnavailableError(
      `Failed to read arena_wallets: ${walletErr.message}`,
    );
  }
  if (glErr) {
    throw new GladiatorMintUnavailableError(
      `Failed to read gladiators: ${glErr.message}`,
    );
  }

  if (!wallet || !gladiator) {
    return null;
  }

  return {
    wallet_id: wallet.id,
    wallet_address: wallet.wallet_address,
    gladiator: {
      id: gladiator.id,
      name: gladiator.name,
      status: gladiator.status as "pending_funding" | "alive",
      minted_at: gladiator.minted_at,
      funded_at: gladiator.funded_at,
    },
  };
}

async function loadMintThreshold(walletId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("wallet_policies")
    .select("min_mint_deposit_usdc")
    .eq("wallet_id", walletId)
    .maybeSingle();

  if (error) {
    throw new GladiatorMintUnavailableError(
      `Failed to read wallet_policies: ${error.message}`,
    );
  }

  return Number(data?.min_mint_deposit_usdc ?? DEFAULT_POLICY.min_mint_deposit_usdc);
}
