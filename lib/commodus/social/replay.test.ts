import { beforeEach, describe, expect, it, vi } from "vitest";

const latestRun = vi.hoisted(() => ({
  id: "original-run",
  trigger_cast_hash: "0xinbound",
}));
const storedCast = vi.hoisted(() => ({
  hash: "0xinbound",
  text: "what do you think, @commodus?",
  thread_hash: "0xthread",
  parent_hash: "0xparent",
  parent_author_fid: 999,
  author_fid: 42,
  raw_json: {
    author: { fid: 42, username: "trader" },
    parent_author: { fid: 999 },
    mentioned_profiles: [{ fid: 999 }],
    embeds: [],
  },
}));
const insertedRows = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const insertedRun = vi.hoisted(() => ({
  id: "new-run",
  action: "reply",
}));

const replayMocks = vi.hoisted(() => {
  const defaults = {
    classifyResult: { match: true, reason: "reply_to_commodus" },
    limitState: {
      blocklisted: false,
      threadMuted: false,
      threadReplyCount: 0,
      authorReplyCount24h: 0,
    },
    authorRelationship: {
      relationship: "unknown" as const,
      lastInteractionAt: null as string | null,
    },
    rankResult: {
      action: "reply",
      score: 66,
      reason: "ranked_reply",
      riskFlags: [] as string[],
    },
    generationResult: {
      action: "reply",
      reason: "generated_reply",
      reply: "The arena asked. I answered.",
      riskFlags: [] as string[],
      promptSnapshot: { system: "voice", prompt: "prompt" },
      modelOutput: { selected: { reply: "The arena asked. I answered." } },
    },
  };

  return {
    defaults,
    classifySocialCast: vi.fn(() => ({ ...defaults.classifyResult })),
    socialLimits: {
      evaluateSocialLimits: vi.fn(() => ({ allowed: true })),
      loadAuthorRelationship: vi.fn().mockResolvedValue({ ...defaults.authorRelationship }),
      loadSocialLimitState: vi.fn().mockResolvedValue({ ...defaults.limitState }),
    },
    rankSocialCast: vi.fn(() => ({ ...defaults.rankResult })),
    buildCommodusSocialContext: vi.fn().mockResolvedValue({ context: true }),
    generateCommodusSocialReply: vi.fn().mockResolvedValue({ ...defaults.generationResult }),
  };
});

vi.mock("@/lib/env", () => ({
  env: { COMMODUS_FID: 999 },
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/lib/workflows/commodus-social", () => ({
  classifySocialCast: replayMocks.classifySocialCast,
}));

vi.mock("@/lib/commodus/social/limits", () => replayMocks.socialLimits);
vi.mock("@/lib/commodus/social/rank", () => ({ rankSocialCast: replayMocks.rankSocialCast }));
vi.mock("@/lib/commodus/social/context", () => ({
  buildCommodusSocialContext: replayMocks.buildCommodusSocialContext,
}));
vi.mock("@/lib/commodus/social/generate", () => ({
  generateCommodusSocialReply: replayMocks.generateCommodusSocialReply,
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeQuery(table)),
  },
}));

import { supabaseAdmin } from "@/lib/supabase/server";

import { replayCommodusSocialTrigger, ReplayNotFoundError } from "./replay";

const { classifySocialCast, socialLimits, rankSocialCast, buildCommodusSocialContext, generateCommodusSocialReply } =
  replayMocks;

function makeQuery(table: string) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      if (table === "commodus_social_runs") {
        return Promise.resolve({ data: latestRun, error: null });
      }
      if (table === "commodus_casts") {
        return Promise.resolve({ data: storedCast, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    insert(row: Record<string, unknown>) {
      insertedRows.push(row);
      return {
        select() {
          return {
            single() {
              return Promise.resolve({ data: insertedRun, error: null });
            },
          };
        },
      };
    },
  };
}

describe("replayCommodusSocialTrigger", () => {
  beforeEach(() => {
    insertedRows.length = 0;
    vi.mocked(supabaseAdmin.from).mockClear();
    classifySocialCast.mockClear().mockReturnValue({ ...replayMocks.defaults.classifyResult });
    socialLimits.evaluateSocialLimits.mockClear().mockReturnValue({ allowed: true });
    socialLimits.loadAuthorRelationship.mockClear().mockResolvedValue({
      ...replayMocks.defaults.authorRelationship,
    });
    socialLimits.loadSocialLimitState.mockClear().mockResolvedValue({
      ...replayMocks.defaults.limitState,
    });
    rankSocialCast.mockClear().mockReturnValue({ ...replayMocks.defaults.rankResult });
    buildCommodusSocialContext.mockClear().mockResolvedValue({ context: true });
    generateCommodusSocialReply.mockClear().mockResolvedValue({
      ...replayMocks.defaults.generationResult,
    });
  });

  it("writes a fresh manual run for a stored trigger cast", async () => {
    const result = await replayCommodusSocialTrigger(" 0xinbound ");

    expect(result).toEqual({
      originalRunId: "original-run",
      newRunId: "new-run",
      triggerCastHash: "0xinbound",
      action: "reply",
      reason: "generated_reply",
      score: 66,
      draft: "The arena asked. I answered.",
      riskFlags: [],
    });
    expect(insertedRows[0]).toMatchObject({
      run_type: "manual",
      trigger_cast_hash: "0xinbound",
      selected_cast_hash: "0xinbound",
      action: "reply",
      score: 66,
      reason: "generated_reply",
      prompt_snapshot: { system: "voice", prompt: "prompt" },
      model_output: { selected: { reply: "The arena asked. I answered." } },
    });
    expect(String(insertedRows[0]?.idem_key)).toContain("manual-replay:0xinbound:");
    expect(buildCommodusSocialContext).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: "0xinbound",
        author: { fid: 42, username: "trader" },
      }),
    );
  });

  it("does not generate when current ranking decides to save only", async () => {
    rankSocialCast.mockReturnValue({
      action: "save_only",
      score: 8,
      reason: "low_context",
      riskFlags: ["low_context"],
    });

    const result = await replayCommodusSocialTrigger("0xinbound");

    expect(result).toMatchObject({
      action: "save_only",
      reason: "low_context",
      draft: null,
      riskFlags: ["low_context"],
    });
    expect(generateCommodusSocialReply).not.toHaveBeenCalled();
    expect(insertedRows[0]).toMatchObject({
      run_type: "manual",
      action: "save_only",
      prompt_snapshot: {},
      model_output: {},
    });
  });

  it("throws a not-found error when the trigger cast is not stored", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      const query = makeQuery(table);
      if (table === "commodus_casts") {
        return {
          ...query,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
      }
      return query;
    });

    await expect(replayCommodusSocialTrigger("0xmissing")).rejects.toBeInstanceOf(
      ReplayNotFoundError,
    );
  });
});
