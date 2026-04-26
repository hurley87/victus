# Commodus Memory Notes

> Memory model for the Commodus social agent. Plain-text only at MVP — no
> embeddings, no vector search. Lookup is by `thread_hash` or `fid`.
>
> Companion docs: `docs/commodus-agent/prd.md` (PRD, authoritative on
> tables and pipeline), `docs/commodus-agent/voice.md`, `docs/commodus-agent/lore.md`,
> `docs/commodus-agent/safety-rules.md`.

## Principles

- **Raw casts are sacred.** `commodus_casts` rows are evidence and are never
rewritten or merged. Memory tables are *derived* and can be regenerated
from raw casts at any time.
- **Plain text, not vectors.** Summaries are short paragraphs keyed by
`thread_hash` (thread memory) or `fid` (user memory). Vector search is
deferred until corpus size justifies the complexity.
- **Memory is context, not authority.** The voice and safety docs win when
they conflict with anything a memory summary suggests.
- **Memory decays.** Older summaries are softer signal than recent thread
context. The user prompt always includes recent thread messages directly,
not just the summary.

## Tables (defined in the PRD)

- `commodus_thread_memory` — one row per `thread_hash`, holds a compressed
summary of the conversation, the last cast hash seen, and a participants
list.
- `commodus_user_memory` — one row per `fid`, holds a relationship label
(`ally` / `rival` / `unknown` / `muted`), a short summary of who they are
*to Commodus*, and `last_interaction_at`.
- `commodus_long_term_memory` — lore, bits, rivalries, rules, events. Curated
rather than auto-generated. Used to seed running gags or remembered beats.

The PRD is authoritative on column shape; this doc is about *what to write
into those columns and when*.

## What Goes Into Thread Memory

A thread memory summary should answer, in 2–4 sentences:

- What is this thread *about*? (a Commodus cast, a user's trade, a take.)
- Who is talking, and what is each participant's stance?
- What has Commodus already said in this thread? (so he doesn't repeat
beats or contradict prior replies.)
- Any unresolved bait or callback worth picking up next time.

Thread summaries exist for any thread where Commodus has posted ≥2 times.
Below that, the recent-messages window is enough — no summary is written.

## What Goes Into User Memory

A user memory summary should answer, in 2–4 sentences:

- Who is this account *to Commodus*? (recurring rival, occasional heckler,
ally who plays along, unknown.)
- What is their public posture toward the arena? (skeptic, true believer,
trader, lurker.)
- What have they said or done that Commodus has noticed? (a famous bad
trade in the leaderboard, a memorable line, a running bit.)
- Any callbacks or in-jokes Commodus has established with them.

User summaries exist for any FID Commodus has replied to ≥2 times. Below
that, the relationship label stays `unknown` and no summary is written.

### Relationship Labels

- `ally` — has played along, contributed to bits, climbed the leaderboard
with style. Commodus engages warmly-ish.
- `rival` — recurring antagonist who keeps showing up. Commodus engages with
more bite. Still bound by all safety rules.
- `unknown` — default. No history yet. Commodus engages neutrally.
- `muted` — manually flagged. Commodus does not reply, regardless of
mention. Equivalent in effect to `commodus_social_blocklist` for routing.

Labels are set manually or upgraded by heuristic; they are never used to
*soften* safety rules — a `rival` is not a license to break the safety doc.

## What Goes Into Long-Term Memory

Curated, not auto-generated:

- **Lore** — durable facts about the world ("Rome is online," "the feed is
the arena").
- **Bits** — running jokes Commodus has established and may call back.
- **Rivalries** — accounts or archetypes Commodus has a posture toward.
- **Rules** — Commodus's own house rules he likes to invoke.
- **Events** — notable arena moments worth remembering by name.

`importance` is an integer used to rank what gets injected when context is
tight. Higher = more likely to be included.

## Summarization Cadence

- **Debounced.** When a thread or user receives new activity, schedule a
summarization with a small debounce window (so a fast back-and-forth
produces one summary, not five).
- **Idempotent.** A re-run on the same `(thread_hash, last_cast_hash)`
produces the same summary or a strictly fresher one. Never destructive.
- **Inline or cron.** May run inline on debounce or via an optional cron
(`app/api/cron/commodus-memory/route.ts`). Either is acceptable; the
PRD does not require cron at MVP.

## Prompt Injection Order

When the generator assembles context (see `lib/commodus/social/context.ts`):

1. System prompt: voice + safety + lore packet (this file's siblings).
2. User memory summary (if relationship is `ally` or `rival`, or summary
  exists).
3. Thread memory summary (if exists).
4. Last 5–10 thread messages, oldest → newest.
5. Triggering cast text + author handle + relationship label.
6. Last ~10 Commodus social posts (anti-repetition; trade narrations are
  not included at MVP — see PRD's "Anti-repetition gap").

If the prompt is over budget, trim from the bottom of the message window
first, then drop older long-term-memory items by `importance` ascending.
Voice + safety + lore packet are never trimmed.

## Regenerating Memory

Because raw casts are preserved, any thread or user summary can be rebuilt
from `commodus_casts` alone. If a summary becomes stale, contradicts current
behavior, or is poisoned by a prompt-injection attempt in a user cast,
delete the row and let the next debounce regenerate it.

For a full rebuild, run:

```bash
pnpm exec tsx scripts/rebuild-commodus-memory.ts
```

The script derives eligible thread hashes and FIDs from `commodus_casts`, then
rewrites only `commodus_thread_memory` and `commodus_user_memory`.

## Out of Scope at MVP

- Vector embeddings, semantic search, pgvector.
- Cross-thread retrieval beyond direct `thread_hash` / `fid` lookup.
- Memory of off-Farcaster signal (no Twitter, no website scrapes).
- Auto-promotion between relationship labels — done manually for now.

