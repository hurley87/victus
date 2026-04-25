import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { supabaseAdmin } from "@/lib/supabase/server";

import { reserveAutotraderRun } from "./reserve";

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

describe("reserveAutotraderRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recurses and loads the row after a unique-violation on insert", async () => {
    const slot = "commodus-autotrade:2026-04-25:slot-1";
    const runTable = (supabaseAdmin.from as unknown as Mock);

    // 1) read → none. 2) insert → unique. 3) read → in_progress row. 4) update that row.
    let fromCalls = 0;
    runTable.mockImplementation((table: string) => {
      if (table !== "commodus_autotrader_runs") {
        return {};
      }
      fromCalls += 1;
      if (fromCalls === 1) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      if (fromCalls === 2) {
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: null, error: { code: "23505" } }),
            }),
          }),
        };
      }
      if (fromCalls === 3) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "run-conflict", status: "in_progress" },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (fromCalls === 4) {
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      return {};
    });

    const r = await reserveAutotraderRun(slot);
    expect(r.runId).toBe("run-conflict");
    expect(r.skip).toBe(false);
    expect(fromCalls).toBe(4);
  });

  it("skips when an existing run is already terminal", async () => {
    const runTable = (supabaseAdmin.from as unknown as Mock);
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "done", status: "hold_posted" },
      error: null,
    });
    runTable.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    const r = await reserveAutotraderRun("k");
    expect(r.skip).toBe(true);
    expect(r.existingStatus).toBe("hold_posted");
  });
});
