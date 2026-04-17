import { FatalError } from "workflow";

/**
 * Payload forwarded from the Neynar `cast.created` webhook into the workflow.
 * Kept narrow on purpose: anything extra should be fetched lazily inside a
 * step so the event log stays small and serializable.
 */
export interface CommandContext {
  castHash: string;
  /** FID of the user who mentioned the bot. */
  authorFid: number;
  /** Raw cast text (what the user typed). */
  text: string;
  /** Optional parent cast hash if this is a reply. */
  parentHash: string | null;
}

export interface ParsedCommand {
  action: "swap" | "help" | "unknown";
  /** For swaps: `{ amount, fromToken, toToken }` on Base. */
  params: Record<string, string | number> | null;
}

export interface SwapResult {
  /** Tx hash of the executed swap on Base. */
  txHash: string;
  fromAmount: string;
  toAmount: string;
}

/**
 * Top-level workflow for a Commodus mention.
 *
 * Suspends between steps so each retry is independent and durable. If the
 * serverless handler dies mid-pipeline, Workflow resumes from the last
 * completed step on the next attempt.
 */
export async function handleCommodusCommand(ctx: CommandContext) {
  "use workflow";

  const parsed = await parseCommand(ctx.text);

  if (parsed.action === "unknown") {
    await publishReply(ctx.castHash, "I didn't catch that — try `help`.");
    return { status: "ignored" as const };
  }

  if (parsed.action === "help") {
    await publishReply(ctx.castHash, renderHelp());
    return { status: "helped" as const };
  }

  // action === "swap"
  const swap = await executeSwap(ctx.authorFid, parsed.params!);
  await publishReply(
    ctx.castHash,
    `Done. Swapped ${swap.fromAmount} → ${swap.toAmount}\nTx: ${swap.txHash}`,
  );

  return { status: "swapped" as const, txHash: swap.txHash };
}

async function parseCommand(text: string): Promise<ParsedCommand> {
  "use step";

  // TODO: replace with OpenAI Agents SDK call (see PRD § Command Parsing).
  // Thrown errors here are retried by default — good for transient OpenAI 5xx.
  // For permanently malformed input, return `action: "unknown"` rather than throw.
  void text;
  return { action: "unknown", params: null };
}

async function executeSwap(
  authorFid: number,
  params: Record<string, string | number>,
): Promise<SwapResult> {
  "use step";

  // TODO: wire up
  //  1. Resolve or create the user's Privy server-wallet by FID
  //  2. Quote via 0x Swap API on Base
  //  3. Sign + broadcast with viem + Privy signer
  //  4. Return tx hash + amounts
  //
  // Invalid-input failures (e.g. unknown token symbol) should throw FatalError
  // so they surface to the user instead of retrying 6x.
  void authorFid;
  void params;
  throw new FatalError("executeSwap not implemented");
}

async function publishReply(parentHash: string, text: string): Promise<void> {
  "use step";

  // TODO: call Neynar `/v2/farcaster/cast` with { parent: parentHash, text }.
  // Reply publishing is idempotent on Neynar's side per idem-key, so retries
  // are safe without additional dedupe.
  void parentHash;
  void text;
}

function renderHelp(): string {
  return [
    "Commodus commands:",
    "• `swap <amount> <tokenIn> for <tokenOut>`",
    "• `help`",
  ].join("\n");
}
