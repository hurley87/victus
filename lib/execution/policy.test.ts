import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { supabaseAdmin } from "@/lib/supabase/server";

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

describe("validatePolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
