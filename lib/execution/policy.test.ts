import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { supabaseAdmin } from "@/lib/supabase/server";
import { getActiveSeason, getSeasonEntry } from "@/lib/seasons/service";

import { validatePolicy } from "./policy";

vi.mock("@/lib/chain/erc20", () => ({
  readErc20Balance: vi.fn(),
  readUsdcBalance: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/seasons/service", () => ({
  getActiveSeason: vi.fn(),
  getSeasonEntry: vi.fn(),
}));

vi.mock("@/lib/zerox/quote", () => ({
  getAllowanceHolderQuote: vi.fn(),
}));

function singleRowQuery(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

const activeSeason = {
  id: "season-1",
  name: "Week 18",
  status: "active",
  starts_at: "2026-04-20T00:00:00Z",
  ends_at: "2026-04-27T00:00:00Z",
  starting_balance_usdc: 10,
  max_trades: 5,
  min_trade_size_usdc: 2,
  settled_at: null,
  created_at: "2026-04-20T00:00:00Z",
};

const activeEntry = {
  id: "entry-1",
  season_id: "season-1",
  user_id: "user-1",
  wallet_id: "wallet-1",
  starting_balance_usdc: 10,
  cash_remaining_usdc: 10,
  trades_used: 0,
  max_trades: 5,
  has_qualifying_trade: false,
  status: "active",
  settled_portfolio_value_usdc: null,
  settled_return_pct: null,
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

const policyRow = {
  max_trade_usdc: 10,
  max_trades_per_day: 10,
  wallet_cap_usdc: 100,
  max_slippage_bps: 100,
  max_price_impact_bps: 500,
  swap_fee_bps: 50,
  swap_fee_min_usdc: 0.05,
};

const seasonToken = {
  token_symbol: "AERO",
  token_address: "0x00000000000000000000000000000000000000a1",
  decimals: 18,
  is_active: true,
};

function mockSeasonBuyTables(tokenResult: unknown = { data: seasonToken, error: null }) {
  (supabaseAdmin.from as unknown as Mock).mockImplementation((table: string) => {
    if (table === "arena_wallets") {
      return singleRowQuery({ data: { funded_at: "2026-04-20T00:00:00Z" }, error: null });
    }
    if (table === "wallet_policies") {
      return singleRowQuery({ data: policyRow, error: null });
    }
    if (table === "season_tokens") {
      return singleRowQuery(tokenResult);
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function buyIntent(amountValue: number, symbol = "AERO") {
  return {
    userId: "user-1",
    walletId: "wallet-1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    privyWalletId: "privy-wallet-1",
    intent: {
      action: "buy" as const,
      symbol,
      amount_type: "usdc_in" as const,
      amount_value: amountValue,
    },
  };
}

describe("validatePolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getActiveSeason as unknown as Mock).mockResolvedValue(null);
    (getSeasonEntry as unknown as Mock).mockResolvedValue(null);
  });

  it("rejects trades until the arena wallet is funded", async () => {
    const walletQuery = singleRowQuery({
      data: { funded_at: null },
      error: null,
    });
    (supabaseAdmin.from as unknown as Mock).mockReturnValue(walletQuery);

    const result = await validatePolicy({
      userId: "user-1",
      walletId: "wallet-1",
      walletAddress: "0x0000000000000000000000000000000000000001",
      privyWalletId: "privy-wallet-1",
      intent: {
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 5,
      },
    });

    expect(result).toEqual({ ok: false, reason: "needs_wallet_funding" });
    expect(supabaseAdmin.from).toHaveBeenCalledWith("arena_wallets");
    expect(walletQuery.select).toHaveBeenCalledWith("funded_at");
    expect(walletQuery.eq).toHaveBeenCalledWith("id", "wallet-1");
  });

  it("rejects season buys when no active season exists", async () => {
    mockSeasonBuyTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(null);

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({ ok: false, reason: "no_active_season" });
  });

  it("rejects season buys when the user has not entered", async () => {
    mockSeasonBuyTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getSeasonEntry as unknown as Mock).mockResolvedValue(null);

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({ ok: false, reason: "no_season_entry" });
  });

  it("rejects inactive season entries", async () => {
    mockSeasonBuyTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getSeasonEntry as unknown as Mock).mockResolvedValue({
      ...activeEntry,
      status: "settled",
    });

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({ ok: false, reason: "season_entry_inactive" });
  });

  it("rejects the sixth season buy", async () => {
    mockSeasonBuyTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getSeasonEntry as unknown as Mock).mockResolvedValue({
      ...activeEntry,
      trades_used: 5,
      max_trades: 5,
    });

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({ ok: false, reason: "season_max_trades_reached" });
  });

  it("rejects tokens outside the season token list", async () => {
    mockSeasonBuyTables({ data: null, error: null });
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getSeasonEntry as unknown as Mock).mockResolvedValue(activeEntry);

    const result = await validatePolicy(buyIntent(5, "DEGEN"));

    expect(result).toMatchObject({ ok: false, reason: "season_token_not_approved" });
  });

  it("rejects season buys below the minimum trade size", async () => {
    mockSeasonBuyTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getSeasonEntry as unknown as Mock).mockResolvedValue(activeEntry);

    const result = await validatePolicy(buyIntent(1.99));

    expect(result).toMatchObject({ ok: false, reason: "season_min_trade_size" });
  });

  it("rejects season buys above virtual cash even when wallet policy allows it", async () => {
    mockSeasonBuyTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getSeasonEntry as unknown as Mock).mockResolvedValue({
      ...activeEntry,
      cash_remaining_usdc: 6,
    });

    const result = await validatePolicy(buyIntent(7));

    expect(result).toMatchObject({
      ok: false,
      reason: "season_insufficient_arena_balance",
    });
  });

  it("accepts valid season buys with season context", async () => {
    mockSeasonBuyTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getSeasonEntry as unknown as Mock).mockResolvedValue(activeEntry);

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({
      ok: true,
      context: {
        season: {
          seasonId: "season-1",
          seasonEntryId: "entry-1",
          tokenSymbol: "AERO",
          tokenAddress: "0x00000000000000000000000000000000000000A1",
          tokenDecimals: 18,
        },
      },
    });
  });
});
