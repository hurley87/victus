/**
 * Smoke test for `lib/execution/parse.ts` against the live Vercel AI
 * Gateway.
 *
 * Exercises:
 *   1. Regex pre-filter paths (buy/asset/oversize) that must NOT call
 *      the gateway. Verifies the cheap path stays cheap.
 *   2. LLM fallback paths (casual buy/sell/status phrasings +
 *      unparseable chatter) that route through the gateway.
 *
 * Usage:
 *   AI_GATEWAY_API_KEY=... pnpm tsx scripts/smoke-parse.ts
 *   pnpm tsx scripts/smoke-parse.ts --model openai/gpt-5.4-nano
 *   pnpm tsx scripts/smoke-parse.ts --only-llm           # skip regex cases
 *
 * Exits non-zero on any unexpected result so it's safe to wire into
 * a pre-deploy check if we ever want ongoing regression coverage.
 */

import { generateText } from "ai";

import { parseCommandIntent } from "../lib/execution/parse";

type Expected =
  | { kind: "ok"; action: "buy" | "sell" | "status" }
  | { kind: "reject"; reason: "grammar_error" | "asset_error" | "oversize_error" };

type Case = {
  label: string;
  text: string;
  path: "regex" | "llm";
  expect: Expected;
};

const CASES: ReadonlyArray<Case> = [
  // ── Stage 1: regex pre-filter (must not call the gateway) ──────────
  {
    label: "canonical AERO buy",
    text: "@commodus buy 5 usdc of aero",
    path: "regex",
    expect: { kind: "ok", action: "buy" },
  },
  {
    label: "AERO buy with decimals",
    text: "@commodus buy 2.5 usdc of aero",
    path: "regex",
    expect: { kind: "ok", action: "buy" },
  },
  {
    label: "structurally valid non-AERO buy (asset_error)",
    text: "@commodus buy 5 usdc of weth",
    path: "regex",
    expect: { kind: "reject", reason: "asset_error" },
  },
  {
    label: "oversize AERO buy (oversize_error)",
    text: "@commodus buy 100 usdc of aero",
    path: "regex",
    expect: { kind: "reject", reason: "oversize_error" },
  },
  // ── Stage 2: LLM fallback (live gateway call) ──────────────────────
  {
    label: "casual buy — 'grab N usdc worth of'",
    text: "@commodus grab 2 usdc worth of aero",
    path: "llm",
    expect: { kind: "ok", action: "buy" },
  },
  {
    label: "casual sell — 'half my'",
    text: "@commodus sell half my aero",
    path: "llm",
    expect: { kind: "ok", action: "sell" },
  },
  {
    label: "casual sell — 'half of' (no possessive)",
    text: "@commodus sell half of aero",
    path: "llm",
    expect: { kind: "ok", action: "sell" },
  },
  {
    label: "casual sell — 'N% of my'",
    text: "@commodus sell 25% of my aero",
    path: "llm",
    expect: { kind: "ok", action: "sell" },
  },
  {
    label: "casual sell — 'dump all my'",
    text: "@commodus dump all my aero",
    path: "llm",
    expect: { kind: "ok", action: "sell" },
  },
  {
    label: "status — canonical",
    text: "@commodus status",
    path: "llm",
    expect: { kind: "ok", action: "status" },
  },
  {
    label: "status — 'what's my rank?'",
    text: "@commodus what's my rank?",
    path: "llm",
    expect: { kind: "ok", action: "status" },
  },
  {
    label: "non-command chatter (grammar rejection)",
    text: "@commodus gm",
    path: "llm",
    expect: { kind: "reject", reason: "grammar_error" },
  },
  {
    label: "non-command chatter — plain greeting",
    text: "hello commodus, how are you today",
    path: "llm",
    expect: { kind: "reject", reason: "grammar_error" },
  },
];

function parseArgs(argv: ReadonlyArray<string>): {
  model: string | undefined;
  onlyLlm: boolean;
} {
  let model: string | undefined;
  let onlyLlm = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--model") model = argv[++i];
    else if (arg.startsWith("--model=")) model = arg.slice("--model=".length);
    else if (arg === "--only-llm") onlyLlm = true;
  }
  return { model, onlyLlm };
}

async function main(): Promise<void> {
  const { model, onlyLlm } = parseArgs(process.argv.slice(2));

  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    console.warn(
      "⚠  Neither AI_GATEWAY_API_KEY nor VERCEL_OIDC_TOKEN is set. LLM-fallback cases will hard-fail to grammar rejections — that's a config issue, not a regression.",
    );
  }

  const cases = onlyLlm ? CASES.filter((c) => c.path === "llm") : CASES;

  // Count gateway calls so we can prove the regex path stays off the
  // wire. Wrap `generateText` once and inject it into every case.
  let gatewayCalls = 0;
  const wrappedGenerate: typeof generateText = (async (
    args: Parameters<typeof generateText>[0],
  ) => {
    gatewayCalls += 1;
    return generateText(args);
  }) as typeof generateText;

  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    const callsBefore = gatewayCalls;
    const started = performance.now();
    const outcome = await parseCommandIntent(c.text, {
      llm: { generate: wrappedGenerate, ...(model ? { model } : {}) },
    });
    const elapsedMs = Math.round(performance.now() - started);
    const callsAfter = gatewayCalls;
    const calledGateway = callsAfter > callsBefore;

    const ok = matchesExpectation(outcome, c.expect);
    const pathOk = calledGateway === (c.path === "llm");
    const pass = ok && pathOk;

    passed += pass ? 1 : 0;
    failed += pass ? 0 : 1;

    const status = pass ? "✓" : "✗";
    const pathTag = calledGateway ? "llm" : "regex";
    console.log(
      `${status} [${pathTag.padEnd(5)} ${String(elapsedMs).padStart(4)}ms] ${c.label}`,
    );
    console.log(`    in : ${JSON.stringify(c.text)}`);
    console.log(`    out: ${JSON.stringify(outcome)}`);
    if (!ok) {
      console.log(`    expected: ${JSON.stringify(c.expect)}`);
    }
    if (!pathOk) {
      console.log(
        `    expected path: ${c.path} (gateway calls ${callsBefore} → ${callsAfter})`,
      );
    }
  }

  console.log(
    `\n${passed} passed, ${failed} failed. Gateway calls total: ${gatewayCalls}.`,
  );

  if (failed > 0) process.exit(1);
}

function matchesExpectation(
  outcome: Awaited<ReturnType<typeof parseCommandIntent>>,
  expect: Expected,
): boolean {
  if (expect.kind === "ok") {
    return outcome.ok && outcome.intent.action === expect.action;
  }
  return !outcome.ok && outcome.reason === expect.reason;
}

main().catch((err) => {
  console.error("smoke-parse failed:", err);
  process.exit(1);
});
