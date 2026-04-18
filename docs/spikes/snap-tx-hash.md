# Spike: Farcaster Snap → `tx_hash` Capture Path

## Why this spike exists

Issue [#7](https://github.com/hurley87/victus/issues/7) pivoted the execution surface to a pure Farcaster Snap emitting `swap_token({ sellToken, buyToken })` inline in the intent reply cast. The one genuinely unvalidated assumption in the MVP is **how the signed `tx_hash` flows from the user's wallet back to our server** after `swap_token` resolves.

Every downstream issue inherits this answer:

- [#7](https://github.com/hurley87/victus/issues/7) — acceptance criterion "End-to-end: a real cast produces a real AERO balance"
- [#8](https://github.com/hurley87/victus/issues/8) — Phase 2 trigger (`POST /api/executions/confirm`) assumes a `tx_hash` arrives reliably
- [#12](https://github.com/hurley87/victus/issues/12) — score-time enforcement runs against that tx hash
- [#16](https://github.com/hurley87/victus/issues/16) — demo script depends on an observably tight loop

Lock the answer **before** merging any Phase-2 work.

---

## Goal

Stand up a minimal `POST /snaps/arena/[cast_hash]` endpoint that:

1. Returns a valid Farcaster `SnapResponse` with a `swap_token` action pinned to a hard-coded pair (USDC → AERO on Base).
2. Instruments **all three candidate capture paths** so a real swap in a real Farcaster client surfaces telemetry showing which (if any) of them fire.

Output: a single-paragraph decision in the spike report plus a PR that lands the chosen mechanism as the real thing.

---

## Day-one task: ground on the real Snap docs

Before touching code, read and summarize:

- `https://docs.farcaster.xyz/snap/llms.txt` (fetch via Read/WebFetch)
- Any linked sub-docs covering: `SnapResponse` schema, `swap_token` action shape, JFS envelope format, client → snap re-entry semantics, action result callbacks.

**Capture in the spike report:**

- Exact JSON shape of `SnapResponse`
- Exact JSON shape of the `swap_token` action (all supported fields; does it accept `chainId`, `callbackUrl`, any result routing?)
- Exact JFS envelope fields and signature algorithm
- Any mention of post-action callbacks or tx-hash delivery in the protocol (this is the whole question — if the docs answer it directly, the spike shortens dramatically)

If the docs already specify a standard tx-hash callback, the spike collapses to "implement the documented path + a belt-and-suspenders onchain listener." If not, proceed to the three-path instrumentation below.

---

## Repo conventions to follow

Look at the existing routes to stay in house style; do not invent new patterns:

- `app/api/arena/address/route.ts` — request validation with Zod, explicit named error classes, `NextResponse.json` with status codes
- `app/api/webhooks/neynar/route.ts` — raw-body read → HMAC verify → Zod parse → rate-limit → Redis dedupe → Supabase insert → fire-and-forget `workflow/api` `start()`
- `lib/supabase/server.ts` — use `supabaseAdmin` for server-only writes
- `lib/env.ts` — add any new env vars here (typed)
- `lib/redis.ts` — reuse `ratelimit` + `wasProcessed` helpers for idempotency
- `lib/workflows/commodus-command.ts` — the existing Phase 1 workflow; the snap-embed intent reply step plugs in here

The Phase 1 workflow already exists. The spike's snap endpoint is the **target** of the intent reply cast's embed URL, not a new ingestion path.

---

## Three capture paths to instrument

### Path 1 — Snap re-entry

**Hypothesis:** After `swap_token` resolves in the user's wallet, the Farcaster client POSTs the same snap endpoint again with an envelope containing the resulting `tx_hash` (and possibly a pre-swap vs. post-swap `state` discriminator).

**Instrumentation:**

- Every snap POST logs (via `console.info` to Axiom once wired, or `console.log` for the spike): `{ phase: 'snap_post', cast_hash, fid, envelope_keys: Object.keys(body), has_tx_hash: ... }`
- If any re-entry carries a tx-hash-shaped field, log the full (redacted) envelope once and note the field path in the report.
- Add a `cast_commands.last_snap_post_at` timestamp column (scratch, via a throwaway migration under `supabase/migrations/` only if needed for the spike; otherwise an in-memory Map keyed by `cast_hash`).

**Decision rule:** if a re-entry reliably delivers `tx_hash` within ~30s of the user signing, Path 1 wins.

### Path 2 — Action result callback URL

**Hypothesis:** The `swap_token` action supports a `callbackUrl` (or equivalent) field on the action body that the client POSTs to with `{ tx_hash }` after the swap signs/confirms.

**Instrumentation:**

- Scan the Snap docs specifically for this field. If it exists, include it in the emitted `swap_token` action pointing at `POST /snaps/arena/[cast_hash]/tx-result`.
- Implement `app/api/snaps/arena/[cast_hash]/tx-result/route.ts` as the target. Same verification posture as the parent endpoint (verify JFS envelope).
- Log every callback invocation with the same `phase: 'tx_result_callback'` shape as Path 1.

**Decision rule:** if the field exists and the client actually posts to it, Path 2 wins — it's the cleanest option.

### Path 3 — Onchain listener (safety net)

**Hypothesis:** Neither re-entry nor callback is available / reliable. Fall back to a viem listener keyed to the user's arena address watching for `Swap` events on whitelisted pools on Base, correlated back to the `awaiting_swap` cast inside a time window.

**Instrumentation:**

- Stand up a throwaway cron / interval (or a Workflow step) that, for every `cast_commands` row with `status='awaiting_swap'` aged ≤ 15 min, queries Base for `Swap` logs from the arena address between `awaiting_swap_at` and `now()`.
- Log matches with `phase: 'onchain_detected'`.
- This path **always works** as a fallback — the point of instrumenting it is to measure typical detection latency (target: < 30s after confirmation) and make sure it doesn't collide with Paths 1/2 if they also fire.

**Decision rule:** Path 3 is the floor. Worst-case, it ships as the real mechanism; best-case, it runs as a belt-and-suspenders redundancy layer behind whichever of 1/2 wins.

---

## Minimal route layout

```
app/api/snaps/arena/[cast_hash]/
  route.ts             # POST: verify JFS, render SnapResponse with swap_token action
  tx-result/
    route.ts           # POST: (Path 2) verify JFS, accept { tx_hash }, log, enqueue Phase 2
lib/snap/
  jfs.ts               # verify JFS envelope — wrap whichever lib / Neynar endpoint shakes out
  response.ts          # typed SnapResponse builders (text, confirm button, swap_token action)
  types.ts             # SnapEnvelope, SwapTokenAction, etc. — match the docs verbatim
```

New env vars (add to `lib/env.ts`):

- `SPIKE_SNAP_SELL_TOKEN` — CAIP-19 for USDC on Base (hard-coded fallback if unset)
- `SPIKE_SNAP_BUY_TOKEN` — CAIP-19 for AERO on Base (hard-coded fallback if unset)
- `SPIKE_ONCHAIN_LISTENER_ENABLED` — boolean, default `true` during the spike

---

## JFS envelope verification

Required on every snap POST. Do **not** skip this — a snap endpoint without JFS verification is a public trade-intent forgery machine.

Investigate, in order of preference:

1. A first-party `@farcaster/*` package that exposes a `verifyJfs(envelope)` function.
2. Neynar's API (they already verify signed messages elsewhere in our stack — see the neynar webhook HMAC pattern for house style).
3. A hand-rolled ed25519 verification against the signer's on-chain key registry entry.

Whichever wins, wrap it in `lib/snap/jfs.ts` with a single exported `verifyJfsEnvelope(raw: unknown): Promise<{ fid: number; payload: SnapPayload } | { error: JfsError }>`. Every route consumes exactly that surface.

---

## Success criteria for this spike

- [ ] `docs/spikes/snap-tx-hash.md` updated with a "Findings" section that records the exact shapes from the Snap docs
- [ ] `POST /snaps/arena/[cast_hash]` live on a preview deployment, verified by casting `@commodus buy 1 usdc of aero` against the preview webhook URL
- [ ] At least one real human-signed Base swap routed through the flow (use a throwaway $1 USDC → AERO trade; it pays for itself in debugging signal)
- [ ] Telemetry from the swap shows which of Paths 1, 2, 3 fired, with timestamps
- [ ] A one-paragraph decision in the Findings section: **"Ship Path N as the primary; Path 3 as the redundancy layer"** with rationale
- [ ] Updates pushed to [#7](https://github.com/hurley87/victus/issues/7) open question section closing it out

## Hand-off to #7 (when the spike concludes)

Once the mechanism is picked:

1. Remove the "three candidates" language from #7's open-question section; replace with the chosen mechanism's spec.
2. Update `docs/mvp.md` § Durable Execution Architecture to remove the TBD block and describe the chosen path inline.
3. Update #8's Phase 2 trigger section with the concrete mechanism.
4. Keep `docs/spikes/snap-tx-hash.md` in the repo as a permanent record of why this path was chosen over the others — it's valuable forensic context when the decision gets re-litigated six months from now.

---

## What NOT to do in this spike

- Do not implement the durable Phase 2 workflow (that's #8). The spike's goal is to prove tx-hash arrives, not to rebuild the pipeline.
- Do not wire scoring, FIFO lots, or outcome replies. Log-and-stop is enough.
- Do not drop `wallet_policies.max_trade_usdc` yet — that migration rides with #7's PR, not the spike.
- Do not merge to `main`. Keep the spike on a branch (`spike/snap-tx-hash`) behind a preview URL until the mechanism is chosen.

## When to kill the spike

Time-box: **one working day**, hard cap two. If after two days no path fires reliably, ship Path 3 (onchain listener) as the mechanism and move on — the MVP does not block on optimality here.
