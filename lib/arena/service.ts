import "server-only";

import type { TradableAsset } from "@/lib/chain/balances";
import { readArenaBalance } from "@/lib/chain/balances";
import { supabaseAdmin } from "@/lib/supabase/server";

import { DEFAULT_POLICY } from "./policy";
import type {
  ArenaBalance,
  ArenaProfile,
  ArenaRules,
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
 * Returns enough for the onboarding UI to render every state: no arena
 * wallet, pending funding, or funded. Balance is always live on-chain from
 * Base so the pending-funding progress meter reflects reality.
 *
 * Also self-heals the funding gate inline: when on-chain USDC clears
 * `min_funding_deposit_usdc`, `arena_wallets.funded_at` is set during this
 * read (see `maybeMarkFunded`). The Arena page's 5s poll is the implicit
 * watcher — there is no cron.
 */
export async function getArenaProfile(
  userId: string,
  _fid: number,
): Promise<ArenaProfile> {
  const [wallet, whitelist] = await Promise.all([
    supabaseAdmin
      .from("arena_wallets")
      .select(
        "id, wallet_address, funding_wallet_address, status, created_at, funded_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    loadWhitelist(),
  ]);

  if (wallet.error) {
    throw new Error(`Failed to read arena_wallets: ${wallet.error.message}`);
  }

  const rules = await loadRules(wallet.data?.id ?? null, whitelist.cards);

  if (!wallet.data?.wallet_address) {
    return {
      wallet: null,
      arena_address: null,
      withdraw_destination: null,
      balance: EMPTY_BALANCE,
      rules,
      needs_funding: false,
      daily_slots_remaining: rules.max_trades_per_day,
    };
  }

  const isPendingFunding = wallet.data.funded_at == null;

  // While pending funding the UI only shows the balance progress meter,
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

  // Self-heal: if the Arena page is polling a wallet whose client-side
  // refetch landed before the server's RPC saw the deposit, set funded_at
  // inline on a later tick. The 5s poll is the implicit watcher.
  const effective = await maybeMarkFunded({
    userId,
    walletId: wallet.data.id,
    createdAt: wallet.data.created_at,
    currentFundedAt: wallet.data.funded_at,
    balanceUsdc: balance.usdc,
    thresholdUsdc: rules.min_funding_deposit_usdc,
  });

  return {
    wallet: {
      status: wallet.data.status as "active" | "closed",
      created_at: wallet.data.created_at,
      funded_at: effective.fundedAt,
    },
    arena_address: wallet.data.wallet_address,
    withdraw_destination: withdrawDestination,
    balance,
    rules,
    needs_funding: effective.fundedAt == null,
    daily_slots_remaining: Math.max(
      0,
      rules.max_trades_per_day - intentCount,
    ),
  };
}

async function maybeMarkFunded(params: {
  userId: string;
  walletId: string;
  createdAt: string | null;
  currentFundedAt: string | null;
  balanceUsdc: number;
  thresholdUsdc: number;
}): Promise<{ fundedAt: string | null }> {
  const {
    userId,
    walletId,
    createdAt,
    currentFundedAt,
    balanceUsdc,
    thresholdUsdc,
  } = params;

  if (currentFundedAt || balanceUsdc + 1e-9 < thresholdUsdc) {
    return { fundedAt: currentFundedAt };
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("arena_wallets")
    .update({ funded_at: now })
    .eq("id", walletId)
    .is("funded_at", null);

  if (error) {
    console.error("arena.profile.autoheal_failed", {
      user_id: userId,
      wallet_id: walletId,
      reason: error.message,
    });
    return { fundedAt: currentFundedAt };
  }

  const timeToFundSeconds = createdAt
    ? Math.max(0, (Date.parse(now) - Date.parse(createdAt)) / 1000)
    : null;
  console.info("arena_wallet.funded", {
    user_id: userId,
    wallet_id: walletId,
    deposit_usdc: balanceUsdc,
    time_to_fund_seconds: timeToFundSeconds,
  });

  return { fundedAt: now };
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
      "max_trade_usdc, max_trades_per_day, wallet_cap_usdc, min_funding_deposit_usdc, swap_fee_bps, swap_fee_min_usdc",
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
    min_funding_deposit_usdc: Number(data.min_funding_deposit_usdc),
    swap_fee_bps: data.swap_fee_bps,
    swap_fee_min_usdc: Number(data.swap_fee_min_usdc),
  };
}

/**
 * Canonical rules + whitelist for display surfaces that do not have an
 * arena wallet yet (`wallet_policies` defaults) — same `loadRules` path as
 * pre-wallet `GET /api/arena/me`.
 */
export async function getPublicArenaRules(): Promise<ArenaRules> {
  const { cards } = await loadWhitelist();
  return loadRules(null, cards);
}
