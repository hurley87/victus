import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createServerWallet } from "@/lib/privy/server";
import { supabaseAdmin } from "@/lib/supabase/server";

import { provisionArenaWallet } from "./wallet";

vi.mock("@/lib/privy/server", () => ({
  createServerWallet: vi.fn(),
  PrivyNotConfiguredError: class PrivyNotConfiguredError extends Error {},
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

function maybeSingleQuery(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

function insertReturningQuery(result: unknown) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

function insertOnlyQuery(result: unknown) {
  return {
    insert: vi.fn().mockResolvedValue(result),
  };
}

function queueSupabaseTables(
  calls: { table: string; builder: Record<string, unknown> }[],
) {
  const from = supabaseAdmin.from as unknown as Mock;
  from.mockImplementation((table: string) => {
    const next = calls.shift();
    expect(table).toBe(next?.table);
    return next?.builder;
  });
}

describe("provisionArenaWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an existing arena wallet without creating a new Privy wallet", async () => {
    queueSupabaseTables([
      {
        table: "arena_wallets",
        builder: maybeSingleQuery({
          data: {
            id: "wallet-1",
            wallet_address: "0xabc",
            status: "active",
            created_at: "2026-04-25T12:00:00.000Z",
            funded_at: null,
          },
          error: null,
        }),
      },
      {
        table: "wallet_policies",
        builder: maybeSingleQuery({
          data: { min_funding_deposit_usdc: 12 },
          error: null,
        }),
      },
    ]);

    const result = await provisionArenaWallet({ userId: "user-1" });

    expect(createServerWallet).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      arena_address: "0xabc",
      min_funding_deposit_usdc: 12,
      replayed: true,
      wallet: { id: "wallet-1", status: "active", funded_at: null },
    });
  });

  it("creates an arena wallet and seeds a missing wallet policy", async () => {
    vi.mocked(createServerWallet).mockResolvedValue({
      id: "privy-wallet-1",
      address: "0xABCDEF0000000000000000000000000000000001",
      chainType: "ethereum",
    });

    const policyInsert = insertOnlyQuery({ error: null });

    queueSupabaseTables([
      {
        table: "arena_wallets",
        builder: maybeSingleQuery({ data: null, error: null }),
      },
      {
        table: "arena_wallets",
        builder: insertReturningQuery({
          data: {
            id: "wallet-1",
            wallet_address: "0xabcdef0000000000000000000000000000000001",
            status: "active",
            created_at: "2026-04-25T12:00:00.000Z",
            funded_at: null,
          },
          error: null,
        }),
      },
      {
        table: "wallet_policies",
        builder: maybeSingleQuery({ data: null, error: null }),
      },
      {
        table: "wallet_policies",
        builder: policyInsert,
      },
      {
        table: "wallet_policies",
        builder: maybeSingleQuery({
          data: { min_funding_deposit_usdc: 5 },
          error: null,
        }),
      },
    ]);

    const result = await provisionArenaWallet({ userId: "user-1" });

    expect(createServerWallet).toHaveBeenCalledOnce();
    expect(policyInsert.insert).toHaveBeenCalledWith({
      wallet_id: "wallet-1",
    });
    expect(result).toMatchObject({
      arena_address: "0xabcdef0000000000000000000000000000000001",
      min_funding_deposit_usdc: 5,
      replayed: false,
      wallet: { id: "wallet-1", status: "active", funded_at: null },
    });
  });
});
