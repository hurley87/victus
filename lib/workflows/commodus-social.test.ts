import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
const from = vi.hoisted(() => vi.fn().mockReturnValue({ upsert }));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: { from },
}));

vi.mock("@/lib/env", () => ({
  env: { COMMODUS_FID: 999 } as Record<string, unknown>,
}));

vi.mock("@/lib/logger", () => ({
  log: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  classifySocialCast,
  deriveIdemKey,
  handleSocialEngagement,
  type SocialCastEvent,
} from "./commodus-social";

const COMMODUS_FID = 999;

function buildCast(overrides: Partial<SocialCastEvent> = {}): SocialCastEvent {
  return {
    hash: "0xinbound",
    text: "hello @commodus",
    thread_hash: "0xroot",
    parent_hash: "0xparent",
    parent_author: { fid: COMMODUS_FID },
    author: { fid: 42, username: "trader" },
    mentioned_profiles: [],
    embeds: [],
    ...overrides,
  };
}

describe("classifySocialCast", () => {
  it("matches replies to Commodus", () => {
    expect(classifySocialCast(buildCast(), COMMODUS_FID)).toEqual({
      match: true,
      reason: "reply_to_commodus",
    });
  });

  it("matches mentions of Commodus", () => {
    const cast = buildCast({
      parent_author: { fid: 7 },
      mentioned_profiles: [{ fid: COMMODUS_FID }],
    });
    expect(classifySocialCast(cast, COMMODUS_FID)).toEqual({
      match: true,
      reason: "mention",
    });
  });

  it("drops quote casts even when mentioning Commodus", () => {
    const cast = buildCast({
      parent_author: { fid: null },
      mentioned_profiles: [{ fid: COMMODUS_FID }],
      embeds: [{ cast_id: { hash: "0xquoted", fid: 1 } }],
    });
    expect(classifySocialCast(cast, COMMODUS_FID)).toEqual({
      match: false,
      reason: "quote_cast",
    });
  });

  it("drops self-casts from Commodus", () => {
    const cast = buildCast({ author: { fid: COMMODUS_FID } });
    expect(classifySocialCast(cast, COMMODUS_FID)).toEqual({
      match: false,
      reason: "self_cast",
    });
  });

  it("ignores unrelated casts", () => {
    const cast = buildCast({
      parent_author: { fid: 7 },
      mentioned_profiles: [{ fid: 8 }],
    });
    expect(classifySocialCast(cast, COMMODUS_FID)).toEqual({
      match: false,
      reason: "unrelated",
    });
  });
});

describe("deriveIdemKey", () => {
  it("is stable for the same trigger + run type", () => {
    expect(deriveIdemKey("0xabc", "webhook")).toEqual(deriveIdemKey("0xabc", "webhook"));
  });

  it("differs across run types", () => {
    expect(deriveIdemKey("0xabc", "webhook")).not.toEqual(
      deriveIdemKey("0xabc", "manual"),
    );
  });
});

describe("handleSocialEngagement", () => {
  beforeEach(() => {
    upsert.mockClear().mockResolvedValue({ error: null });
    from.mockClear().mockReturnValue({ upsert });
  });

  it("persists cast and lands an ignore run for a reply to Commodus", async () => {
    const cast = buildCast();
    const result = await handleSocialEngagement({
      triggerHash: cast.hash,
      runType: "webhook",
      cast,
    });

    expect(result).toEqual({ status: "ignored", reason: "reply_to_commodus" });

    const tables = from.mock.calls.map((args) => args[0]);
    expect(tables).toEqual(["commodus_casts", "commodus_social_runs"]);

    const castRow = upsert.mock.calls[0][0];
    expect(castRow).toMatchObject({
      hash: cast.hash,
      author_fid: cast.author.fid,
      parent_author_fid: COMMODUS_FID,
      source: "webhook",
    });

    const runRow = upsert.mock.calls[1][0];
    expect(runRow).toMatchObject({
      action: "ignore",
      run_type: "webhook",
      trigger_cast_hash: cast.hash,
      selected_cast_hash: cast.hash,
      reason: "accepted:reply_to_commodus",
    });
  });

  it("logs a run row but no cast row for an unrelated cast", async () => {
    const cast = buildCast({
      parent_author: { fid: 7 },
      mentioned_profiles: [{ fid: 8 }],
    });

    const result = await handleSocialEngagement({
      triggerHash: cast.hash,
      runType: "webhook",
      cast,
    });

    expect(result).toEqual({ status: "ignored", reason: "unrelated" });

    const tables = from.mock.calls.map((args) => args[0]);
    expect(tables).toEqual(["commodus_social_runs"]);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      action: "ignore",
      reason: "filter:unrelated",
    });
  });

  it("does not process quote casts", async () => {
    const cast = buildCast({
      parent_author: { fid: null },
      mentioned_profiles: [{ fid: COMMODUS_FID }],
      embeds: [{ cast_id: { hash: "0xquoted", fid: 1 } }],
    });

    await handleSocialEngagement({
      triggerHash: cast.hash,
      runType: "webhook",
      cast,
    });

    const tables = from.mock.calls.map((args) => args[0]);
    expect(tables).toEqual(["commodus_social_runs"]);
    expect(upsert.mock.calls[0][0]).toMatchObject({ reason: "filter:quote_cast" });
  });

  it("uses idem_key based on trigger hash so retries collapse", async () => {
    const cast = buildCast();

    await handleSocialEngagement({
      triggerHash: cast.hash,
      runType: "webhook",
      cast,
    });
    await handleSocialEngagement({
      triggerHash: cast.hash,
      runType: "webhook",
      cast,
    });

    const idemUpserts = upsert.mock.calls.filter((c) => c[1]?.onConflict === "idem_key");
    const runRows = idemUpserts.map((call) => call[0]);

    expect(runRows).toHaveLength(2);
    expect(runRows[0].idem_key).toEqual(runRows[1].idem_key);
    expect(runRows[0].idem_key).toEqual(deriveIdemKey(cast.hash, "webhook"));
    const idemOptions = { onConflict: "idem_key", ignoreDuplicates: true };
    expect(idemUpserts[0][1]).toEqual(idemOptions);
    expect(idemUpserts[1][1]).toEqual(idemOptions);
  });
});
