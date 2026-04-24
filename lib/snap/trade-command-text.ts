import { COMMAND_BOT_HANDLE } from "@/lib/commodus/bot";

export type TradeCommandInputs = {
  /** Allowed uppercase symbols (already filtered + size-bounded by the caller). */
  allowedSymbols: string[];
  /** Hard ceiling on buy amount (USDC) enforced by arena policy. */
  maxBuyUsdc: number;
};

export type TradeCommandFormValues = {
  action?: unknown;
  symbol?: unknown;
  amount?: unknown;
};

export type TradeCommandInterpolationResult =
  | { ok: true; castText: string }
  | { ok: false; error: string };

function normalizeSide(value: unknown): "buy" | "sell" | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "buy" || v === "sell") return v;
  return null;
}

function normalizeSymbol(value: unknown, allowed: string[]): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return allowed.includes(v) ? v : null;
}

function normalizeAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure helper: interpolate validated form inputs into a Victus trade command
 * of the shape `@commo buy 5 usdc of aero` or `@commo sell 50% of aero`.
 *
 * Keeps the string surface identical to `lib/commodus/parser.ts` grammar so
 * the downstream pipeline doesn't need to special-case snap-originated casts.
 */
export function interpolateTradeCommand(
  inputs: TradeCommandFormValues,
  constraints: TradeCommandInputs,
): TradeCommandInterpolationResult {
  const side = normalizeSide(inputs.action);
  if (!side) {
    return { ok: false, error: "Pick Buy or Sell to continue." };
  }

  const symbol = normalizeSymbol(inputs.symbol, constraints.allowedSymbols);
  if (!symbol) {
    return { ok: false, error: "Pick a token from the whitelist." };
  }

  const amount = normalizeAmount(inputs.amount);
  if (amount == null || amount <= 0) {
    return { ok: false, error: "Enter an amount greater than 0." };
  }

  const token = symbol.toLowerCase();

  if (side === "buy") {
    if (amount > constraints.maxBuyUsdc) {
      return { ok: false, error: `Max buy is ${constraints.maxBuyUsdc} USDC.` };
    }
    return {
      ok: true,
      castText: `${COMMAND_BOT_HANDLE} buy ${amount} usdc of ${token}`,
    };
  }

  if (amount > 100) {
    return { ok: false, error: "Sell percent must be between 1 and 100." };
  }
  return {
    ok: true,
    castText: `${COMMAND_BOT_HANDLE} sell ${amount}% of ${token}`,
  };
}
