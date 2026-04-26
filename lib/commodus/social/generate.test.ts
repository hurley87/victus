import { beforeEach, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => ({
  AI_GATEWAY_API_KEY: "k-test" as string | undefined,
}));

vi.mock("@/lib/env", () => ({ env: testEnv }));

import {
  evaluateCommodusSocialDraft,
  generateCommodusSocialReply,
} from "./generate";
import type { CommodusSocialContext } from "./context";

function buildContext(overrides: Partial<CommodusSocialContext> = {}): CommodusSocialContext {
  return {
    triggerCast: {
      hash: "0xinbound",
      text: "@commodus my timing was perfect",
      authorFid: 42,
      authorUsername: "trader",
      threadHash: "0xroot",
    },
    threadMessages: [
      {
        hash: "0xinbound",
        authorFid: 42,
        text: "@commodus my timing was perfect",
        source: "webhook",
        createdAt: "2026-04-26T00:00:00.000Z",
      },
    ],
    authorMemory: {
      summary: "Often brags after small green candles.",
      relationship: "rival",
    },
    threadMemory: {
      summary: "A thread about leaderboard ego.",
      participants: [42],
    },
    recentSelfPosts: [
      {
        hash: "0xself",
        authorFid: 999,
        text: "The arena remembers exits better than entries.",
        source: "self",
        createdAt: "2026-04-25T00:00:00.000Z",
      },
    ],
    docs: {
      lore: "Lore packet: the feed is the arena.",
      voice: "Voice guide: first person, modern, sharp.",
      safety: "Safety rules: no AI tells, no advice, no banned diction.",
    },
    ...overrides,
  };
}

describe("evaluateCommodusSocialDraft", () => {
  it("accepts a short in-voice reply", () => {
    expect(
      evaluateCommodusSocialDraft(
        "I saw the victory lap. Now do it while the candle moves against you.",
      ),
    ).toEqual({ ok: true, riskFlags: [] });
  });

  it("rejects banned content, AI tells, advice, and hashtag overuse", () => {
    expect(evaluateCommodusSocialDraft("As an AI, behold my #arena #trade")).toEqual({
      ok: false,
      riskFlags: ["hashtag_overuse", "ai_tell", "banned_term"],
    });

    expect(evaluateCommodusSocialDraft("You should buy $AERO here.")).toEqual({
      ok: false,
      riskFlags: ["financial_advice"],
    });
  });
});

describe("generateCommodusSocialReply", () => {
  beforeEach(() => {
    testEnv.AI_GATEWAY_API_KEY = "k-test";
  });

  it("returns a dry-run reply with prompt snapshot and model output", async () => {
    const output = {
      drafts: [
        {
          shouldReply: true,
          reason: "in_voice",
          reply: "I saw the victory lap. Now do it while the candle moves against you.",
          tone: "dismissive",
          riskFlags: [],
        },
        {
          shouldReply: true,
          reason: "alternate",
          reply: "The arena clapped once. Do not mistake that for a coronation.",
          tone: "cold",
          riskFlags: [],
        },
        {
          shouldReply: false,
          reason: "too sharp",
          reply: "",
          tone: "cold",
          riskFlags: ["too_mean"],
        },
      ],
      selectedIndex: 0,
      selected: {
        shouldReply: true,
        reason: "in_voice",
        reply: "I saw the victory lap. Now do it while the candle moves against you.",
        tone: "dismissive",
        riskFlags: [],
      },
    };
    const generate = vi.fn(async () => ({ output }));

    const result = await generateCommodusSocialReply(buildContext(), {
      generate: generate as never,
    });

    expect(result).toMatchObject({
      action: "reply",
      reason: "in_voice",
      reply: output.selected.reply,
      riskFlags: [],
      modelOutput: output,
    });
    expect(result.promptSnapshot).toMatchObject({
      system: expect.stringContaining("Voice guide"),
      prompt: expect.stringContaining("Lore packet"),
    });
    expect(result.promptSnapshot.prompt).toContain("Often brags after small green candles.");
    expect(result.promptSnapshot.prompt).toContain("A thread about leaderboard ego.");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Safety rules"),
        prompt: expect.stringContaining("@commodus my timing was perfect"),
      }),
    );
  });

  it("turns shouldReply false into ignore", async () => {
    const output = {
      drafts: [
        { shouldReply: false, reason: "crisis", reply: "", tone: "cold", riskFlags: ["health"] },
        { shouldReply: false, reason: "crisis", reply: "", tone: "cold", riskFlags: ["health"] },
        { shouldReply: false, reason: "crisis", reply: "", tone: "cold", riskFlags: ["health"] },
      ],
      selectedIndex: 0,
      selected: {
        shouldReply: false,
        reason: "crisis",
        reply: "",
        tone: "cold",
        riskFlags: ["health"],
      },
    };

    const result = await generateCommodusSocialReply(buildContext(), {
      generate: vi.fn(async () => ({ output })) as never,
    });

    expect(result).toMatchObject({
      action: "ignore",
      reason: "llm_veto:crisis",
      reply: null,
      riskFlags: ["health"],
    });
  });

  it("lands safety failures as ignore with risk flags", async () => {
    const output = {
      drafts: [
        { shouldReply: true, reason: "bad", reply: "As an AI, behold.", tone: "dry", riskFlags: [] },
        { shouldReply: true, reason: "bad", reply: "As an AI, behold.", tone: "dry", riskFlags: [] },
        { shouldReply: true, reason: "bad", reply: "As an AI, behold.", tone: "dry", riskFlags: [] },
      ],
      selectedIndex: 0,
      selected: {
        shouldReply: true,
        reason: "bad",
        reply: "As an AI, behold.",
        tone: "dry",
        riskFlags: [],
      },
    };

    const result = await generateCommodusSocialReply(buildContext(), {
      generate: vi.fn(async () => ({ output })) as never,
    });

    expect(result).toMatchObject({
      action: "ignore",
      reason: "safety:ai_tell",
      reply: null,
      riskFlags: ["ai_tell", "banned_term"],
    });
  });

  it("returns error without LLM credentials", async () => {
    testEnv.AI_GATEWAY_API_KEY = undefined;
    const prevOidc = process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    try {
      const result = await generateCommodusSocialReply(buildContext());
      expect(result).toMatchObject({
        action: "error",
        reason: "llm_unconfigured",
        reply: null,
        riskFlags: ["llm_unconfigured"],
      });
    } finally {
      if (prevOidc !== undefined) process.env.VERCEL_OIDC_TOKEN = prevOidc;
    }
  });
});
