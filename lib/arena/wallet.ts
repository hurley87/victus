import "server-only";

import { DEFAULT_POLICY } from "@/lib/arena/policy";
import { createServerWallet, PrivyNotConfiguredError } from "@/lib/privy/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export class ArenaWalletProvisionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ArenaWalletProvisionUnavailableError extends ArenaWalletProvisionError {
  constructor(message = "Arena wallet provisioning temporarily unavailable") {
    super(message, 503);
  }
}

export type ProvisionedArenaWallet = {
  arena_address: string;
  wallet: {
    id: string;
    status: "active" | "closed";
    created_at: string;
    funded_at: string | null;
  };
  min_funding_deposit_usdc: number;
  replayed: boolean;
};

type ExistingWallet = {
  id: string;
  wallet_address: string;
  status: string;
  created_at: string;
  funded_at: string | null;
};

async function buildResult(
  wallet: ExistingWallet,
  replayed: boolean,
): Promise<ProvisionedArenaWallet> {
  const threshold = await ensureWalletPolicy(wallet.id);
  return {
    arena_address: wallet.wallet_address,
    wallet: {
      id: wallet.id,
      status: wallet.status as "active" | "closed",
      created_at: wallet.created_at,
      funded_at: wallet.funded_at,
    },
    min_funding_deposit_usdc: threshold,
    replayed,
  };
}

export async function provisionArenaWallet(params: {
  userId: string;
}): Promise<ProvisionedArenaWallet> {
  const existing = await loadExistingWallet(params.userId);
  if (existing) {
    return buildResult(existing, true);
  }

  let wallet: { id: string; address: string };
  try {
    const created = await createServerWallet();
    wallet = { id: created.id, address: created.address.toLowerCase() };
  } catch (err) {
    if (err instanceof PrivyNotConfiguredError) {
      throw new ArenaWalletProvisionUnavailableError(
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
    .select("id, wallet_address, status, created_at, funded_at")
    .single();

  if (walletErr || !walletRow) {
    if (isUniqueViolation(walletErr)) {
      const raced = await loadExistingWallet(params.userId);
      if (raced) {
        return buildResult(raced, true);
      }
    }

    throw new ArenaWalletProvisionUnavailableError(
      `Failed to insert arena_wallets: ${walletErr?.message ?? "no row"}`,
    );
  }

  return buildResult(walletRow, false);
}

async function loadExistingWallet(userId: string): Promise<ExistingWallet | null> {
  const { data, error } = await supabaseAdmin
    .from("arena_wallets")
    .select("id, wallet_address, status, created_at, funded_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ArenaWalletProvisionUnavailableError(
      `Failed to read arena_wallets: ${error.message}`,
    );
  }

  return data;
}

async function loadFundingThreshold(walletId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("wallet_policies")
    .select("min_funding_deposit_usdc")
    .eq("wallet_id", walletId)
    .maybeSingle();

  if (error) {
    throw new ArenaWalletProvisionUnavailableError(
      `Failed to read wallet_policies: ${error.message}`,
    );
  }

  if (!data) return null;
  return Number(data.min_funding_deposit_usdc);
}

async function ensureWalletPolicy(walletId: string): Promise<number> {
  const existingThreshold = await loadFundingThreshold(walletId);
  if (existingThreshold != null) return existingThreshold;

  const { error } = await supabaseAdmin
    .from("wallet_policies")
    .insert({ wallet_id: walletId });

  if (error && !isUniqueViolation(error)) {
    throw new ArenaWalletProvisionUnavailableError(
      `Failed to seed wallet_policies: ${error.message}`,
    );
  }

  return (
    (await loadFundingThreshold(walletId)) ??
    DEFAULT_POLICY.min_funding_deposit_usdc
  );
}

function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505";
}
