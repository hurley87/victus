# Commodus Social Replay

This doc captures the operator workflow for iterating on the Commodus social
agent without building a full admin UI.

## Why this exists

`commodus_social_runs` already gives us the audit trail:

- what cast triggered the agent
- whether Commodus replied or ignored it
- the score and reason
- the prompt snapshot
- the model output
- any posted cast hash

For inspection, direct Supabase queries are enough. A separate admin list route
is convenience, not core product.

Replay is the useful operator tool. It takes a real stored event and reruns it
through the current code, prompts, markdown voice docs, context builder, ranker,
generator, and safety filters. Each replay writes a new run row, so the original
evidence stays intact.

## Local-only assumption

This workflow is intended for local operator use.

`ADMIN_API_TOKEN` only needs to exist in the local environment that runs the
endpoint. It does not need to become a user-facing or production UI concern
unless we later choose to expose remote operator tooling.

## Proposed endpoint

```text
POST /api/admin/commodus-social/replay
Authorization: Bearer $ADMIN_API_TOKEN
Content-Type: application/json
```

Request:

```json
{
  "trigger_cast_hash": "0xabc123..."
}
```

Response:

```json
{
  "ok": true,
  "original_run_id": "original-run-id",
  "new_run_id": "new-run-id",
  "trigger_cast_hash": "0xabc123...",
  "action": "reply",
  "reason": "high_signal_direct_reply",
  "score": 82,
  "draft": "Clean answer, sharper tone...",
  "risk_flags": []
}
```

## Safety defaults

Replay should default to no posting, even after live social posting exists.

If we ever want replay to publish, require an explicit request field such as:

```json
{
  "trigger_cast_hash": "0xabc123...",
  "post": true
}
```

Until that exists, replay is an iteration tool only:

- load a stored trigger cast
- rerun the social pipeline against current code and docs
- write a new `commodus_social_runs` row
- return the new draft
- do not mutate the original run row
- do not duplicate the original run row
- do not post to Farcaster

## Iteration loop

Find recent social runs in Supabase:

```sql
select
  id,
  created_at,
  action,
  reason,
  score,
  trigger_cast_hash,
  selected_cast_hash,
  model_output
from commodus_social_runs
order by created_at desc
limit 50;
```

Pick a `trigger_cast_hash` where Commodus behaved poorly:

- ignored something he should answer
- drafted weak copy
- sounded too theatrical
- tripped safety too aggressively
- missed important thread or author context

Replay it locally:

```bash
curl -X POST "http://localhost:3000/api/admin/commodus-social/replay" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "trigger_cast_hash": "0xabc123..."
  }'
```

Change one of the relevant inputs:

- `docs/commodus-agent/voice.md`
- `docs/commodus-agent/safety-rules.md`
- `docs/commodus-agent/lore.md`
- `lib/commodus/social/rank.ts`
- `lib/commodus/social/context.ts`
- `lib/commodus/social/generate.ts`

Then replay the same `trigger_cast_hash` again and compare the new
`commodus_social_runs` row against the original.

## What not to build yet

Do not build `app/api/admin/commodus-social/route.ts` just to list runs unless
direct Supabase inspection becomes too slow.

The narrower useful scope is:

- keep inspection in Supabase
- build only `app/api/admin/commodus-social/replay/route.ts`
- keep the endpoint token-gated
- keep replay local and non-posting by default

