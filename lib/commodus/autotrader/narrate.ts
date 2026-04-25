import "server-only";

import { Output, generateText } from "ai";
import { z } from "zod";

import { DEFAULT_COMMAND_PARSER_MODEL } from "@/lib/execution/llm-parse";
import { env } from "@/lib/env";

import type { CommodusAnalysisForNarration } from "./types";

const NarrationSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(280),
});

const FORBIDDEN_ADVICE =
  /\b(you should|you must|buy now|sell now|i recommend|financial advice|not financial advice|nfa|this is a signal)\b/giu;

const SYSTEM_PROMPT = `You are Commodus, an internet-native Roman emperor: modern, sharp, arrogant, funny, a little menacing, never corny. You speak in the first person as Commodus only.

The user message is a JSON object of facts. You must write 1-2 very short Farcaster posts (one combined block under 280 characters) in Commodus's voice. Summarize the deterministic story only — do not invent a different token, different trade size, or a different action than the JSON says.

Rules:
- No financial advice to the reader. No "you should buy" or "not financial advice" disclaimers. No "this is a signal" language.
- Do not add ticker symbols that are not in the JSON. Use $SYMBOL style only for symbols the JSON already names.
- If the action was hold or a failed trade, stay theatrical but accurate to the reason field.
- English only.`;

/**
 * Commodus first-person line when the LLM is unavailable or returns bad output.
 */
export function fallbackNarration(analysis: CommodusAnalysisForNarration): string {
  const d = analysis.decision;
  if (analysis.kind === "hold" || d.action === "hold") {
    if (analysis.policyRejection) {
      return `I did not take a trade today. The rules told me to stand down: ${analysis.policyRejection}. The crowd is loud; I am not here to break my own game.`;
    }
    if (d.action === "hold") {
      return `I am leaving the wallet alone today. The feed was more soap opera than edge. An emperor does not pay gas to entertain strangers.`;
    }
  }
  if (analysis.kind === "hold_failed") {
    return `I tried a move, and the chain had opinions. I will be back; Rome still bills by the second.`;
  }
  if (analysis.fill) {
    const { action, symbol, notionalUsdc, txHash } = analysis.fill;
    const a = action === "buy" ? "nibbled" : "shaved";
    return `I ${a} on $${symbol} — ${notionalUsdc.toFixed(2)} USDC notional, receipt on-chain. I play on the same scoreboard you do, just louder. — basescan.org/tx/${txHash.slice(0, 10)}…`;
  }
  return "The arena ran its clock; I am still the one holding the gavel. More soon.";
}

function sanitizeLlmText(text: string): string {
  return text.replace(FORBIDDEN_ADVICE, "").replace(/\s+/g, " ").trim().slice(0, 320);
}

function looksLikeAdvice(text: string): boolean {
  return FORBIDDEN_ADVICE.test(text);
}

/**
 * Code passes fully structured, finalized analysis; the model only writes flavor.
 * Does not use env if gateway handles auth on Vercel; model string matches the parser.
 */
export async function narrateCommodusOutcome(
  analysis: CommodusAnalysisForNarration,
  opts: { model?: string; generate?: typeof generateText } = {},
): Promise<string> {
  if (!env.OPENAI_API_KEY && !env.AI_GATEWAY_API_KEY) {
    return fallbackNarration(analysis);
  }

  const model = opts.model ?? DEFAULT_COMMAND_PARSER_MODEL;
  const generate = opts.generate ?? generateText;
  const payload = {
    kind: analysis.kind,
    slotKey: analysis.slotKey,
    slotDate: analysis.slotDate,
    trace: analysis.trace,
    policyRejection: analysis.policyRejection ?? null,
    decision: analysis.decision,
    fill: analysis.fill ?? null,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generate({
        model,
        output: Output.object({ schema: NarrationSchema }),
        system: SYSTEM_PROMPT,
        prompt: `Facts (JSON, authoritative — do not contradict):\n${JSON.stringify(payload, null, 2)}`,
      });
      const parsed = NarrationSchema.safeParse(result.output);
      if (!parsed.success) continue;
      let out = sanitizeLlmText(parsed.data.text);
      if (out.length > 280) {
        out = out.slice(0, 277) + "…";
      }
      if (out.length < 1 || looksLikeAdvice(out)) {
        continue;
      }
      return out;
    } catch {
      // retry once
    }
  }

  return fallbackNarration(analysis);
}
