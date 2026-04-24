import "server-only";

import type { TradableAsset } from "@/lib/chain/balances";
import { readArenaBalance } from "@/lib/chain/balances";
import { deriveGladiatorName } from "@/lib/gladiators/service";
import { supabaseAdmin } from "@/lib/supabase/server";

import { DEFAULT_POLICY } from "./policy";
import type {
  ArenaBalance,
  ArenaProfile,
  ArenaRules,
  GladiatorStatus,
  WhitelistEntry,
} from "./types";
import { resolveWithdrawDestination } from "./withdraw-destination";

const EMPTY_BALANCE: ArenaBalance = {
  usdc: 0,
  positions: [],
};

async function loadWhitelist(): Promise<{
  cards: WhitelistEntry[];
  tradable: TradableAsset[];
}> {
  const { data, error } = await supabaseAdmin
    .from("asset_whitelist")
    .select("symbol, name, address, decimals, is_tradable")
    .eq("is_blocklisted", false)
    .eq("active", true)
    .order("symbol");

  if (error) {
    throw new Error(`Failed to load asset whitelist: ${error.message}`);
  }

  const rows = data ?? [];
  return {
    cards: rows.map(({ symbol, name, is_tradable }) => ({
      symbol,
      name,
      is_tradable,
    })),
    tradable: rows
      .filter((r) => r.is_tradable)
      .map((r) => ({
        symbol: r.symbol,
        name: r.name,
        address: r.address,
        decimals: r.decimals,
      })),
  };
}

/**
 * Count non-rejected trade intents the wallet issued since 00:00 UTC
 * today. Matches the policy-engine semantics used by `policy_validate`
 * in #8: rejected intents don't consume a daily slot.
 *
 * Returns 0 until the execution pipeline ships — there are no rows to
 * count yet. Implemented now so the Arena page's "slots remaining"
 * chip is correct the moment trading goes live.
 */
async function countTodaysIntents(walletId: string): Promise<number> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabaseAdmin
    .from("trade_intents")
    .select("id", { head: true, count: "exact" })
    .eq("wallet_id", walletId)
    .neq("status", "rejected")
    .gte("created_at", startOfDayUtc.toISOString());

  if (error) {
    console.error("Failed to count daily intents", error);
    return 0;
  }

  return count ?? 0;
}

/**
 * Load the Arena profile for a signed-in user.
 *
 * Returns enough for the onboarding UI to render every state: no
 * gladiator, pending funding, or alive. Balance is always live on-chain
 * from Base so the pending-funding progress meter reflects reality.
 *
 * Also self-heals `pending_funding → alive` inline: when on-chain USDC
 * clears `min_mint_deposit_usdc`, the status bit flips during this read
 * (see `maybeMarkAlive`). The Arena page's 5s poll is the implicit
 * watcher — there is no cron.
 */
export async function getArenaProfile(
  userId: string,
  fid: number,
): Promise<ArenaProfile> {
  const [wallet, gladiator, whitelist] = await Promise.all([
    supabaseAdmin
      .from("arena_wallets")
      .select("id, wallet_address, funding_wallet_address")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("gladiators")
      .select("id, name, status, minted_at, funded_at")
      .eq("user_id", userId)
      .maybeSingle(),
    loadWhitelist(),
  ]);

  if (wallet.error) {
    throw new Error(`Failed to read arena_wallets: ${wallet.error.message}`);
  }
  if (gladiator.error) {
    throw new Error(`Failed to read gladiators: ${gladiator.error.message}`);
  }

  const rules = await loadRules(wallet.data?.id ?? null, whitelist.cards);

  if (!wallet.data?.wallet_address) {
    const suggestedName = await deriveGladiatorName(fid).catch((err) => {
      console.error("Failed to derive suggested name", err);
      return `gladiator-${fid}`;
    });
    return {
      gladiator: null,
      arena_address: null,
      withdraw_destination: null,
      balance: EMPTY_BALANCE,
      rules,
      needs_funding: false,
      daily_slots_remaining: rules.max_trades_per_day,
      suggested_name: suggestedName,
    };
  }

  const currentStatus = gladiator.data?.status as GladiatorStatus | undefined;
  const isPendingFunding = currentStatus === "pending_funding";

  // While pending_funding the UI only shows the balance progress meter,
  // not the daily-slots chip — skip the Supabase count to drop one
  // round-trip per 5s poll tick.
  const [account, balance, intentCount] = await Promise.all([
    supabaseAdmin
      .from("farcaster_accounts")
      .select("verifications")
      .eq("user_id", userId)
      .maybeSingle(),
    readArenaBalance(wallet.data.wallet_address, whitelist.tradable).catch(
      (err) => {
        console.error("Failed to read arena balance", err);
        return EMPTY_BALANCE;
      },
    ),
    isPendingFunding ? Promise.resolve(0) : countTodaysIntents(wallet.data.id),
  ]);

  if (account.error) {
    throw new Error(`Failed to read farcaster_accounts: ${account.error.message}`);
  }

  const withdrawDestination = resolveWithdrawDestination({
    fundingWalletAddress: wallet.data.funding_wallet_address,
    verifications: account.data?.verifications,
    arenaAddress: wallet.data.wallet_address,
  });

  // Self-heal: if the Arena page is polling a gladiator whose client-side
  // refetch landed before the server's RPC saw the deposit, flip the
  // status inline on a later tick. The 5s poll is the implicit watcher.
  const effective = await maybeMarkAlive({
    userId,
    gladiatorId: gladiator.data?.id ?? null,
    mintedAt: gladiator.data?.minted_at ?? null,
    currentStatus,
    currentFundedAt: gladiator.data?.funded_at ?? null,
    balanceUsdc: balance.usdc,
    thresholdUsdc: rules.min_mint_deposit_usdc,
  });

  return {
    gladiator: gladiator.data
      ? {
          name: gladiator.data.name,
          status: effective.status ?? (gladiator.data.status as GladiatorStatus),
          minted_at: gladiator.data.minted_at,
          funded_at: effective.fundedAt,
        }
      : null,
    arena_address: wallet.data.wallet_address,
    withdraw_destination: withdrawDestination,
    balance,
    rules,
    needs_funding: effective.status === "pending_funding",
    daily_slots_remaining: Math.max(
      0,
      rules.max_trades_per_day - intentCount,
    ),
    suggested_name: null,
  };
}

async function maybeMarkAlive(params: {
  userId: string;
  gladiatorId: string | null;
  mintedAt: string | null;
  currentStatus: GladiatorStatus | undefined;
  currentFundedAt: string | null;
  balanceUsdc: number;
  thresholdUsdc: number;
}): Promise<{ status: GladiatorStatus | undefined; fundedAt: string | null }> {
  const {
    userId,
    gladiatorId,
    mintedAt,
    currentStatus,
    currentFundedAt,
    balanceUsdc,
    thresholdUsdc,
  } = params;

  if (
    currentStatus !== "pending_funding" ||
    balanceUsdc + 1e-9 < thresholdUsdc
  ) {
    return { status: currentStatus, fundedAt: currentFundedAt };
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("gladiators")
    .update({ status: "alive", funded_at: now })
    .eq("user_id", userId)
    .eq("status", "pending_funding");

  if (error) {
    console.error("arena.profile.autoheal_failed", {
      user_id: userId,
      reason: error.message,
    });
    return { status: currentStatus, fundedAt: currentFundedAt };
  }

  // Telemetry: spec'd by #19. `time_to_fund_seconds` may be null on the
  // unlikely path where `minted_at` was missing from the read.
  const timeToFundSeconds = mintedAt
    ? Math.max(0, (Date.parse(now) - Date.parse(mintedAt)) / 1000)
    : null;
  console.info("gladiator.funded", {
    user_id: userId,
    gladiator_id: gladiatorId,
    deposit_usdc: balanceUsdc,
    time_to_fund_seconds: timeToFundSeconds,
  });

  return { status: "alive", fundedAt: now };
}

async function loadRules(
  walletId: string | null,
  whitelist: WhitelistEntry[],
): Promise<ArenaRules> {
  if (!walletId) {
    return {
      whitelist,
      ...DEFAULT_POLICY,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("wallet_policies")
    .select(
      "max_trade_usdc, max_trades_per_day, wallet_cap_usdc, min_mint_deposit_usdc, swap_fee_bps, swap_fee_min_usdc",
    )
    .eq("wallet_id", walletId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read wallet_policies: ${error.message}`);
  }

  if (!data) {
    return { whitelist, ...DEFAULT_POLICY };
  }

  return {
    whitelist,
    max_trade_usdc: Number(data.max_trade_usdc),
    max_trades_per_day: data.max_trades_per_day,
    wallet_cap_usdc: Number(data.wallet_cap_usdc),
    min_mint_deposit_usdc: Number(data.min_mint_deposit_usdc),
    swap_fee_bps: data.swap_fee_bps,
    swap_fee_min_usdc: Number(data.swap_fee_min_usdc),
  };
}

/**
 * Canonical rules + whitelist for display surfaces that do not have an
 * arena wallet yet (`wallet_policies` defaults) — same `loadRules` path as
 * pre-mint `GET /api/arena/me`.
 */
export async function getPublicArenaRules(): Promise<ArenaRules> {
  const { cards } = await loadWhitelist();
  return loadRules(null, cards);
}
