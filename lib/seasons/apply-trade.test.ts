import { describe, expect, it, vi } from "vitest";

import { applySeasonBuy, applySeasonSell } from "./apply-trade";

type Step =
  | { table: string; op: "read"; data: unknown; error?: unknown }
  | { table: string; op: "insert"; error?: { code?: string; message: string } | null }
  | { table: string; op: "update"; error?: { message: string } | null }
  | { table: string; op: "delete"; error?: { message: string } | null };

function makeClient(steps: Step[]) {
  const writes: Array<{ table: string; op: "insert" | "update" | "delete"; payload: unknown }> = [];
  let i = 0;

  const from = vi.fn((table: string) => {
    const step = steps[i++];
    if (!step) throw new Error(`unexpected supabase call to ${table}`);
    expect(step.table).toBe(table);

    if (step.op === "read") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: step.data,
          error: step.error ?? null,
        }),
      };
    }

    if (step.op === "insert") {
      return {
        insert: vi.fn((payload) => {
          writes.push({ table, op: "insert", payload });
          return Promise.resolve({ error: step.error ?? null });
        }),
      };
    }

    if (step.op === "delete") {
      return {
        delete: vi.fn(() => {
          writes.push({ table, op: "delete", payload: null });
          return {
            eq: vi.fn().mockResolvedValue({ error: step.error ?? null }),
          };
        }),
      };
    }

    return {
      update: vi.fn((payload) => {
        writes.push({ table, op: "update", payload });
        return {
          eq: vi.fn().mockResolvedValue({ error: step.error ?? null }),
        };
      }),
    };
  });

  return {
    client: { from } as unknown as Parameters<typeof applySeasonBuy>[1],
    writes,
  };
}

const params = {
  tradeExecutionId: "execution-1",
  seasonId: "season-1",
  seasonEntryId: "entry-1",
  userId: "user-1",
  walletId: "wallet-1",
  tokenSymbol: "AERO",
  tokenAddress: "0x00000000000000000000000000000000000000a1",
};

const confirmedExecution = {
  id: "execution-1",
  status: "confirmed",
  notional_usdc: 4.95,
  quantity: 10,
  execution_price_usdc: 0.495,
  swap_fee_usdc: 0.05,
  tx_hash: "0xabc",
};

const confirmedSellExecution = {
  ...confirmedExecution,
  notional_usdc: 6,
  quantity: 10,
  execution_price_usdc: 0.6,
  swap_fee_usdc: 0.06,
};

describe("applySeasonBuy", () => {
  it("books a confirmed buy into season trades, entry cash, and a new position", async () => {
    const { client, writes } = makeClient([
      { table: "trade_executions", op: "read", data: confirmedExecution },
      { table: "season_trades", op: "insert" },
      {
        table: "season_entries",
        op: "read",
        data: {
          season_id: "season-1",
          cash_remaining_usdc: 10,
          trades_used: 0,
          has_qualifying_trade: false,
        },
      },
      { table: "seasons", op: "read", data: { min_trade_size_usdc: 2 } },
      { table: "season_entries", op: "update" },
      { table: "season_positions", op: "read", data: null },
      { table: "season_positions", op: "insert" },
    ]);

    await expect(applySeasonBuy(params, client)).resolves.toEqual({
      applied: true,
    });

    expect(writes).toEqual([
      expect.objectContaining({
        table: "season_trades",
        op: "insert",
        payload: expect.objectContaining({
          trade_execution_id: "execution-1",
          notional_usdc: 4.95,
          token_amount: 10,
          fees_usdc: 0.05,
        }),
      }),
      expect.objectContaining({
        table: "season_entries",
        op: "update",
        payload: {
          cash_remaining_usdc: 5,
          trades_used: 1,
          has_qualifying_trade: true,
        },
      }),
      expect.objectContaining({
        table: "season_positions",
        op: "insert",
        payload: expect.objectContaining({
          token_symbol: "AERO",
          token_amount: 10,
          average_entry_price: 0.495,
        }),
      }),
    ]);
  });

  it("updates an existing position using weighted-average entry price", async () => {
    const { client, writes } = makeClient([
      { table: "trade_executions", op: "read", data: confirmedExecution },
      { table: "season_trades", op: "insert" },
      {
        table: "season_entries",
        op: "read",
        data: {
          season_id: "season-1",
          cash_remaining_usdc: 10,
          trades_used: 1,
          has_qualifying_trade: true,
        },
      },
      { table: "seasons", op: "read", data: { min_trade_size_usdc: 2 } },
      { table: "season_entries", op: "update" },
      {
        table: "season_positions",
        op: "read",
        data: { id: "pos-1", token_amount: 10, average_entry_price: 0.25 },
      },
      { table: "season_positions", op: "update" },
    ]);

    await expect(applySeasonBuy(params, client)).resolves.toEqual({
      applied: true,
    });

    expect(writes.at(-1)).toEqual({
      table: "season_positions",
      op: "update",
      payload: {
        token_amount: 20,
        average_entry_price: 0.3725,
      },
    });
  });

  it("is idempotent when the trade execution was already applied", async () => {
    const { client, writes } = makeClient([
      { table: "trade_executions", op: "read", data: confirmedExecution },
      {
        table: "season_trades",
        op: "insert",
        error: { code: "23505", message: "duplicate key value" },
      },
    ]);

    await expect(applySeasonBuy(params, client)).resolves.toEqual({
      applied: false,
      reason: "duplicate",
    });
    expect(writes).toHaveLength(1);
  });

  it("does not consume cash or a ticket for unconfirmed executions", async () => {
    const { client, writes } = makeClient([
      {
        table: "trade_executions",
        op: "read",
        data: { ...confirmedExecution, status: "failed" },
      },
    ]);

    await expect(applySeasonBuy(params, client)).resolves.toEqual({
      applied: false,
      reason: "not_confirmed",
    });
    expect(writes).toEqual([]);
  });
});

describe("applySeasonSell", () => {
  it("books a confirmed sell into season trades, entry cash, and decremented position", async () => {
    const { client, writes } = makeClient([
      { table: "trade_executions", op: "read", data: confirmedSellExecution },
      { table: "season_trades", op: "insert" },
      {
        table: "season_entries",
        op: "read",
        data: {
          season_id: "season-1",
          cash_remaining_usdc: 3,
          trades_used: 1,
          has_qualifying_trade: false,
        },
      },
      { table: "seasons", op: "read", data: { min_trade_size_usdc: 2 } },
      { table: "season_entries", op: "update" },
      {
        table: "season_positions",
        op: "read",
        data: { id: "pos-1", token_amount: 25 },
      },
      { table: "season_positions", op: "update" },
    ]);

    await expect(applySeasonSell(params, client)).resolves.toEqual({
      applied: true,
    });

    expect(writes).toEqual([
      expect.objectContaining({
        table: "season_trades",
        op: "insert",
        payload: expect.objectContaining({
          action: "sell",
          trade_execution_id: "execution-1",
          notional_usdc: 6,
          token_amount: 10,
          fees_usdc: 0.06,
        }),
      }),
      expect.objectContaining({
        table: "season_entries",
        op: "update",
        payload: {
          cash_remaining_usdc: 8.94,
          trades_used: 2,
          has_qualifying_trade: true,
        },
      }),
      expect.objectContaining({
        table: "season_positions",
        op: "update",
        payload: { token_amount: 15 },
      }),
    ]);
  });

  it("deletes a season position when a sell leaves only dust", async () => {
    const { client, writes } = makeClient([
      { table: "trade_executions", op: "read", data: confirmedSellExecution },
      { table: "season_trades", op: "insert" },
      {
        table: "season_entries",
        op: "read",
        data: {
          season_id: "season-1",
          cash_remaining_usdc: 0,
          trades_used: 1,
          has_qualifying_trade: true,
        },
      },
      { table: "seasons", op: "read", data: { min_trade_size_usdc: 2 } },
      { table: "season_entries", op: "update" },
      {
        table: "season_positions",
        op: "read",
        data: { id: "pos-1", token_amount: 10.0000000000005 },
      },
      { table: "season_positions", op: "delete" },
    ]);

    await expect(applySeasonSell(params, client)).resolves.toEqual({
      applied: true,
    });

    expect(writes.at(-1)).toEqual({
      table: "season_positions",
      op: "delete",
      payload: null,
    });
  });

  it("is idempotent when the sell execution was already applied", async () => {
    const { client, writes } = makeClient([
      { table: "trade_executions", op: "read", data: confirmedSellExecution },
      {
        table: "season_trades",
        op: "insert",
        error: { code: "23505", message: "duplicate key value" },
      },
    ]);

    await expect(applySeasonSell(params, client)).resolves.toEqual({
      applied: false,
      reason: "duplicate",
    });
    expect(writes).toHaveLength(1);
  });

  it("does not consume cash or a ticket for failed sell executions", async () => {
    const { client, writes } = makeClient([
      {
        table: "trade_executions",
        op: "read",
        data: { ...confirmedSellExecution, status: "failed" },
      },
    ]);

    await expect(applySeasonSell(params, client)).resolves.toEqual({
      applied: false,
      reason: "not_confirmed",
    });
    expect(writes).toEqual([]);
  });
});
