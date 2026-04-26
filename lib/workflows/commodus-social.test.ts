import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
const from = vi.hoisted(() => vi.fn().mockReturnValue({ upsert }));
const socialLimits = vi.hoisted(() => ({
  evaluateSocialLimits: vi.fn((): unknown => ({ allowed: true })),
  loadAuthorRelationship: vi.fn().mockResolvedValue({
    relationship: "unknown",
    lastInteractionAt: null,
  }),
  loadSocialLimitState: vi.fn().mockResolvedValue({
    blocklisted: false,
    threadMuted: false,
    threadReplyCount: 0,
    authorReplyCount24h: 0,
  }),
}));
const socialContext = vi.hoisted(() => ({
  buildCommodusSocialContext: vi.fn().mockResolvedValue({
    triggerCast: {
      hash: "0xinbound",
      text: "hello @commodus",
      authorFid: 42,
      authorUsername: "trader",
      threadHash: "0xroot",
    },
    threadMessages: [],
    authorMemory: null,
    threadMemory: null,
    recentSelfPosts: [],
    docs: { lore: "lore", voice: "voice", safety: "safety" },
  }),
}));
const mockSocialGeneration = vi.hoisted(() => ({
  action: "reply" as const,
  reason: "generated_reply",
  reply: "I heard the arena cough.",
  riskFlags: [] as string[],
  promptSnapshot: { system: "voice+safety", prompt: "context" },
  modelOutput: { selected: { shouldReply: true, reply: "I heard the arena cough." } },
}));

const socialGenerate = vi.hoisted(() => ({
  generateCommodusSocialReply: vi.fn().mockResolvedValue(mockSocialGeneration),
}));
const socialPost = vi.hoisted(() => ({
  publishCommodusSocialReplyOnce: vi.fn().mockResolvedValue({
    postedCastHash: "0xreply",
    published: true,
  }),
}));
const socialMemory = vi.hoisted(() => ({
  scheduleCommodusSocialMemoryRefresh: vi.fn().mockResolvedValue({
    runId: "memory-run-1",
  }),
}));
const envMock = vi.hoisted(() => ({
  COMMODUS_FID: 999,
  COMMODUS_SOCIAL_DRY_RUN: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: { from },
}));

vi.mock("@/lib/env", () => ({
  env: envMock as Record<string, unknown>,
}));

vi.mock("@/lib/logger", () => ({
  log: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/commodus/social/limits", () => socialLimits);
vi.mock("@/lib/commodus/social/context", () => socialContext);
vi.mock("@/lib/commodus/social/generate", () => socialGenerate);
vi.mock("@/lib/commodus/social/post", () => socialPost);
vi.mock("@/lib/commodus/social/memory", () => socialMemory);

import { deriveIdemKey } from "./commodus-social-idem";
import {
  classifySocialCast,
  handleSocialEngagement,
  type SocialCastEvent,
  type SocialEngagementContext,
} from "./commodus-social";

const COMMODUS_FID = envMock.COMMODUS_FID as number;

function buildSocialCtx(
  cast: SocialCastEvent,
  runType: SocialEngagementContext["runType"] = "webhook",
): SocialEngagementContext {
  return {
    runId: deriveIdemKey(cast.hash, runType),
    triggerHash: cast.hash,
    runType,
    cast,
  };
}

function upsertedTables() {
  return from.mock.calls.map(([table]) => table);
}

function upsertRow(index: number) {
  return upsert.mock.calls[index][0];
}

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

function resetSocialWorkflowMocks() {
  envMock.COMMODUS_SOCIAL_DRY_RUN = true;
  upsert.mockClear().mockResolvedValue({ error: null });
  from.mockClear().mockReturnValue({ upsert });
  socialLimits.evaluateSocialLimits.mockReturnValue({ allowed: true });
  socialLimits.loadAuthorRelationship.mockResolvedValue({
    relationship: "unknown",
    lastInteractionAt: null,
  });
  socialLimits.loadSocialLimitState.mockResolvedValue({
    blocklisted: false,
    threadMuted: false,
    threadReplyCount: 0,
    authorReplyCount24h: 0,
  });
  socialContext.buildCommodusSocialContext.mockClear();
  socialGenerate.generateCommodusSocialReply
    .mockClear()
    .mockResolvedValue(mockSocialGeneration);
  socialPost.publishCommodusSocialReplyOnce.mockClear().mockResolvedValue({
    postedCastHash: "0xreply",
    published: true,
  });
  socialMemory.scheduleCommodusSocialMemoryRefresh.mockClear().mockResolvedValue({
    runId: "memory-run-1",
  });
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
    resetSocialWorkflowMocks();
  });

  it("persists cast and lands a ranked run for a reply to Commodus", async () => {
    const cast = buildCast();
    const result = await handleSocialEngagement(buildSocialCtx(cast));

    expect(result).toEqual({
      status: "ranked",
      action: "reply",
      reason: "generated_reply",
    });

    expect(upsertedTables()).toEqual(["commodus_casts", "commodus_social_runs"]);

    expect(upsertRow(0)).toMatchObject({
      hash: cast.hash,
      author_fid: cast.author.fid,
      parent_author_fid: COMMODUS_FID,
      source: "webhook",
    });

    expect(upsertRow(1)).toMatchObject({
      action: "reply",
      run_type: "webhook",
      trigger_cast_hash: cast.hash,
      selected_cast_hash: cast.hash,
      reason: "generated_reply",
      risk_flags: [],
      prompt_snapshot: { system: "voice+safety", prompt: "context" },
      model_output: { selected: { shouldReply: true, reply: "I heard the arena cough." } },
    });
    expect(socialContext.buildCommodusSocialContext).toHaveBeenCalledWith(cast);
    expect(socialGenerate.generateCommodusSocialReply).toHaveBeenCalled();
    expect(socialPost.publishCommodusSocialReplyOnce).not.toHaveBeenCalled();
  });

  it("publishes generated replies when dry run is disabled", async () => {
    envMock.COMMODUS_SOCIAL_DRY_RUN = false;
    const cast = buildCast();

    const result = await handleSocialEngagement(buildSocialCtx(cast));

    expect(result).toEqual({
      status: "ranked",
      action: "reply",
      reason: "generated_reply",
    });
    expect(socialPost.publishCommodusSocialReplyOnce).toHaveBeenCalledWith({
      runId: deriveIdemKey(cast.hash, "webhook"),
      triggerCast: cast,
      replyText: "I heard the arena cough.",
    });
    expect(socialMemory.scheduleCommodusSocialMemoryRefresh).toHaveBeenCalledWith({
      threadHash: "0xroot",
      fid: 42,
      lastCastHash: "0xreply",
    });
    const runUpsertOrder = upsert.mock.invocationCallOrder[1];
    const publishOrder =
      socialPost.publishCommodusSocialReplyOnce.mock.invocationCallOrder[0];
    const memoryOrder =
      socialMemory.scheduleCommodusSocialMemoryRefresh.mock.invocationCallOrder[0];
    expect(runUpsertOrder).toBeLessThan(publishOrder);
    expect(publishOrder).toBeLessThan(memoryOrder);
  });

  it("stores LLM vetoes as ignore rows with populated prompt and model output", async () => {
    socialGenerate.generateCommodusSocialReply.mockResolvedValue({
      action: "ignore",
      reason: "llm_veto:too little signal",
      reply: null,
      riskFlags: ["low_context"],
      promptSnapshot: { system: "voice+safety", prompt: "context" },
      modelOutput: { selected: { shouldReply: false, reason: "too little signal" } },
    });

    const cast = buildCast();
    const result = await handleSocialEngagement(buildSocialCtx(cast));

    expect(result).toEqual({
      status: "ranked",
      action: "ignore",
      reason: "llm_veto:too little signal",
    });
    expect(upsertRow(1)).toMatchObject({
      action: "ignore",
      reason: "llm_veto:too little signal",
      risk_flags: ["low_context"],
      prompt_snapshot: { system: "voice+safety", prompt: "context" },
      model_output: { selected: { shouldReply: false, reason: "too little signal" } },
    });
  });

  it("persists blocklisted matches as ignore with blocklist reason", async () => {
    socialLimits.evaluateSocialLimits.mockReturnValue({
      allowed: false,
      reason: "blocklist",
      riskFlags: ["blocklist"],
    });

    const cast = buildCast({ text: "@commodus direct mention from blocklisted fid" });
    const result = await handleSocialEngagement(buildSocialCtx(cast));

    expect(result).toEqual({
      status: "ranked",
      action: "ignore",
      reason: "blocklist",
    });
    expect(upsertRow(1)).toMatchObject({
      action: "ignore",
      reason: "blocklist",
      score: 0,
      risk_flags: ["blocklist"],
    });
  });

  it("logs a run row but no cast row for an unrelated cast", async () => {
    const cast = buildCast({
      parent_author: { fid: 7 },
      mentioned_profiles: [{ fid: 8 }],
    });

    const result = await handleSocialEngagement(buildSocialCtx(cast));

    expect(result).toEqual({
      status: "ranked",
      action: "ignore",
      reason: "filter:unrelated",
    });

    expect(upsertedTables()).toEqual(["commodus_social_runs"]);
    expect(upsertRow(0)).toMatchObject({
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

    await handleSocialEngagement(buildSocialCtx(cast));

    expect(upsertedTables()).toEqual(["commodus_social_runs"]);
    expect(upsertRow(0)).toMatchObject({
      action: "ignore",
      reason: "filter:quote_cast",
    });
  });

  it("uses idem_key based on trigger hash so retries collapse", async () => {
    const cast = buildCast();

    await handleSocialEngagement(buildSocialCtx(cast));
    await handleSocialEngagement(buildSocialCtx(cast));

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
