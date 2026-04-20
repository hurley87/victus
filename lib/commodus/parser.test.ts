import { describe, expect, it } from "vitest";

import { MAX_USDC_AMOUNT, normalizeCommandText, parseCommand } from "./parser";

describe("normalizeCommandText", () => {
  it("lowercases, strips @handle, collapses whitespace", () => {
    expect(normalizeCommandText("  @Commo   BUY  5   USDC  of  AERO  ")).toBe(
      "buy 5 usdc of aero",
    );
  });

  it("is handle-agnostic (works with @commo, @commodus, or future handles)", () => {
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
      symbol: "AERO",
      amount: 5,
    });
  });

  it("accepts any conventional ticker symbol (whitelist is async)", () => {
    expect(parseCommand("@commo buy 5 usdc of degen")).toEqual({
      kind: "ok",
      action: "buy",
      symbol: "DEGEN",
      amount: 5,
    });
  });

  it("accepts decimal amounts", () => {
    expect(parseCommand("@commo buy 2.5 usdc of aero")).toEqual({
      kind: "ok",
      action: "buy",
      symbol: "AERO",
      amount: 2.5,
    });
  });

  it("accepts amounts above the default policy cap (policy enforces later)", () => {
    expect(parseCommand(`@commo buy ${MAX_USDC_AMOUNT + 1} usdc of aero`)).toEqual({
      kind: "ok",
      action: "buy",
      symbol: "AERO",
      amount: MAX_USDC_AMOUNT + 1,
    });
  });

  it("is case-insensitive across the entire command", () => {
    expect(parseCommand("@Commo BUY 5 USDC OF AERO")).toMatchObject({
      kind: "ok",
      amount: 5,
      symbol: "AERO",
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

  it("rejects sell and status verbs at the regex layer (handled by the LLM fallback)", () => {
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
