# PRD: Commodus as a Farcaster Social Agent (Reply-Only)

> Target file in repo: `docs/commodus-social-agent.md`
> Companion docs: `docs/commodus-voice.md`, `docs/commodus-lore.md`, `docs/commodus-safety-rules.md`, `docs/commodus-memory.md`

## Context

Commodus already exists in Victus as the autonomous trading character (`lib/commodus/autotrader/*`, `lib/commodus/lore/*`, `lib/commodus/bot.ts`, trade replies in `lib/execution/templates.ts`). Today he is mostly an executor — he trades and narrates. He does not *react*: when people reply to him, mention him, or quote his casts, nothing happens beyond what the trade pipeline emits.

This PRD adds a reactive social layer. Commodus listens via Neynar webhooks for engagement directed at him and replies in voice, with memory of who he's talked to and what they've said. He is reply-only at launch — he does not scout the timeline. The goal is presence and identity around his own casts, not reach.

## Goals

- Commodus reacts to mentions, replies, and quote casts via Neynar webhook.
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

Single path: Neynar webhook → decision pipeline.

```
Neynar webhook ─▶ verify + persist event ─▶ rank ─▶ context ─▶ generate ─▶ post (Neynar)
                          │                   │         │           │
                          ▼                   ▼         ▼           ▼
                  commodus_casts (raw)   commodus_social_runs (every decision)
                                         commodus_thread_memory / user_memory (compressed, async)
```

Modules (new):
- `lib/commodus/social/rank.ts` — `{ action, score, reason }`
- `lib/commodus/social/context.ts` — assemble LLM context
- `lib/commodus/social/generate.ts` — produce + self-rank 3 drafts
- `lib/commodus/social/post.ts` — Neynar publish + idempotency
- `lib/commodus/social/memory.ts` — summarization + embedding writes
- `lib/commodus/social/limits.ts` — rate caps and mute/blocklist checks

Reuses:
- `lib/neynar/*` (existing client, cast publish path used by trade replies)
- `lib/execution/reply-guard.ts` pattern for publish-once semantics
- `lib/logger.ts` Pino child logger (`logger.child({ runId, source })`)
- Webhook auth pattern from `app/api/webhook/route.ts` and `app/api/webhooks/neynar/route.ts`
- `NEYNAR_API_KEY`, `NEYNAR_SIGNER_UUID`, `COMMODUS_FID`, `OPENAI_API_KEY`, `ADMIN_API_TOKEN` (already in `lib/env.ts`)

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
- `participants jsonb`, `updated_at timestamptz`, `embedding vector(1536)`

**`commodus_user_memory`** — per-FID relationship
- `id uuid pk`, `fid bigint unique`, `username text`, `summary text`
- `relationship text check in ('ally','rival','unknown','muted')`
- `last_interaction_at timestamptz`, `embedding vector(1536)`

**`commodus_long_term_memory`** — lore/bits/rivalries
- `id uuid pk`, `memory_type text check in ('lore','bit','rivalry','rule','event')`
- `title text`, `body text`, `source text`, `importance int`
- `embedding vector(1536)`, `created_at timestamptz default now()`

**`commodus_social_blocklist`** — manual mute
- `fid bigint pk`, `reason text`, `created_at timestamptz default now()`

Enable `pgvector`; add ivfflat indexes on each `embedding` column. Idempotency on `commodus_social_runs.idem_key` (= `sha256(trigger_hash:run_type)`) prevents double posts on webhook retry.

Principle: **raw casts never get rewritten or merged**. Memory tables are derived and can be regenerated.

## Agent Decision Pipeline (webhook-driven)

1. **Receive** — Neynar `cast.created` event hits webhook. Verify signature.
2. **Filter** — only process events where:
   - `parent_author_fid = COMMODUS_FID` (reply to Commodus), or
   - the cast mentions `COMMODUS_FID`, or
   - it's a quote cast of a Commodus cast.
   Drop everything else immediately (still log count).
3. **Persist** — upsert into `commodus_casts` with `source='webhook'` (idempotent on `hash`).
4. **Rank** — `rank.ts` returns `{ action, score, reason }`. Inputs: relevance/quality of the engagement, author quality, thread liveness, recency of prior Commodus reply to that author/thread, harassment/pile-on detection, low-context filter (e.g., a bare emoji), Commodus's "good angle" check.
5. **Limit gate** — `limits.ts`: ≤1 reply per author per 24h unless they have replied to Commodus more recently, ≤3 Commodus replies per thread, blocklist check. Direct mentions and replies-to-Commodus do not count against any daily proactive cap (there is none — reply-only).
6. **Context** — `context.ts` assembles: triggering cast + last 5–10 thread messages, author memory (if any), thread memory (if any), top-K vector results from `commodus_long_term_memory` (lore/bits), last ~10 Commodus posts (anti-repetition), and the voice-guide markdown injected as a system prompt.
7. **Generate** — produce 3 drafts, self-rank, return:
   ```json
   { "shouldReply": true, "reason": "...", "reply": "...", "tone": "theatrical", "riskFlags": [] }
   ```
8. **Safety filter** — reject on `riskFlags`, banned terms, length > 320 chars, hashtag overuse, "as an AI" tells.
9. **Post** — `post.ts` publishes via Neynar with `parent_cast_hash`, idempotency key set, then writes `posted_cast_hash` back to the run row and inserts a `source='self'` row in `commodus_casts`.
10. **Async memory update** — debounce summarization for affected thread + author.

Every step writes to `commodus_social_runs`. Ignores are first-class records.

## Prompting & Memory Strategy

System prompt is assembled from:
- `docs/commodus-voice.md` (canonical voice)
- A short distilled lore packet (top-K from `commodus_long_term_memory` by relevance)
- `docs/commodus-safety-rules.md` (hard rules)

User prompt includes:
- Triggering cast text + author handle + relationship label
- Up to 10 prior thread messages (oldest → newest)
- Author memory summary (if relationship is ally/rival)
- Thread memory summary (if exists)
- Last ~10 Commodus posts (to avoid repetition / catchphrase fatigue)

Vectorize **only**:
- Thread summaries (after ≥3 messages)
- User relationship summaries (after ≥2 interactions)
- Recurring bits (manual + auto-detected)
- Commodus lore (from `docs/commodus-lore.md`, ingested on deploy)
- High-signal game/trading events (e.g., elimination, large PnL)
- Important Commodus posts flagged by engagement threshold

Do **not** vectorize: every short reply, low-context noise, ignored events.

## Voice (summary; full version goes in `docs/commodus-voice.md`)

Commodus is: arrogant, theatrical, Roman, competitive, funny, self-aware, obsessed with the arena.
Commodus is **not**: a helpful assistant, generic crypto influencer, engagement farmer, mean without wit, sexually explicit, threatening, racist/sexist/etc., a doxxing or harassment bot.

Reply shape: 1–3 sentences, first person, punchy, no hashtags unless needed, no "as an AI," no financial advice. Roast ideas, trades, narratives, market behavior — never protected traits or personal vulnerabilities.

## Safety / Guardrails

- ≤1 reply per author per 24h unless they've replied back to Commodus more recently.
- ≤3 Commodus replies per thread.
- Hard skip on tragedy, health, grief, family, personal crises, harassment pile-ons (keyword + LLM classifier).
- No slurs, threats, sexual content, doxxing, protected-class insults.
- Manual `commodus_social_blocklist` (FIDs) and `thread_hash` mute list.
- Kill switch env var: `COMMODUS_SOCIAL_DRY_RUN=true` — full pipeline runs, nothing posts.
- Per-run logging through `lib/logger.ts` with `runId`.

## API & Routes

| Route | Purpose |
|-------|---------|
| `app/api/webhooks/neynar/route.ts` (extend) | Add `cast.created` mention/reply/quote handling for Commodus |
| `app/api/admin/commodus-social/route.ts` | Admin list of recent runs (auth: `ADMIN_API_TOKEN`) |
| `app/api/admin/commodus-social/[id]/approve/route.ts` | Manual approve-to-post (Phase 3 only) |
| `app/api/admin/commodus-social/replay/route.ts` | Replay a stored event through the pipeline (debug) |

No new cron is required for the user-facing feature. An optional `app/api/cron/commodus-memory/route.ts` may be added in Phase 5 for background summarization, but it can also run inline on debounce.

## Neynar Webhook

Extend `app/api/webhooks/neynar/route.ts` (or create a dedicated handler under `app/api/webhooks/neynar/social/route.ts`) to subscribe to `cast.created`, filtered to:
- Replies to any cast where `parent_author_fid = COMMODUS_FID`
- Casts mentioning `@commodus` (FID match)
- Quote casts of Commodus casts

Webhook handler must:
1. Verify Neynar signature (existing pattern).
2. Insert into `commodus_casts` with `source='webhook'` (idempotent on `hash`).
3. Run rank/context/generate/post pipeline inline. If a single inline run risks exceeding webhook timeout under load, move to a Vercel Workflow (existing `lib/workflows/` pattern). Inline is fine for MVP.
4. Return 200 even on ignore — idempotency key on `commodus_social_runs` makes Neynar retries safe.

## Build Phases

**Phase 1 — Docs.** Create `docs/commodus-social-agent.md` (this PRD), `docs/commodus-voice.md`, `docs/commodus-lore.md`, `docs/commodus-safety-rules.md`, `docs/commodus-memory.md`. Voice doc is the most important.

**Phase 2 — Database.** Migration adding the 5 tables + blocklist, indexes, pgvector enable, idempotency unique constraints.

**Phase 3 — Webhook dry run.** Implement `rank.ts`, `context.ts`, `generate.ts`. Wire the Neynar webhook with `COMMODUS_SOCIAL_DRY_RUN=true`. Save events and decisions and generated drafts. **No posting.** Add admin route to list recent runs.

**Phase 4 — Live posting.** Optional manual approve. Flip dry-run off with strict per-author/per-thread caps. Watch for 48h on a narrow filter before widening.

**Phase 5 — Memory summarization.** Debounced thread/user summarization writing summaries + embeddings. Lore ingested from markdown on deploy.

**Phase 6 — Tuning.** Adjust prompts, ranking weights, caps, blocklists. Add observability dashboards / log queries.

## Open Questions

1. Should quote-casts of Commodus get a reply, or only replies + mentions? Proposed: replies + mentions only at launch.
2. Embedding model — reuse OpenAI `text-embedding-3-small`? (matches existing `OPENAI_API_KEY` footprint)
3. Should `commodus_long_term_memory` be seeded from `lib/commodus/lore/season-1.ts` automatically?
4. Inline pipeline vs Vercel Workflow — start inline; promote if p95 webhook latency creeps up?
5. Do we want a "shadow mode" where drafts post to a private Farcaster channel for human review during Phase 3?

## Acceptance Criteria

- Migration applied; all 5 tables + blocklist exist with indexes and pgvector.
- `docs/commodus-voice.md` exists and is loaded into every generation prompt.
- Neynar webhook captures replies / mentions / (optionally) quotes of `COMMODUS_FID`, persists them, and runs them through the decision pipeline.
- With `DRY_RUN=true`, every qualifying event produces one `commodus_social_runs` row including ignores, with `prompt_snapshot` and `model_output` populated, and no cast is posted.
- Disabling dry-run causes Commodus to post within caps: ≤1 per author/24h (with reply-back exception), ≤3 per thread; idempotency prevents duplicates on Neynar retry.
- Admin route lists the last N runs with action, reason, draft, posted hash.
- A blocklisted FID never receives a Commodus reply, even on direct mention.
- Manual run on a stored event produces an in-voice 1–3 sentence reply with no banned content and no "as an AI" tells.
- Thread memory exists for any thread where Commodus posted ≥2 times; user memory exists for any FID Commodus has replied to ≥2 times.

## Verification

- `pnpm typecheck && pnpm lint && pnpm test`
- New unit tests: `lib/commodus/social/rank.test.ts`, `generate.test.ts` (golden voice checks), `limits.test.ts` (cap math), `post.test.ts` (idempotency).
- Local smoke: send a synthetic Neynar `cast.created` payload to the webhook; confirm `commodus_casts` + `commodus_social_runs` rows.
- Use the admin replay route on a stored event to iterate on prompts without waiting for organic engagement.
- Production smoke: enable live posting for 48h, review every run row before widening filters.
