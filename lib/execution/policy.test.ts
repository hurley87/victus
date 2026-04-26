import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { supabaseAdmin } from "@/lib/supabase/server";
import { getActiveSeason, getOrCreateSeasonEntry } from "@/lib/seasons/service";
import { readErc20Balance } from "@/lib/chain/erc20";

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
  getOrCreateSeasonEntry: vi.fn(),
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
  min_trade_size_usdc: 0.5,
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

function mockSeasonTables(options: {
  tokenResult?: unknown;
  positionResult?: unknown;
} = {}) {
  const tokenResult = options.tokenResult ?? { data: seasonToken, error: null };
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
    if (table === "season_positions") {
      return singleRowQuery(options.positionResult ?? { data: null, error: null });
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

function sellIntent(amountValue: number, symbol = "AERO") {
  return {
    userId: "user-1",
    walletId: "wallet-1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    privyWalletId: "privy-wallet-1",
    intent: {
      action: "sell" as const,
      symbol,
      amount_type: "percent_out" as const,
      amount_value: amountValue,
    },
  };
}

describe("validatePolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getActiveSeason as unknown as Mock).mockResolvedValue(null);
    (getOrCreateSeasonEntry as unknown as Mock).mockResolvedValue({
      entry: activeEntry,
      created: false,
    });
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
    mockSeasonTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(null);

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({ ok: false, reason: "no_active_season" });
  });

  it("auto-enters funded users before validating season buys", async () => {
    mockSeasonTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getOrCreateSeasonEntry as unknown as Mock).mockResolvedValue({
      entry: activeEntry,
      created: true,
    });

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({
      ok: true,
      context: {
        season: {
          seasonId: "season-1",
          seasonEntryId: "entry-1",
        },
      },
    });
    expect(getOrCreateSeasonEntry).toHaveBeenCalledWith({
      season: activeSeason,
      userId: "user-1",
      walletId: "wallet-1",
    });
  });

  it("rejects inactive season entries", async () => {
    mockSeasonTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getOrCreateSeasonEntry as unknown as Mock).mockResolvedValue({
      entry: {
        ...activeEntry,
        status: "settled",
      },
      created: false,
    });

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({ ok: false, reason: "season_entry_inactive" });
  });

  it("rejects the sixth season buy", async () => {
    mockSeasonTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getOrCreateSeasonEntry as unknown as Mock).mockResolvedValue({
      entry: {
        ...activeEntry,
        trades_used: 5,
        max_trades: 5,
      },
      created: false,
    });

    const result = await validatePolicy(buyIntent(5));

    expect(result).toMatchObject({ ok: false, reason: "season_max_trades_reached" });
  });

  it("rejects tokens outside the season token list", async () => {
    mockSeasonTables({ tokenResult: { data: null, error: null } });
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);

    const result = await validatePolicy(buyIntent(5, "DEGEN"));

    expect(result).toMatchObject({ ok: false, reason: "season_token_not_approved" });
  });

  it("rejects season buys below the minimum trade size", async () => {
    mockSeasonTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);

    const result = await validatePolicy(buyIntent(0.49));

    expect(result).toMatchObject({
      ok: false,
      reason: "season_min_trade_size",
      seasonMinTradeUsdc: 0.5,
    });
  });

  it("rejects season buys above virtual cash even when wallet policy allows it", async () => {
    mockSeasonTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getOrCreateSeasonEntry as unknown as Mock).mockResolvedValue({
      entry: {
        ...activeEntry,
        cash_remaining_usdc: 6,
      },
      created: false,
    });

    const result = await validatePolicy(buyIntent(7));

    expect(result).toMatchObject({
      ok: false,
      reason: "season_insufficient_arena_balance",
    });
  });

  it("accepts valid season buys with season context", async () => {
    mockSeasonTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);

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

  it("sizes active-season sells from season_positions instead of wallet balance", async () => {
    mockSeasonTables({
      positionResult: {
        data: { token_amount: 100 },
        error: null,
      },
    });
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (readErc20Balance as unknown as Mock).mockResolvedValue(BigInt(1_000) * BigInt(10) ** BigInt(18));

    const result = await validatePolicy(sellIntent(100));

    expect(result).toMatchObject({
      ok: true,
      context: {
        sellAssetBaseUnits: "100000000000000000000",
        season: {
          seasonId: "season-1",
          seasonEntryId: "entry-1",
        },
      },
    });
    expect(readErc20Balance).not.toHaveBeenCalled();
  });

  it("rejects active-season sells when no Victus position exists", async () => {
    mockSeasonTables();
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);

    const result = await validatePolicy(sellIntent(100));

    expect(result).toMatchObject({
      ok: false,
      reason: "season_insufficient_position",
    });
  });

  it("rejects active-season sells after weekly tickets are spent", async () => {
    mockSeasonTables({
      positionResult: {
        data: { token_amount: 100 },
        error: null,
      },
    });
    (getActiveSeason as unknown as Mock).mockResolvedValue(activeSeason);
    (getOrCreateSeasonEntry as unknown as Mock).mockResolvedValue({
      entry: {
        ...activeEntry,
        trades_used: 5,
        max_trades: 5,
      },
      created: false,
    });

    const result = await validatePolicy(sellIntent(50));

    expect(result).toMatchObject({
      ok: false,
      reason: "season_max_trades_reached",
    });
  });
});
