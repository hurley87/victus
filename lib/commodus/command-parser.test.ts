import { describe, expect, it, vi } from "vitest";

import type { generateText } from "ai";

import { parseCommandIntent } from "@/lib/execution/parse";

/**
 * End-to-end coverage of the Stage 2 LLM fallback wired through
 * `parseCommandIntent`. The regex pre-filter is exercised by
 * `lib/commodus/parser.test.ts`; this file only exercises inputs the
 * regex does not match, so every test here flows through the injected
 * fake `generateText`.
 *
 * We swap the LLM dependency via the `opts.llm.generate` injection
 * seam exposed by `parseCommandIntent` — no live gateway call is
 * made. The fake returns a minimal `{ output }` object that matches
 * the subset of the AI SDK v6 `generateText` result contract the
 * parser consumes.
 */

type GenerateText = typeof generateText;
type FakeResult = Awaited<ReturnType<GenerateText>>;

/**
 * Tiny helper that builds a `generateText` stand-in returning a
 * scripted sequence of intents (or errors). Each non-error value is
 * wrapped in the `{ intent: ... }` envelope the parser expects — this
 * matches the OpenAI structured-output contract (schemas must be root
 * `type: "object"`, so the discriminated union is nested under
 * `intent`). Keeps the test surface focused on behavior, not on
 * re-casting the SDK's full result shape.
 */
function makeFakeLlm(
  sequence: ReadonlyArray<unknown | Error>,
): { generate: GenerateText; callCount: () => number } {
  let calls = 0;
  const generate = (async () => {
    const value = sequence[calls] ?? sequence[sequence.length - 1];
    calls += 1;
    if (value instanceof Error) throw value;
    return { output: { intent: value } } as FakeResult;
  }) as unknown as GenerateText;
  return { generate, callCount: () => calls };
}

describe("parseCommandIntent — LLM fallback (happy paths)", () => {
  it("parses a casual buy phrasing the regex can't handle", async () => {
    const { generate, callCount } = makeFakeLlm([
      {
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 2,
      },
    ]);

    const outcome = await parseCommandIntent(
      "@commodus grab 2 usdc worth of aero",
      { llm: { generate, maxRetries: 0 } },
    );

    expect(outcome).toEqual({
      ok: true,
      intent: {
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 2,
      },
    });
    expect(callCount()).toBe(1);
  });

  it("parses a casual sell phrasing with an implied percent", async () => {
    const { generate } = makeFakeLlm([
      {
        action: "sell",
        symbol: "AERO",
        amount_type: "percent_out",
        amount_value: 50,
      },
    ]);

    const outcome = await parseCommandIntent("@commodus sell half my aero", {
      llm: { generate, maxRetries: 0 },
    });

    expect(outcome).toEqual({
      ok: true,
      intent: {
        action: "sell",
        symbol: "AERO",
        amount_type: "percent_out",
        amount_value: 50,
      },
    });
  });

  it("parses a casual status phrasing", async () => {
    const { generate } = makeFakeLlm([{ action: "status" }]);

    const outcome = await parseCommandIntent("@commodus what's my rank", {
      llm: { generate, maxRetries: 0 },
    });

    expect(outcome).toEqual({ ok: true, intent: { action: "status" } });
  });
});

describe("parseCommandIntent — retry-once, then hard-fail", () => {
  it("retries once on a schema-invalid LLM response, then rejects as grammar", async () => {
    // Two invalid payloads — retry budget of 1 is exhausted, and the
    // parser surfaces `grammar_error` so the workflow publishes the
    // templated Commodus Voice rejection.
    const { generate, callCount } = makeFakeLlm([
      { action: "buy" /* missing required fields */ },
      { action: "buy" /* still missing */ },
    ]);

    const outcome = await parseCommandIntent("@commodus do something weird", {
      llm: { generate, maxRetries: 1 },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "grammar_error" });
    expect(callCount()).toBe(2);
  });

  it("retries once on a provider error, then rejects as grammar", async () => {
    const { generate, callCount } = makeFakeLlm([
      new Error("gateway 503"),
      new Error("gateway 503"),
    ]);

    const outcome = await parseCommandIntent(
      "@commodus gibberish that won't parse",
      { llm: { generate, maxRetries: 1 } },
    );

    expect(outcome).toMatchObject({ ok: false, reason: "grammar_error" });
    expect(callCount()).toBe(2);
  });

  it("treats an explicit `invalid` LLM response as a retry-then-grammar failure", async () => {
    const { generate, callCount } = makeFakeLlm([
      { action: "invalid" },
      { action: "invalid" },
    ]);

    const outcome = await parseCommandIntent("@commodus gm", {
      llm: { generate, maxRetries: 1 },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "grammar_error" });
    expect(callCount()).toBe(2);
  });

  it("accepts the second attempt when the first response was malformed", async () => {
    const { generate, callCount } = makeFakeLlm([
      { action: "invalid" },
      {
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 3,
      },
    ]);

    const outcome = await parseCommandIntent(
      "@commodus put 3 usdc into aero",
      { llm: { generate, maxRetries: 1 } },
    );

    expect(outcome).toMatchObject({
      ok: true,
      intent: { action: "buy", symbol: "AERO", amount_value: 3 },
    });
    expect(callCount()).toBe(2);
  });
});

describe("parseCommandIntent — regex precedence", () => {
  it("never invokes the LLM on the canonical AERO-buy regex happy path", async () => {
    const generate = vi.fn() as unknown as GenerateText;

    const outcome = await parseCommandIntent("@commodus buy 5 usdc of aero", {
      llm: { generate, maxRetries: 1 },
    });

    expect(outcome).toEqual({
      ok: true,
      intent: {
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 5,
      },
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("short-circuits on asset_error without an LLM call", async () => {
    const generate = vi.fn() as unknown as GenerateText;

    const outcome = await parseCommandIntent("@commodus buy 5 usdc of weth", {
      llm: { generate, maxRetries: 1 },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "asset_error" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("short-circuits on oversize_error without an LLM call", async () => {
    const generate = vi.fn() as unknown as GenerateText;

    const outcome = await parseCommandIntent(
      "@commodus buy 100 usdc of aero",
      { llm: { generate, maxRetries: 1 } },
    );

    expect(outcome).toMatchObject({ ok: false, reason: "oversize_error" });
    expect(generate).not.toHaveBeenCalled();
  });
});
