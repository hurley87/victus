# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Victus Imperium** is a Farcaster Mini App — a public trading game on Base. Players mint a gladiator (one-time $5 USDC deposit), issue trade commands via public casts at `@commodus`, and the bot executes swaps from custodial arena wallets. Points are scored on volume, realized PnL, and time-in-market.

## Commands

```bash
pnpm dev            # Next.js dev server (localhost:3000)
pnpm build          # Production build
pnpm typecheck      # tsc validation (no emit)
pnpm lint           # ESLint on all .ts/.tsx
pnpm test           # Vitest one-shot
pnpm test:watch     # Vitest watch
pnpm tunnel         # Cloudflare tunnel for local webhooks
pnpm supabase:types # Regenerate lib/supabase/types.ts from DB schema
```

Run a single test file:
```bash
pnpm test lib/execution/parser.test.ts
```

## Architecture

### Tech Stack
- **Next.js 16 App Router** — Server Components by default; use `"use client"` only for providers and hooks
- **Base mainnet** — viem + wagmi; Farcaster Mini App SDK connector + Coinbase Wallet
- **Supabase** — Postgres DB; browser client is read-only/publishable, server client uses service role (bypasses RLS)
- **Privy** — Server-wallet custody (TEE); private keys never leave AWS Nitro Enclave
- **Vercel Workflow** — Durable async pipelines with retries/idempotency
- **Upstash Redis** — Rate limiting and caching
- **Neynar** — Farcaster cast delivery, managed signer, webhooks

### Provider Stack (`components/providers/index.tsx`)

Providers nest in this order: `EnvironmentProvider` → `ErudaProvider` → `WagmiProvider` → `QueryClientProvider` → `FarcasterProvider` → `UserProvider`. Each exposes a corresponding context hook:
- `useEnvironment()` — `isInBrowser`, `isInFarcasterMiniApp`
- `useFarcaster()` — Mini App SDK context, capabilities
- `useUser()` — JWT session, sign-in, profile data

### Data Fetching

All API access goes through two hooks in `hooks/`:
- `useApiQuery` — GET requests via React Query
- `useApiMutation` — POST/PUT/DELETE with optimistic updates

### Execution Pipeline (`lib/execution/`, `lib/workflows/`)

The `commodus-command.ts` Vercel Workflow is the core game loop. Cast hash + user FID serve as the idempotency key.

1. **Parse** — Regex in `lib/commodus/parser.ts`; grammar errors fall back to LLM via `lib/execution/llm-parse.ts`
2. **Policy validate** — Asset whitelist + rate limits in `lib/execution/policy.ts`
3. **Quote & prepare** — 0x API swap quote on Base, price impact guard, reserve execution record (`lib/execution/reserve.ts`)
4. **Execute** — Privy server-wallet signs and broadcasts swap (`lib/privy/server.ts`)
5. **Decode logs** — Extract execution price from Uniswap V3/V4 logs (`lib/execution/swap-logs.ts`)
6. **Fee transfer** — 0.5% collected to operator treasury (`lib/execution/fee-transfer.ts`)
7. **Score & reply** — Points calculated, Neynar reply cast published (`lib/execution/templates.ts`, `lib/scoring/score-trade.ts`)

Supporting modules: FIFO lot accounting (`lot-persistence.ts`, `lot-accounting.ts`), publish-once deduplication (`reply-guard.ts`).

### Key API Routes (`app/api/`)

| Route | Purpose |
|-------|---------|
| `/api/auth/sign-in` | Exchange Farcaster Quick Auth token for JWT |
| `/api/webhook` | Neynar `cast.created` events → durable workflow trigger |
| `/api/arena/me` | Gladiator mint status + arena balance |
| `/api/users/me` | Authenticated user profile (Neynar) |
| `/api/leaderboard/current` | Monthly top 10 |
| `/api/snaps/status/[fid]` | Public Snap card (bypasses JWT, CORS headers instead) |
| `/api/cron/reconcile` | Vercel Cron every 5 min — reconciliation + housekeeping |

### Auth & Middleware

`proxy.ts` (Next.js middleware) enforces JWT session cookie for all non-public routes. Auth flow: Farcaster Quick Auth token → `/api/auth/sign-in` → `JWT_SECRET`-signed cookie.

### Environment Variables

All env vars are validated at build time in `lib/env.ts` via `@t3-oss/env-nextjs` + Zod. Copy `.env.example` to `.env.local` for local setup.

Key groupings:
- **Public** — `NEXT_PUBLIC_URL`, `NEXT_PUBLIC_APP_ENV`, Supabase publishable key, Farcaster manifest vars
- **Auth** — `JWT_SECRET`, `NEYNAR_API_KEY`, `NEYNAR_SIGNER_UUID`, `COMMODUS_FID`
- **Infrastructure** — `SUPABASE_SERVICE_ROLE_KEY`, `PRIVY_APP_ID/SECRET`, `ZEROX_API_KEY`, `OPENAI_API_KEY`, `KV_REST_API_URL/TOKEN`
- **Admin/Cron** — `ADMIN_API_TOKEN`, `CRON_SECRET`

### Testing

Unit tests live at `lib/**/*.test.ts` and run in Node environment via Vitest. Coverage includes parser, fee calculations, intent parsing, lot accounting, swap log decoding, and reply templates.

### Database

Schema documentation is in `docs/supabase.md`. Migrations live in `supabase/`. After schema changes, regenerate types with `pnpm supabase:types` — the output goes to `lib/supabase/types.ts`.

### Structured Logging

`lib/logger.ts` exports a Pino JSON logger. Use child context (e.g., `logger.child({ castHash, step })`) for traceability through the execution pipeline.

## Documentation

- `docs/mvp.md` — Product PRD: mint flow, game loop, command parsing, leaderboard rules
- `docs/supabase.md` — Full DB schema and RLS posture
- `docs/future.md` — Post-MVP roadmap (weekly eliminations, leverage, etc.)
- `docs/commodus-trading-strategy.md` — Human-approved strategy for **Commodus Autotrader** (candidate scoring, HOLD vs trade, Neynar for context only). **Not** an extra policy layer: the app still enforces the same whitelist, trade restrictions, execution, accounting, and leaderboard as for normal players; the doc only describes how Commodus picks among already-allowed actions.

### Commodus Autotrader (decision engine)

When building or changing the autotrader **decision engine**, follow `docs/commodus-trading-strategy.md`. Do not introduce Commodus-only trade restrictions or bypasses; align scoring and narrative rules with that doc. **Update the doc** whenever scoring weights, component definitions, or strategy assumptions change in code.
