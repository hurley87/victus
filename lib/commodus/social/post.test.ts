import { beforeEach, describe, expect, it, vi } from "vitest";

const publishReplyCast = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const envMock = vi.hoisted(() => ({ COMMODUS_FID: 999 }));

vi.mock("@/lib/env", () => ({
  env: envMock,
}));

vi.mock("@/lib/neynar", () => ({
  MissingSignerError: class MissingSignerError extends Error {},
  publishReplyCast,
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: { from },
}));

import { publishCommodusSocialReplyOnce } from "./post";
import type { SocialCastEvent } from "@/lib/workflows/commodus-social";

const triggerCast: SocialCastEvent = {
  hash: "0xinbound",
  text: "say something, @commodus",
  thread_hash: "0xthread",
  parent_hash: "0xparent",
  parent_author: { fid: 999 },
  author: { fid: 42, username: "trader" },
  mentioned_profiles: [{ fid: 999 }],
  embeds: [],
};

const runRow = {
  id: "run-row-id",
  action: "reply",
  idem_key: "idem:0xinbound:webhook",
  posted_cast_hash: null as string | null,
};

const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = [];
const updates: Array<{ table: string; row: Record<string, unknown> }> = [];

type InsertError = { message: string; code: string };

function mockSupabase(opts?: { insertError?: InsertError | null }) {
  from.mockImplementation((table: string) => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle() {
      if (table === "commodus_social_runs") {
        return Promise.resolve({ data: runRow, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    update(row: Record<string, unknown>) {
      updates.push({ table, row });
      return {
        eq: () => Promise.resolve({ error: null }),
      };
    },
    insert(row: Record<string, unknown>) {
      insertedRows.push({ table, row });
      const err = opts?.insertError ?? null;
      return Promise.resolve({ error: err });
    },
  }));
}

describe("publishCommodusSocialReplyOnce", () => {
  beforeEach(() => {
    insertedRows.length = 0;
    updates.length = 0;
    runRow.posted_cast_hash = null;
    from.mockReset();
    publishReplyCast.mockReset().mockResolvedValue({
      hash: "0xposted",
      author_fid: 999,
      text: "The arena asked. I answered.",
    });
    mockSupabase();
  });

  it("publishes through Neynar, updates the run, and inserts a self-cast row", async () => {
    const result = await publishCommodusSocialReplyOnce({
      runId: runRow.idem_key,
      triggerCast,
      replyText: "The arena asked. I answered.",
    });

    expect(result).toEqual({ postedCastHash: "0xposted", published: true });
    expect(publishReplyCast).toHaveBeenCalledWith(
      triggerCast.hash,
      "The arena asked. I answered.",
      runRow.idem_key,
    );
    expect(updates).toEqual([
      {
        table: "commodus_social_runs",
        row: { posted_cast_hash: "0xposted" },
      },
    ]);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      table: "commodus_casts",
      row: {
        hash: "0xposted",
        thread_hash: "0xthread",
        parent_hash: triggerCast.hash,
        parent_author_fid: 42,
        author_fid: 999,
        text: "The arena asked. I answered.",
        source: "self",
      },
    });
  });

  it("does not publish again when the run already has posted_cast_hash", async () => {
    runRow.posted_cast_hash = "0xposted";

    const result = await publishCommodusSocialReplyOnce({
      runId: runRow.idem_key,
      triggerCast,
      replyText: "The arena asked. I answered.",
    });

    expect(result).toEqual({ postedCastHash: "0xposted", published: false });
    expect(publishReplyCast).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(insertedRows[0]).toMatchObject({
      table: "commodus_casts",
      row: {
        hash: "0xposted",
        source: "self",
      },
    });
  });

  it("treats the self-cast insert unique constraint as idempotent", async () => {
    mockSupabase({ insertError: { message: "duplicate", code: "23505" } });

    await expect(
      publishCommodusSocialReplyOnce({
        runId: runRow.idem_key,
        triggerCast,
        replyText: "The arena asked. I answered.",
      }),
    ).resolves.toEqual({ postedCastHash: "0xposted", published: true });
  });
});
