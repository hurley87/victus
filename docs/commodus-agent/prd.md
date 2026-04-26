# PRD: Commodus as a Farcaster Social Agent (Reply-Only)

> Target file in repo: `docs/commodus-agent/prd.md`
> Companion docs: `docs/commodus-agent/voice.md`, `docs/commodus-agent/lore.md`, `docs/commodus-agent/safety-rules.md`, `docs/commodus-agent/memory.md`

## Context

Commodus already exists in Victus as the autonomous trading character (`lib/commodus/autotrader/*`, `lib/commodus/lore/*`, `lib/commodus/bot.ts`, trade replies in `lib/execution/templates.ts`). Today he is mostly an executor — he trades and narrates. He does not *react*: when people reply to him, mention him, or quote his casts, nothing happens beyond what the trade pipeline emits.

This PRD adds a reactive social layer. Commodus listens via Neynar webhooks for engagement directed at him and replies in voice, with memory of who he's talked to and what they've said. He is reply-only at launch — he does not scout the timeline. The goal is presence and identity around his own casts, not reach.

## Goals

- Commodus reacts to mentions and replies via Neynar webhook (quote casts deferred).
- Every inbound event and decision is recorded — replies and ignores both.
- Commodus carries memory of threads and people across conversations.
- A small set of markdown docs is the canonical source of his voice, lore, and safety rules.
- Strict per-thread and per-author caps prevent spam at launch.

## Non-Goals

- **No proactive scouting / no scheduled timeline scanning.** Reply-only.
- Not a generic reply bot, engagement farmer, or "AI assistant."
- No DMs, no follows-for-follows, no farming.
- No new trade execution behavior — this is purely the social layer.
- No Commodus-only trade restrictions or bypasses (per `CLAUDE.md`: trading rules are unified).
- No replacement of existing trade-narration replies in `lib/execution/templates.ts`. The reply pipeline is for *conversation*, not trade outcomes.

## Agent Experience

A user replies to a Commodus cast: "imagine taking advice from a chatbot lol". Within ~30 seconds, Commodus replies: *"And yet here you are, in my thread, attending my school."* — in voice, single sentence. If they reply again, he continues, up to a per-thread cap. If they show up in a different thread next week, he remembers them.

Operationally, the team can review every inbound event Commodus considered and why he replied or passed, via an admin view.

## System Architecture

Single ingress: existing Neynar webhook fans out to a new social workflow alongside the existing trade-command workflow.

```
Neynar webhook ─┬─▶ start(handleCommodusCommand)   (trade path, unchanged)
                └─▶ start(handleSocialEngagement)  (new)
                            │
                            ▼
            verify + persist event ─▶ rank ─▶ context ─▶ generate ─▶ post (Neynar)
                          │                   │         │           │
                          ▼                   ▼         ▼           ▼
                  commodus_casts (raw)   commodus_social_runs (every decision)
                                         commodus_thread_memory / user_memory (compressed, async)
```

Modules (new):
- `lib/commodus/social/rank.ts` — heuristics-only gate: `{ action, score, reason }` from caps, blocklist, length, keyword tragedy/harassment skip, author-memory relationship. No LLM call.
- `lib/commodus/social/context.ts` — assemble LLM context
- `lib/commodus/social/generate.ts` — single LLM call: produces 3 drafts and self-judges `shouldReply`. Only LLM call in the pipeline.
- `lib/commodus/social/post.ts` — Neynar publish + idempotency + writes a `source='self'` row to `commodus_casts` after publishing
- `lib/commodus/social/memory.ts` — debounced thread/user summarization (plain text)
- `lib/commodus/social/limits.ts` — rate caps and mute/blocklist checks

Reuses:
- `lib/neynar/*` (existing client, cast publish path used by trade replies)
- `lib/execution/reply-guard.ts` pattern for publish-once semantics
- `lib/logger.ts` Pino child logger (`logger.child({ runId, source })`)
- Webhook auth pattern from `app/api/webhook/route.ts` and `app/api/webhooks/neynar/route.ts`
- `NEYNAR_API_KEY`, `NEYNAR_SIGNER_UUID`, `COMMODUS_FID`, `OPENAI_API_KEY`, `ADMIN_API_TOKEN` (already in `lib/env.ts`)

### Trade-path isolation (invariant)

This PRD is **strictly additive**. The following files/modules are **not modified** by the social agent implementation:

- `lib/execution/templates.ts` (trade-narration replies)
- `lib/commodus/lore/persona.ts` (`COMMODUS_PERSONA`, `COMMODUS_VOICE_RULES`)
- `lib/workflows/commodus-command.ts` (trade workflow)
- The trade-ingress logic in `app/api/webhooks/neynar/route.ts` (signature verify, rate-limit, dedupe, self-cast early-return, `cast_commands` upsert, `start(handleCommodusCommand)`)

The only change to the webhook route is a single new `start(handleSocialEngagement, [ctx])` call sited next to the existing trade workflow start. No reordering.

**Known debt (MVP):** Voice text is duplicated short-term between markdown (social agent) and `persona.ts` constants (autotrader). A future cleanup PR will unify them; out of scope here.

**Anti-repetition gap (MVP):** Because trade narration does not write `source='self'` rows, the social agent's "last ~10 Commodus posts" context covers social replies only. Accepted to keep the trade path untouched.

A small `commodus-memory` summarization job is the only scheduled work, and it is *not* user-facing — it just compresses thread/user history into memory tables. It can run inline on a debounce instead of cron if preferred.

## Data Model

New Supabase migration: `supabase/migrations/<ts>_add_commodus_social_agent.sql`. Service-role only (matches existing posture in `docs/supabase.md`).

**`commodus_casts`** — raw evidence (every inbound + every Commodus self-post)
- `id uuid pk`, `hash text unique`, `thread_hash text`, `parent_hash text`, `parent_author_fid bigint`
- `author_fid bigint`, `author_username text`, `text text`, `channel_id text`, `url text`
- `like_count int`, `recast_count int`, `reply_count int`
- `source text check in ('webhook','manual','self')`
- `raw_json jsonb`, `created_at timestamptz`, `first_seen_at timestamptz default now()`
- Indexes: `(hash)`, `(thread_hash)`, `(author_fid, first_seen_at desc)`, `(created_at desc)`

**`commodus_social_runs`** — every decision
- `id uuid pk`, `run_type text check in ('webhook','manual')`
- `trigger_cast_hash text`, `selected_cast_hash text`
- `action text check in ('reply','ignore','save_only','error')`
- `score numeric`, `reason text`, `risk_flags text[]`
- `prompt_snapshot jsonb`, `model_output jsonb`
- `posted_cast_hash text`, `idem_key text unique`, `created_at timestamptz default now()`
- Indexes: `(created_at desc)`, `(action, created_at desc)`, `(selected_cast_hash)`

**`commodus_thread_memory`** — compressed thread summary
- `id uuid pk`, `thread_hash text unique`, `summary text`, `last_cast_hash text`
- `participants jsonb`, `updated_at timestamptz`

**`commodus_user_memory`** — per-FID relationship
- `id uuid pk`, `fid bigint unique`, `username text`, `summary text`
- `relationship text check in ('ally','rival','unknown','muted')`
- `last_interaction_at timestamptz`

**`commodus_long_term_memory`** — lore/bits/rivalries
- `id uuid pk`, `memory_type text check in ('lore','bit','rivalry','rule','event')`
- `title text`, `body text`, `source text`, `importance int`
- `created_at timestamptz default now()`

**`commodus_social_blocklist`** — manual mute
- `fid bigint pk`, `reason text`, `created_at timestamptz default now()`

Memory tables are plain text at MVP. Lookup is by `thread_hash` / `fid` directly — **no pgvector, no embeddings**. Vector search is deferred until corpus size justifies it. Idempotency on `commodus_social_runs.idem_key` (= `sha256(trigger_hash:run_type)`) prevents double posts on webhook retry.

Principle: **raw casts never get rewritten or merged**. Memory tables are derived and can be regenerated.

## Agent Decision Pipeline (webhook-driven)

1. **Receive** — Neynar `cast.created` event hits webhook. Verify signature.
2. **Filter** — only process events where:
   - `parent_author_fid = COMMODUS_FID` (reply to Commodus), or
   - the cast mentions `COMMODUS_FID`.
   Quote casts are **not** processed at launch. Drop everything else immediately (still log count).
3. **Persist** — upsert into `commodus_casts` with `source='webhook'` (idempotent on `hash`).
4. **Rank (heuristics-only)** — `rank.ts` returns `{ action, score, reason }`. **No LLM call here.** Inputs: per-author + per-thread caps, blocklist, length/low-context filters (e.g., a bare emoji), keyword-based tragedy/harassment skip list, author-memory relationship (`muted`/`rival`/`ally`/`unknown`), recency of prior Commodus reply.
5. **Limit gate** — `limits.ts`: ≤3 Commodus reply casts per thread (excluding the originating cast); ≤2 replies per author per rolling 24h, **no reset on user reply-back**; blocklist + thread-mute check.
6. **Context** — `context.ts` assembles: triggering cast + last 5–10 thread messages, author memory summary (if any), thread memory summary (if any), static lore packet read from `docs/commodus-agent/lore.md`, last ~10 Commodus social posts (anti-repetition; social-only, see Trade-path isolation), and the voice-guide markdown injected as a system prompt.
7. **Generate (only LLM call in the pipeline)** — produce 3 drafts and self-judge, returning:
   ```json
   { "shouldReply": true, "reason": "...", "reply": "...", "tone": "theatrical", "riskFlags": [] }
   ```
   The LLM may veto with `shouldReply: false`.
8. **Safety filter** — reject on `riskFlags`, banned terms, length > 320 chars, hashtag overuse, "as an AI" tells.
9. **Post** — `post.ts` publishes via Neynar with `parent_cast_hash`, idempotency key set, then writes `posted_cast_hash` back to the run row.
10. **Persist self-cast** — `post.ts` inserts a `source='self'` row in `commodus_casts` after a successful publish. Social-path only; trade narration is not instrumented at MVP.
11. **Async memory update** — debounce summarization for affected thread + author.

Every step writes to `commodus_social_runs`. Ignores are first-class records.

## Prompting & Memory Strategy

The social agent reads voice + safety rules **directly from markdown** at runtime. `lib/commodus/lore/persona.ts` (used by the autotrader) is intentionally untouched — see Trade-path isolation. The duplication is known debt and out of scope here.

System prompt is assembled from:
- `docs/commodus-agent/voice.md` (canonical voice for the social agent)
- A short distilled lore packet read from `docs/commodus-agent/lore.md`
- `docs/commodus-agent/safety-rules.md` (hard rules)

User prompt includes:
- Triggering cast text + author handle + relationship label
- Up to 10 prior thread messages (oldest → newest)
- Author memory summary (if relationship is ally/rival)
- Thread memory summary (if exists)
- Last ~10 Commodus social posts (to avoid repetition / catchphrase fatigue; trade narrations not included at MVP)

**No vectorization at MVP.** Memory tables hold plain-text summaries keyed by `thread_hash` / `fid`. Lore is loaded as static markdown. Vector search is deferred to a later phase.

## Voice (summary; full version goes in `docs/commodus-agent/voice.md`)

Commodus is: arrogant, theatrical, Roman, competitive, funny, self-aware, obsessed with the arena.
Commodus is **not**: a helpful assistant, generic crypto influencer, engagement farmer, mean without wit, sexually explicit, threatening, racist/sexist/etc., a doxxing or harassment bot.

Reply shape: 1–3 sentences, first person, punchy, no hashtags unless needed, no "as an AI," no financial advice. Roast ideas, trades, narratives, market behavior — never protected traits or personal vulnerabilities.

## Safety / Guardrails

- ≤2 replies per author per rolling 24h. Hard cap, **no reset** on user reply-back.
- ≤3 Commodus reply casts per thread, excluding any originating Commodus cast.
- Hard skip on tragedy, health, grief, family, personal crises, harassment pile-ons (keyword + LLM classifier).
- No slurs, threats, sexual content, doxxing, protected-class insults.
- Manual `commodus_social_blocklist` (FIDs) and `thread_hash` mute list.
- Kill switch env var: `COMMODUS_SOCIAL_DRY_RUN=true` — full pipeline runs, nothing posts.
- Per-run logging through `lib/logger.ts` with `runId`.

## API & Routes

| Route | Purpose |
|-------|---------|
| `app/api/webhooks/neynar/route.ts` (extend) | Add a sibling `start(handleSocialEngagement)` next to the existing trade workflow start. No other changes. |
| `app/api/admin/commodus-social/route.ts` | Admin list of recent runs (auth: `ADMIN_API_TOKEN`) |
| `app/api/admin/commodus-social/replay/route.ts` | Replay a stored event through the pipeline (debug) |

No new cron is required for the user-facing feature. An optional `app/api/cron/commodus-memory/route.ts` may be added in Phase 5 for background summarization, but it can also run inline on debounce.

## Neynar Webhook

Extend the existing `app/api/webhooks/neynar/route.ts` with a single additional `start(handleSocialEngagement, [ctx])` call sited next to the existing `start(handleCommodusCommand, [ctx])`. **No reordering** of existing logic. The new social workflow filters to:
- Replies where `parent_author_fid = COMMODUS_FID`
- Casts mentioning `@commodus` (FID match)

Quote casts are not handled at launch.

The new `handleSocialEngagement` workflow:
1. Insert into `commodus_casts` with `source='webhook'` (idempotent on `hash`).
2. Insert a `commodus_social_runs` landing row with `idem_key = sha256(trigger_hash:run_type)`.
3. Run rank → context → generate → post. Vercel Workflow handles retries; idempotency on `idem_key` makes Neynar re-deliveries safe.
4. Return early on filter miss — still log the run row with `action='ignore'`.

## Build Phases

**Phase 1 — Docs.** Create `docs/commodus-agent/prd.md` (this PRD), `docs/commodus-agent/voice.md`, `docs/commodus-agent/lore.md`, `docs/commodus-agent/safety-rules.md`, `docs/commodus-agent/memory.md`. Voice doc is the most important. `lib/commodus/lore/persona.ts` is **not** modified.

**Phase 2 — Database.** Migration adding the 5 tables + blocklist, indexes, idempotency unique constraints. **No pgvector / no embedding columns.**

**Phase 3 — Workflow dry run.** Implement `rank.ts` (heuristics), `context.ts`, `generate.ts`. Wire `handleSocialEngagement` into the existing webhook with `COMMODUS_SOCIAL_DRY_RUN=true`. Save events, decisions, and generated drafts. **No posting.** Add admin list + replay routes.

**Phase 4 — Live posting.** Flip dry-run off with strict per-author / per-thread caps. Watch for 48h before widening.

**Phase 5 — Memory summarization.** Debounced thread/user summarization writing plain-text summaries.

**Phase 6 — Tuning.** Adjust prompts, ranking weights, caps, blocklists. Add observability dashboards / log queries.

## Resolved Decisions

1. **Quote casts**: not at launch. Replies + mentions only.
2. **Embeddings**: none at MVP. Memory is plain text. Vector search deferred until corpus justifies it.
3. **Lore source**: `lib/commodus/lore/season-1.ts` is unchanged and continues to feed autotrader narration. The social agent reads `docs/commodus-agent/lore.md` directly. No shared loader at MVP.
4. **Async model**: Vercel Workflow (`handleSocialEngagement`), mirroring `handleCommodusCommand`. Not inline.
5. **Phase 3 validation**: `COMMODUS_SOCIAL_DRY_RUN=true` env flag plus admin list + replay routes. No shadow channel, no manual approve-to-post route.

## Acceptance Criteria

- Migration applied; all 5 tables + blocklist exist with indexes. **No pgvector**, no embedding columns.
- `docs/commodus-agent/voice.md` exists and is loaded into every generation prompt.
- Neynar webhook captures replies and mentions of `COMMODUS_FID` (quote casts not handled), persists them, and runs them through the decision pipeline via `handleSocialEngagement`.
- With `DRY_RUN=true`, every qualifying event produces one `commodus_social_runs` row including ignores, with `prompt_snapshot` and `model_output` populated, and no cast is posted.
- Disabling dry-run causes Commodus to post within caps: ≤2 per author / rolling 24h (no reply-back reset), ≤3 per thread excluding originating cast; idempotency prevents duplicates on Neynar retry.
- Admin route lists the last N runs with action, reason, draft, posted hash. Replay route re-runs prompts on stored events.
- A blocklisted FID never receives a Commodus reply, even on direct mention.
- Manual run on a stored event produces an in-voice 1–3 sentence reply with no banned content and no "as an AI" tells.
- Thread memory exists for any thread where Commodus posted ≥2 times; user memory exists for any FID Commodus has replied to ≥2 times.
- **Trade-path isolation invariant**: diff review confirms `lib/execution/templates.ts`, `lib/commodus/lore/persona.ts`, `lib/workflows/commodus-command.ts`, and the trade-ingress logic in `app/api/webhooks/neynar/route.ts` are unchanged. The webhook diff contains exactly one new `start(handleSocialEngagement, [ctx])` call and nothing else.

## Verification

- `pnpm typecheck && pnpm lint && pnpm test`
- New unit tests: `lib/commodus/social/rank.test.ts`, `generate.test.ts` (golden voice checks), `limits.test.ts` (cap math), `post.test.ts` (idempotency).
- Local smoke: send a synthetic Neynar `cast.created` payload to the webhook; confirm `commodus_casts` + `commodus_social_runs` rows.
- Use the admin replay route on a stored event to iterate on prompts without waiting for organic engagement.
- Production smoke: enable live posting for 48h, review every run row before widening filters.
