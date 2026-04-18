# Supabase

Operational reference for the Victus Supabase project. For the product data model, see `[docs/mvp.md` § Data Model](./mvp.md).

## Project


| Field     | Value                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| Name      | Victus                                                                                                             |
| Ref       | `rjiecbvxrlctmoblqngt`                                                                                             |
| Region    | `us-east-2`                                                                                                        |
| Postgres  | 17.6                                                                                                               |
| URL       | `https://rjiecbvxrlctmoblqngt.supabase.co`                                                                         |
| Dashboard | [supabase.com/dashboard/project/rjiecbvxrlctmoblqngt](https://supabase.com/dashboard/project/rjiecbvxrlctmoblqngt) |


## Clients

Two clients live in `lib/supabase/`:


| Import                                                  | Key          | RLS          | Use from                                                                     |
| ------------------------------------------------------- | ------------ | ------------ | ---------------------------------------------------------------------------- |
| `lib/supabase/server.ts` → `supabaseAdmin`              | service role | **bypasses** | webhook handlers, Vercel Workflow steps, API routes, server actions, crons   |
| `lib/supabase/client.ts` → `getSupabaseBrowserClient()` | publishable  | **enforced** | browser (currently unused — reserved for future Realtime or RLS-gated reads) |


`lib/supabase/server.ts` imports `"server-only"`, so any accidental client import becomes a build-time error.

## Read / write posture (MVP)

**All writes go through `supabaseAdmin` on the server.** The browser never writes to game-state tables.

**Reads also go through `supabaseAdmin`, called from API routes** that return JSON to the browser. The browser does not talk to Supabase directly in MVP.

This is why every table has `RLS ENABLED` with **no policies** — the Supabase linter will flag this as `rls_enabled_no_policy` at INFO level, and that is the intended posture:

- anon / authenticated roles have no policies, so they can read or write nothing
- service role bypasses RLS, so the server can do everything
- if the service role key ever leaks, RLS is still our last line of defense

When we want client-direct reads later (leaderboard Realtime subscriptions, for example), we'll add explicit `select` policies on a per-table basis. We will never add blanket `using (true)` policies.

## Migrations

Versioned SQL files live in `[supabase/migrations/](../supabase/migrations/)`. The file name format is `<timestamp>_<name>.sql`, matching the Supabase CLI convention.

Current migrations:


| Version          | Name                             | Purpose                                                       |
| ---------------- | -------------------------------- | ------------------------------------------------------------- |
| `20260417094525` | `init_commodus_schema`           | Full initial schema, seed `asset_whitelist`                   |
| `20260417094617` | `pin_set_updated_at_search_path` | Pin `set_updated_at` function search_path (security lint fix) |


### Applying migrations

Via the Supabase MCP (preferred during development):

```text
Ask the assistant: "apply this migration to Victus"
→ tool: plugin-supabase-supabase / apply_migration
```

Via the CLI (requires `supabase login` and `supabase link --project-ref rjiecbvxrlctmoblqngt`):

```bash
supabase db push
```

### Writing a new migration

1. Create a file at `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`.
2. Use lowercase DDL, one logical change per migration where practical.
3. New tables must `enable row level security` (add to the RLS block).
4. New `plpgsql` functions must `set search_path = ''` (see migration `0002`).
5. Monetary / quantity columns must be `numeric(38, 18)` — never `float` or `double precision`.
6. Apply, then regenerate types (see below).

## TypeScript types

Generated types live at `lib/supabase/types.ts`. Regenerate after any schema change:

```bash
pnpm supabase:types
```

(Or ask the assistant to call `generate_typescript_types` via the MCP.)

Typed usage example:

```ts
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Tables, TablesInsert } from "@/lib/supabase/types";

type CastCommand = Tables<"cast_commands">;
type NewCastCommand = TablesInsert<"cast_commands">;

const { data, error } = await supabaseAdmin
  .from("cast_commands")
  .insert({ fid: 1234n as unknown as number, cast_hash: "0x...", text: "..." } satisfies NewCastCommand)
  .select()
  .single();
```

## Idempotency contracts

The pipeline relies on database-level uniqueness for idempotency. Do not add code paths that bypass these.


| Layer       | Constraint                                                                       |
| ----------- | -------------------------------------------------------------------------------- |
| Webhook     | `cast_commands.cast_hash` UNIQUE                                                 |
| Chain       | `trade_executions.tx_hash` UNIQUE (supplied by the user's signed tx via swapToken) |
| Reply       | `scoring_events (cast_command_id, event_type)` UNIQUE                            |
| Lot linkage | `lots.opening_execution_id` UNIQUE                                               |


When inserting from workflow steps, use `.insert(...).select()` + handle `23505` (unique violation) as "already processed, load existing row and continue."

## Environment variables

Required for any server process that touches Supabase:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://rjiecbvxrlctmoblqngt.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."    # server-only, bypasses RLS
```

The service role key is in the [project API settings](https://supabase.com/dashboard/project/rjiecbvxrlctmoblqngt/settings/api). Store it in `.env.local` (gitignored) and in Vercel project env vars for deployment. Never expose it to the browser.

Env vars are validated at boot by `lib/env.ts` using `@t3-oss/env-nextjs` — missing or malformed values fail fast.

## Known advisor output

- `rls_enabled_no_policy` (INFO, 15 tables) — **intentional**, see posture above. Do not "fix" by adding blanket policies.
- Any other warning from `get_advisors` should be addressed in a follow-up migration.

