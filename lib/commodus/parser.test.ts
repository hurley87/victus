import { describe, expect, it } from "vitest";

import {
  ALLOWED_SYMBOL,
  MAX_USDC_AMOUNT,
  normalizeCommandText,
  parseCommand,
} from "./parser";

describe("normalizeCommandText", () => {
  it("lowercases, strips @handle, collapses whitespace", () => {
    expect(normalizeCommandText("  @Commo   BUY  5   USDC  of  AERO  ")).toBe(
      "buy 5 usdc of aero",
    );
  });

  it("is handle-agnostic (works with @commo, @commodus, or future handles)", () => {
    // Neynar's subscription filter routes the cast to us, so the handle
    // token can be anything; we strip it uniformly.
    expect(normalizeCommandText("@commo buy 5 usdc of aero")).toBe(
      "buy 5 usdc of aero",
    );
    expect(normalizeCommandText("@commodus buy 5 usdc of aero")).toBe(
      "buy 5 usdc of aero",
    );
  });

  it("strips multiple mentions anywhere in the text", () => {
    expect(normalizeCommandText("@commo buy 5 usdc of aero @someone")).toBe(
      "buy 5 usdc of aero",
    );
  });

  it("treats Unicode whitespace (NBSP, tab, newline) as whitespace", () => {
    const raw = "@commo\tbuy\u00a05\nusdc\u2003of aero";
    expect(normalizeCommandText(raw)).toBe("buy 5 usdc of aero");
  });
});

describe("parseCommand — happy path", () => {
  it("accepts a canonical command with the live @commo handle", () => {
    expect(parseCommand("@commo buy 5 usdc of aero")).toEqual({
      kind: "ok",
      action: "buy",
      symbol: ALLOWED_SYMBOL,
      amount: 5,
    });
  });

  it("accepts decimal amounts", () => {
    expect(parseCommand("@commo buy 2.5 usdc of aero")).toEqual({
      kind: "ok",
      action: "buy",
      symbol: ALLOWED_SYMBOL,
      amount: 2.5,
    });
  });

  it("accepts the exact cap (boundary = MAX_USDC_AMOUNT)", () => {
    expect(parseCommand(`@commo buy ${MAX_USDC_AMOUNT} usdc of aero`)).toMatchObject({
      kind: "ok",
      amount: MAX_USDC_AMOUNT,
    });
    expect(parseCommand(`@commo buy ${MAX_USDC_AMOUNT}.0 usdc of aero`)).toMatchObject({
      kind: "ok",
      amount: MAX_USDC_AMOUNT,
    });
  });

  it("is case-insensitive across the entire command", () => {
    expect(parseCommand("@Commo BUY 5 USDC OF AERO")).toMatchObject({
      kind: "ok",
      amount: 5,
    });
  });

  it("tolerates doubled and Unicode whitespace", () => {
    expect(parseCommand("  @commo   buy\t5\u00a0usdc\nof  aero  ")).toMatchObject({
      kind: "ok",
      amount: 5,
    });
  });

  it("accepts legacy and future handles (parser is handle-agnostic)", () => {
    expect(parseCommand("@commodus buy 5 usdc of aero")).toMatchObject({
      kind: "ok",
      amount: 5,
    });
  });
});

describe("parseCommand — grammar rejections", () => {
  it("rejects an empty string", () => {
    expect(parseCommand("")).toEqual({ kind: "grammar_error" });
  });

  it("rejects plain chatter", () => {
    expect(parseCommand("@commo hello there")).toEqual({
      kind: "grammar_error",
    });
  });

  it("rejects $-prefixed amounts (the first real-cast failure mode)", () => {
    expect(parseCommand("@commo buy $10 of aero")).toEqual({
      kind: "grammar_error",
    });
  });

  it("rejects missing 'usdc' token", () => {
    expect(parseCommand("@commo buy 5 of aero")).toEqual({
      kind: "grammar_error",
    });
  });

  it("rejects missing 'of' token", () => {
    expect(parseCommand("@commo buy 5 usdc aero")).toEqual({
      kind: "grammar_error",
    });
  });

  it("rejects a negative amount", () => {
    expect(parseCommand("@commo buy -5 usdc of aero")).toEqual({
      kind: "grammar_error",
    });
  });

  it("rejects a zero amount", () => {
    expect(parseCommand("@commo buy 0 usdc of aero")).toEqual({
      kind: "grammar_error",
    });
    expect(parseCommand("@commo buy 0.0 usdc of aero")).toEqual({
      kind: "grammar_error",
    });
  });

  it("rejects a non-numeric amount", () => {
    expect(parseCommand("@commo buy abc usdc of aero")).toEqual({
      kind: "grammar_error",
    });
  });

  it("rejects sell and status verbs at the regex layer (handled by the LLM fallback in #9)", () => {
    // Stage 1 is a strict AERO-buy regex; sell and status verbs miss
    // the pattern here and are routed to `parseCommandIntent`'s LLM
    // fallback. See `lib/execution/parse.ts` + `llm-parse.ts`.
    expect(parseCommand("@commo sell 100% of aero")).toEqual({
      kind: "grammar_error",
    });
    expect(parseCommand("@commo status")).toEqual({ kind: "grammar_error" });
  });

  it("rejects multi-command casts (no trailing content allowed)", () => {
    expect(
      parseCommand("@commo buy 5 usdc of aero; buy 3 usdc of aero"),
    ).toEqual({ kind: "grammar_error" });
  });
});

describe("parseCommand — asset rejections", () => {
  it("rejects a structurally-valid command with a non-AERO symbol", () => {
    expect(parseCommand("@commo buy 5 usdc of weth")).toEqual({
      kind: "asset_error",
      action: "buy",
      attemptedSymbol: "WETH",
      amount: 5,
    });
  });

  it("prefers asset rejection over oversize when both apply", () => {
    // We rank structural/whitelist failures above policy failures so users
    // aren't told "too big" about an asset we wouldn't honor at any size.
    expect(parseCommand("@commo buy 100 usdc of weth")).toMatchObject({
      kind: "asset_error",
      attemptedSymbol: "WETH",
    });
  });
});

describe("parseCommand — oversize rejections", () => {
  it("rejects amounts just over the cap", () => {
    expect(parseCommand("@commo buy 11 usdc of aero")).toEqual({
      kind: "oversize_error",
      action: "buy",
      symbol: ALLOWED_SYMBOL,
      amount: 11,
    });
    expect(parseCommand("@commo buy 10.01 usdc of aero")).toMatchObject({
      kind: "oversize_error",
      amount: 10.01,
    });
  });
});
