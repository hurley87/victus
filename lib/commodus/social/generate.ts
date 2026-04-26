import "server-only";

import { Output, generateText } from "ai";
import { z } from "zod";

import { isAiGatewayConfigured } from "@/lib/ai/is-gateway-configured";
import { DEFAULT_COMMAND_PARSER_MODEL } from "@/lib/execution/llm-parse";
import type { Json } from "@/lib/supabase/types";

import type { CommodusSocialContext } from "./context";

const MAX_REPLY_CHARS = 320;
const MAX_HASHTAGS = 1;

const BANNED_TERMS = [
  "thy",
  "thou",
  "thee",
  "hark",
  "behold",
  "verily",
  "citizens",
  "morrow",
  "the sands reject",
  "by jupiter",
] as const;

const AI_TELL_PATTERNS = [
  /\bas an ai\b/i,
  /\bas a language model\b/i,
  /\bi'?m just a bot\b/i,
  /\bi am an ai\b/i,
  /\bi cannot\b/i,
  /\bi'?m not able to\b/i,
  /\bi don'?t have feelings\b/i,
];

const FINANCIAL_ADVICE_PATTERN =
  /\b(you should|you must|buy|sell|long|short|ape|exit|hold)\b[^.!?]{0,80}\$?[A-Z]{2,10}\b/u;

const DraftSchema = z.object({
  shouldReply: z.boolean(),
  reason: z.string().min(1),
  reply: z.string().default(""),
  tone: z.string().min(1).default("dry"),
  riskFlags: z.array(z.string()).default([]),
});

const SocialGenerationSchema = z.object({
  drafts: z.array(DraftSchema).length(3),
  selectedIndex: z.number().int().min(0).max(2),
  selected: DraftSchema,
});

export type SocialGenerationModelOutput = z.infer<typeof SocialGenerationSchema>;

export type SocialGenerationResult = {
  action: "reply" | "ignore" | "error";
  reason: string;
  reply: string | null;
  riskFlags: string[];
  promptSnapshot: SocialPromptSnapshot;
  modelOutput: Json;
};

export type GenerateCommodusSocialReplyOptions = {
  model?: string;
  generate?: typeof generateText;
};

export type SocialPromptSnapshot = {
  system: string;
  prompt: string;
};

export async function generateCommodusSocialReply(
  context: CommodusSocialContext,
  opts: GenerateCommodusSocialReplyOptions = {},
): Promise<SocialGenerationResult> {
  const promptSnapshot = buildPromptSnapshot(context);

  if (!isAiGatewayConfigured()) {
    return {
      action: "error",
      reason: "llm_unconfigured",
      reply: null,
      riskFlags: ["llm_unconfigured"],
      promptSnapshot,
      modelOutput: {},
    };
  }

  const model = opts.model ?? DEFAULT_COMMAND_PARSER_MODEL;
  const generate = opts.generate ?? generateText;

  try {
    const result = await generate({
      model,
      output: Output.object({ schema: SocialGenerationSchema }),
      system: promptSnapshot.system,
      prompt: promptSnapshot.prompt,
    });

    const parsed = SocialGenerationSchema.safeParse(result.output);
    if (!parsed.success) {
      return {
        action: "error",
        reason: "model_schema_invalid",
        reply: null,
        riskFlags: ["model_schema_invalid"],
        promptSnapshot,
        modelOutput: result.output as Json,
      };
    }

    const output = parsed.data;
    const selected = output.selected;
    const modelOutput = output as unknown as Json;

    if (!selected.shouldReply) {
      return {
        action: "ignore",
        reason: `llm_veto:${selected.reason}`,
        reply: null,
        riskFlags: dedupeRiskFlags(selected.riskFlags),
        promptSnapshot,
        modelOutput,
      };
    }

    const safety = evaluateCommodusSocialDraft(selected.reply, selected.riskFlags);
    if (!safety.ok) {
      return {
        action: "ignore",
        reason: `safety:${safety.riskFlags[0] ?? "rejected"}`,
        reply: null,
        riskFlags: safety.riskFlags,
        promptSnapshot,
        modelOutput,
      };
    }

    return {
      action: "reply",
      reason: selected.reason,
      reply: selected.reply.trim(),
      riskFlags: [],
      promptSnapshot,
      modelOutput,
    };
  } catch (err) {
    return {
      action: "error",
      reason: "llm_error",
      reply: null,
      riskFlags: ["llm_error"],
      promptSnapshot,
      modelOutput: {
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function evaluateCommodusSocialDraft(
  reply: string,
  modelRiskFlags: string[] = [],
): { ok: true; riskFlags: [] } | { ok: false; riskFlags: string[] } {
  const riskFlags = [...modelRiskFlags.filter(Boolean)];
  const text = reply.trim();
  const lower = text.toLowerCase();

  if (!text) riskFlags.push("empty_reply");
  if (text.length > MAX_REPLY_CHARS) riskFlags.push("length_over_320");
  if ((text.match(/#/g) ?? []).length > MAX_HASHTAGS) riskFlags.push("hashtag_overuse");
  if (AI_TELL_PATTERNS.some((pattern) => pattern.test(text))) riskFlags.push("ai_tell");
  if (BANNED_TERMS.some((term) => lower.includes(term))) riskFlags.push("banned_term");
  if (FINANCIAL_ADVICE_PATTERN.test(text)) riskFlags.push("financial_advice");

  const sentenceCount = (text.match(/[.!?]+(?=\s|$)/g) ?? []).length;
  if (sentenceCount > 3) riskFlags.push("too_many_sentences");

  const deduped = dedupeRiskFlags(riskFlags);
  return deduped.length === 0
    ? { ok: true, riskFlags: [] }
    : { ok: false, riskFlags: deduped };
}

function buildPromptSnapshot(context: CommodusSocialContext): SocialPromptSnapshot {
  const system = [
    context.docs.voice,
    "",
    "Hard safety rules:",
    context.docs.safety,
  ].join("\n");

  const promptPayload = {
    task: "Return exactly 3 candidate replies and self-judge the selected candidate. Use the selected object for the final decision.",
    outputContract: {
      drafts: "exactly 3 objects shaped { shouldReply, reason, reply, tone, riskFlags }",
      selectedIndex: "0, 1, or 2",
      selected: "{ shouldReply, reason, reply, tone, riskFlags }",
    },
    constraints: [
      "If safety rules suggest skipping, selected.shouldReply must be false and riskFlags must explain why.",
      "Replies must be first-person Commodus, 1-3 sentences, <= 320 chars.",
      "Do not use hashtags, AI tells, fake ancient diction, slurs, threats, explicit sexual content, or financial advice.",
      "Do not ask follow-up questions unless the question is itself the punchline.",
    ],
    lore: context.docs.lore,
    triggerCast: context.triggerCast,
    threadMessages: context.threadMessages,
    authorMemory: context.authorMemory,
    threadMemory: context.threadMemory,
    recentSelfPosts: context.recentSelfPosts,
  };

  return {
    system,
    prompt: `Context JSON:\n${JSON.stringify(promptPayload, null, 2)}`,
  };
}

function dedupeRiskFlags(flags: string[]): string[] {
  return Array.from(new Set(flags.map((flag) => flag.trim()).filter(Boolean)));
}
