# Commodus MVP PRD

## Overview

**Commodus** is a Farcaster trading game built as a Mini App.

Users keep their existing Farcaster account, open the Mini App, create and fund an **arena wallet**, then issue **public trade commands** by casting at `@commodus`.

Commodus parses the command, validates it against the user's policy and the game rules, executes the trade from the user's arena wallet, replies publicly, and updates a live leaderboard.

At the end of each month, the top 10 players receive an airdrop of **$GLORY**, a Farcaster-native ERC-20 token.

---

## Product Thesis

Most trading products are private and utility-first.

Commodus makes trading:
- **public**
- **game-like**
- **social**
- **competitive**

The core loop is simple:

1. Join the arena
2. Fund your wallet
3. Trade in public
4. Earn points
5. Climb the leaderboard
6. Win GLORY

---

## MVP Goal

Ship a working Farcaster Mini App that proves three things:

1. users will onboard and fund an arena wallet
2. users will issue trade commands publicly on Farcaster
3. a leaderboard plus monthly rewards is enough to create engagement

The MVP should prioritize:
- clear onboarding
- simple execution flow
- credibility
- demoability
- speed of implementation

---

## Non-Goals

The MVP will **not** include:

- weekly eliminations
- Commodus making its own benchmark trades
- multiple Commodus traders
- resurrection mechanics
- advanced strategy presets
- automated push notifications
- cross-chain trading
- leverage or perps
- autonomous asset selection by the agent
- complex token utility
- LLM-generated reply copy (templates only in MVP)
- user-configurable policy limits
- NFT reward badges
- onchain GLORY distribution contracts

These are captured in `docs/future.md`.

---

## Core User Experience

### 1. Discover
A user sees a cast from or about Commodus and opens the Mini App.

### 2. Enter the Arena
The user signs in with Farcaster (Quick Auth) and reads a simple explanation of the game:
- trade in public
- only approved assets
- leaderboard is based on points
- top 10 earn GLORY monthly

### 3. Create Arena Wallet
The backend provisions a dedicated **Privy server wallet** for the user on first visit. This wallet is custodial for the MVP hackathon. Hard balance cap of **$50 USDC**.

### 4. Review Arena Rules
The user reads what Commodus can and cannot do, including:
- only 4 whitelisted tradable assets (plus USDC as quote)
- max trade size, max trades per day, wallet cap
- trades execute automatically when a command is valid

### 5. Fund Arena Wallet
The user sends USDC on Base to the arena wallet address shown in the app. The backend auto-seeds the wallet with ~$0.50 in ETH on creation to cover gas; no manual ETH funding required.

### 6. Trade in Public
The user posts a cast such as:
- `@commodus buy 25 usdc of aero`
- `@commodus sell 50% of aero`
- `@commodus status`

### 7. Commodus Executes
The backend:
- ingests the cast via Neynar webhook
- enqueues it to a Vercel Queue
- runs a durable Vercel Workflow that parses, validates, quotes, executes, and records
- replies publicly with a templated Commodus line
- updates the leaderboard

### 8. Track Performance
The user opens the Mini App to see:
- rank
- points
- realized PnL
- portfolio (holdings + cost basis)
- recent trades
- monthly standings

### 9. Monthly Reward
At the end of each UTC month, the top 10 players receive a proportional airdrop of **$GLORY**, distributed manually by the operator based on a frozen leaderboard snapshot.

---

## Target User

### Primary
Crypto-native Farcaster users who:
- enjoy competition
- understand tokens and wallets
- are comfortable trading on Base
- like public status games

### Secondary
Users who may not be active traders but like:
- social games
- public challenges
- leaderboard dynamics
- agent-driven products

---

## MVP Scope

## In Scope

### Mini App
- Farcaster sign-in (Quick Auth)
- onboarding flow
- create arena wallet (Privy server wallet)
- fund arena wallet (USDC deposit instructions)
- show game rules + grammar
- show whitelisted assets
- show leaderboard (current month)
- show portfolio + cost basis
- show trade history

### Public Trading
- users trade via public Farcaster casts at `@commodus`
- Commodus replies publicly with templated copy
- `buy`, `sell`, and `status` commands only
- fixed whitelist of 4 tradable assets + USDC
- deterministic regex grammar wrapped in an OpenAI Agents SDK agent tool
- validation and policy checks before execution

### Backend
- ingest Farcaster casts via Neynar mention webhook
- enqueue to Vercel Queue
- process via Vercel Workflow (parse → validate → quote → execute → record → reply)
- persist commands, intents, executions, lots, positions, scoring, leaderboard state in Supabase
- idempotent processing at webhook, queue, workflow, and chain layers

### Rewards
- monthly leaderboard snapshot
- top 10 users receive GLORY
- distribution is fully manual (admin CSV export + airdrop outside the app)

---

## Out of Scope

- in-app manual trading UI
- user-created strategies
- social following system
- chat threads inside app
- tournaments or divisions
- daily survival logic
- benchmark account
- dynamic asset suggestions
- advanced risk engine
- referral system
- LLM-generated reply copy
- onchain reward contracts
- NFT badges
- GLORY utility (voting, tournament entry, etc.)

---

## Product Requirements

## Identity
- users must use their existing Farcaster account
- no new Farcaster account creation
- Farcaster identity is the canonical social identity in the app

## Wallets
- each user has **one** arena wallet
- arena wallet is a **Privy server wallet** (custodial, key held server-side)
- arena wallet is separate from the user's normal trading wallet
- hard balance cap: **$50 USDC**; deposits beyond the cap are ignored for trading purposes
- auto-seeded with ~$0.50 in ETH on creation for gas
- users can withdraw at any time via an in-app "withdraw to Farcaster-verified address" action
- the arena wallet is not locked during a season

## Trade Commands

### Supported command types
- `buy`
- `sell`
- `status`

### Grammar (applied after lowercasing + whitespace collapse + stripping the `@commodus` mention)

```
command    := buy | sell-pct | status
buy        := "buy" AMOUNT "usdc" "of" SYMBOL
sell-pct   := "sell" PERCENT "%" "of" SYMBOL
status     := "status"
AMOUNT     := positive decimal, <= policy.max_trade_usdc
PERCENT    := integer 1..100
SYMBOL     := member of asset_whitelist (case-insensitive)
```

### Rules
- **single command per cast** — multi-command casts rejected
- **case-insensitive** on keywords and symbols
- **emojis and unicode whitespace stripped** before matching
- **any unrecognized token** → cast is rejected with a templated Commodus line listing the valid forms
- **percentage-only sells in MVP** — absolute-quantity sells deferred to future
- the parsed result is validated through a Zod schema before reaching the policy engine

### Examples
- `@commodus buy 25 usdc of aero`
- `@commodus buy 10 usdc of eth`
- `@commodus sell 50% of aero`
- `@commodus status`

## Asset Rules

MVP supports:
- **Base mainnet only**
- **spot trading only**
- **fixed whitelist of 5 symbols** (4 tradable + 1 quote):

| Symbol | Role | Notes |
|---|---|---|
| USDC | Quote | Required; all PnL denominated in USDC |
| WETH | Tradable | Blue-chip anchor, deep 0x routing |
| AERO | Tradable | Base-native volatility |
| DEGEN | Tradable | Farcaster-culture token |
| VIRTUAL | Tradable | Agent/AI theme alignment |

- `$GLORY` is **explicitly excluded** from the tradable whitelist and is rejected at parse time with a templated Commodus line
- USDC is the sole quote asset — no symbol-to-symbol pairs
- no leverage, no perps, no bridging
- whitelist entries live in the `asset_whitelist` table and are editable via DB (no redeploy)

## Policy Rules

Global defaults for MVP. **Not user-editable.**

| Parameter | Value |
|---|---|
| `max_trade_usdc` | 10 |
| `max_trades_per_day` | 10 |
| `wallet_cap_usdc` | 50 |
| `max_slippage_bps` | 100 (1%) |
| `max_price_impact_bps` | 300 (3%) |

- Executions exceeding any policy rule are rejected with a templated Commodus line
- Daily counters reset at **00:00 UTC**

## Execution Rules

- **Router:** 0x Swap API. One call returns quote + signable calldata.
- **Slippage:** fixed 1% max slippage on every quote.
- **Price impact:** trades reporting estimated price impact > 3% are rejected.
- **Quote freshness:** quote must be used within 30 seconds of fetch; otherwise re-quote.
- **Permit2 allowances:** first sell of a given asset from a wallet triggers an implicit `ensure_allowance` step (idempotent check-then-approve).
- **Gas:**
  - new arena wallets seeded with ~$0.50 in ETH on creation
  - if ETH balance falls below threshold before a trade, a pre-flight USDC→ETH swap tops it back up inside the same workflow run
  - users never need to manually fund ETH
- **Transaction idempotency:** each `trade_execution` row is reserved with a deterministic `execution_id` derived from `cast_hash` before the transaction is submitted. Workflow replays always check-then-submit. Never double-send.

---

## Leaderboard and Scoring

The leaderboard is game-like, but its accounting is deterministic.

### Accounting model

- **Lot** — every executed buy creates a `lot(symbol, quantity, avg_cost_usdc, opened_at)`. `avg_cost_usdc` is the effective USDC per unit *net of swap fees and gas*. This kills point-farming via micro-round-trips.
- **Close** — every executed sell consumes from existing lots **FIFO** (oldest first). A single sell may close one or many lots partially.
- **Realized PnL (per sell cast)** = `sell_proceeds_usdc_net_of_fees − Σ(lot_portion.avg_cost_usdc × lot_portion.quantity)`.
- **Realized return % (per sell cast)** = `realized_pnl ÷ Σ(lot_portion.avg_cost_usdc × lot_portion.quantity)`.

### Scoring per executed cast

| Condition | Points |
|---|---|
| Trade executed (buy or sell) | +1 |
| Sell with realized PnL ≥ **$0.25** ("profitable close") | +10 |
| Sell with realized return % ≥ **10%** | +10 bonus |
| Sell with realized return % ≥ **25%** | +25 bonus |

- The **$0.25** floor ensures the user had to move the market in their favor by a meaningful amount after fees. Prevents round-trip farming.
- Failed executions score zero and do not consume a daily scoring slot.
- Base `+1` still awarded on non-profitable sells (above the profitable-close floor → no bonuses apply).

### Daily cap
- At most **5 scoring casts per day per user**.
- "Day" = UTC calendar day; counters reset at **00:00 UTC**.
- Cast #6+ still *executes* (the user still trades) but contributes **0 points**.

### Monthly scoring period
- Scoring period = calendar UTC month, `[YYYY-MM-01 00:00 UTC, YYYY-(MM+1)-01 00:00 UTC)`.
- Leaderboard **resets monthly**.
- All-time stats retained in a separate `user_stats` table for future profile pages, **not shown in MVP UI**.

### Tiebreakers (applied in order)
1. Total points
2. Monthly realized PnL in **USDC** (absolute dollars)
3. Earlier timestamp of the last scoring cast (stable order)

### Edge cases
- **Unrealized positions at month-end**: score nothing. To score, you must close. Documented prominently on the Rules page.
- **Partial sells**: fully supported; score the sell cast once on the quantity-weighted realized PnL and return %.
- **Sell with no holding**: rejected at policy, never reaches scoring.
- **Failed on-chain execution (revert)**: `status='failed'`, zero points, slot not consumed.

### Why this design
Rewards:
- participation
- profitable trading
- bigger wins

Discourages:
- spam trading (daily cap)
- round-trip farming ($0.25 floor, fees included in cost basis)
- leaderboard cheesing via deposits (PnL denominator is absolute dollars, not percentage)

---

## Rewards & GLORY

**$GLORY** is an ERC-20 token on Base, launched via **Clanker** (a Farcaster-native token launcher). The token is deployed outside the codebase; the app references its address via env var `GLORY_TOKEN_ADDRESS`.

### What GLORY is in MVP
- earned only by placing on the monthly top 10 leaderboard
- airdropped manually by the operator, offchain from the app's perspective
- **not** tradable inside the arena (explicitly blocklisted from commands even though it's on Uniswap)

### Monthly distribution (top 10, fixed split)
Let `P = MONTHLY_GLORY_POOL` (constant, set at token launch).

| Rank | Share of Pool |
|---|---|
| 1 | 30% |
| 2 | 20% |
| 3 | 15% |
| 4 | 10% |
| 5 | 10% |
| 6–10 | 3% each (15% total) |

### Distribution flow
1. **00:00 UTC, day 1 of each month** — a Vercel cron job:
   - inserts a `reward_epochs` row with `status='snapshot_ready'`
   - freezes `leaderboard_snapshots` for the closed month (top 10 locked)
2. Operator opens `/admin/rewards/:epoch`:
   - table of top 10 with FID, username, rank, points, realized PnL, resolved recipient address, pool share
   - **"Download CSV"** button — exports `address, glory_amount` per winner
3. Operator performs the airdrop out-of-band using Clanker's built-in distro, Disperse, or a direct wallet
4. Operator pastes airdrop tx hash(es) into the admin UI → `reward_epochs.status='distributed'`
5. Commodus publishes a monthly recap cast naming the top 10

### Recipient address resolution
In order of preference:
1. User's **Farcaster-verified address** (first entry in `verifications[]` from Neynar)
2. Farcaster **custody address** (fallback)
3. **Arena wallet address** (last resort; flagged because arena wallets will be orphaned at the A→B custody migration)

Recorded in `reward_epochs` for audit.

---

## Commodus Voice

Commodus should feel imperial and theatrical, but never unclear.

### Tone
- Roman
- concise
- authoritative
- playful
- readable

### Reply policy (MVP)
- **Templated** — never LLM-generated. Voice is deterministic. (LLM-generated copy deferred to future.)
- **One reply per parent cast.** No self-threading.
- **Reply-failure ≠ trade-failure.** If the cast publish fails, the trade is still executed and recorded. The reply is retried via the workflow.

### Template examples

**Successful trade**
- "Order accepted. 25 USDC deployed into AERO."
- "The decree is carried out. Sold half thy AERO for 13.40 USDC. +2.40 realized."
- "Commodus has entered the market on thy behalf."

**Status reply (public, with deep link)**
- "Rank 17. 42 points. Portfolio 38.12 USDC. View the full ledger: {deep_link}"

**Grammar rejection**
- "Speak as Rome taught you, gladiator. Valid decrees: `buy N usdc of SYMBOL`, `sell N% of SYMBOL`, `status`."

**Policy rejection**
- "Order denied. Asset not approved for this arena."
- "Order denied. The decree exceeds thy allotted size."
- "Commodus refuses. This trade violates the laws of the arena."

**GLORY purchase attempt**
- "GLORY is earned in the arena, not purchased in the market. Order denied."

**Market-condition rejection**
- "The arena does not deal in such violent movements. Order denied."

---

## Technical Architecture

### Stack
- **Next.js App Router** (16.x) + React 19
- **builders-garden/farcaster-miniapp-starter** as the base (already in place)
- **Supabase** — Postgres for all game state; `supabase-js` client, no ORM in MVP
- **Upstash Redis** — webhook idempotency (`SETNX cast:{hash}`), rate limits, session state
- **Vercel** — hosting, Fluid compute, cron
- **Vercel Queues** (public beta) — cast-command ingress queue
- **Vercel Workflow** (beta) — durable multi-step trade pipeline
- **Neynar** — cast webhooks, `@commodus` reply publishing (managed signer already provisioned)
- **Privy** — server wallet provisioning and signing (Option A custody for hackathon)
- **0x Swap API** — DEX routing on Base
- **OpenAI Agents SDK** (`@openai/agents`) — agent runtime for command parsing (expands post-MVP)
- **Clanker** — external, used to launch `$GLORY` as an ERC-20 on Base
- **viem / wagmi** — chain interaction (already in deps)

### Durable Execution Architecture

The trade pipeline is the highest-stakes path in the system. It is designed so that no partial failure can result in a double-executed trade or a lost cast.

```
Farcaster user casts "@commodus buy 10 usdc of aero"
          │
          ▼
Neynar mention webhook ─▶ POST /api/webhooks/neynar
                              • verify X-Neynar-Signature (HMAC)
                              • Redis SETNX cast:{hash} TTL 60s   ◀── fast idempotency guard
                              • insert cast_commands row           ◀── durable idempotency
                                (unique on cast_hash)
                              • enqueue {cast_hash} to Vercel Queue
                              • return 200 (<100ms)
          │
          ▼
Vercel Queue "trade-commands"
          │
          ▼
Vercel Workflow process-trade-command   (each bullet = 'use step', checkpointed)
          │
          ├─ load_command(cast_hash)         — replay guard; terminal status → return
          ├─ agent_parse(cast_text)          — OpenAI Agents SDK, Zod-validated tool emit_trade_intent
          ├─ policy_validate(intent)         — whitelist, sizes, balance, daily cap, wallet cap
          ├─ quote(intent)                   — 0x Swap API; slippage, price-impact gating
          ├─ reserve_execution(cast_hash)    — insert trade_executions row with deterministic execution_id
          ├─ ensure_allowance(symbol)        — Permit2 one-time approval, idempotent
          ├─ sign_and_submit(quote)          — Privy server wallet; only if trade_executions.tx_hash IS NULL
          ├─ wait_for_confirmation(tx_hash)  — revert → mark failed, no score
          ├─ update_lots_and_positions       — FIFO bookkeeping, deterministic from execution
          ├─ score_trade                     — append scoring_events rows, respecting daily cap
          ├─ publish_reply_cast              — templated; unique on (cast_hash, reply_kind)
          └─ finalize_command                — cast_commands.status → terminal
```

Idempotency strategy summary:
- **Webhook layer:** Redis `SETNX` + Postgres unique constraint on `cast_hash`
- **Queue layer:** Vercel Queue's own idempotency keys
- **Workflow layer:** every step is pure or idempotent check-then-act
- **Chain layer:** `trade_executions` row reserved *before* tx submission; replays see the reservation and skip re-submission

### Fallback plan if Vercel Queues/Workflow beta churn

If either beta product becomes unreliable during the hackathon, drop to:
- **Upstash QStash** as the queue
- A hand-rolled state machine in Supabase (`cast_commands.status` column drives transitions)
- Step functions become simple serverless functions that mutate the row

The interfaces are compatible; the primitives are swappable. **Documented, not built.**

### Agent Scope: MVP vs Future

The OpenAI Agents SDK is in the MVP for one reason: it gives Commodus the scaffolding to become an autonomous Farcaster entity later without a rewrite.

**MVP tool surface (single tool):**
- `emit_trade_intent(intent: TradeIntentSchema)` — called by the agent after parsing a cast

That's it. The agent does **not** choose what to trade, write reply copy, or post anything autonomously in MVP.

**Post-MVP tool surface (roadmap, see `docs/future.md`):**
- `publish_commentary_cast(text)` — scheduled market commentary for marketing
- `query_market_state(symbol)` — for Commodus's own benchmark wallet (Phase 2)
- `decide_benchmark_trade()` — autonomous trading by Commodus
- `reply_to_non_command_cast(cast_hash)` — in-character responses to replies

---

## Data Model

Tables in Supabase. All `id` columns are `uuid` unless noted. `created_at`/`updated_at` implied where applicable.

### `users`
- id
- created_at
- updated_at

### `farcaster_accounts`
- id
- user_id
- fid (unique)
- username
- display_name
- pfp_url
- verifications (jsonb array)

### `arena_wallets`
- id
- user_id (unique — one per user in MVP)
- wallet_address (unique)
- privy_wallet_id
- status ('active' | 'closed')
- created_at

### `wallet_policies`
- id
- wallet_id (unique)
- max_trade_usdc
- max_trades_per_day
- wallet_cap_usdc
- active
- created_at

### `asset_whitelist`
- id
- symbol (unique)
- name
- address (Base)
- decimals
- is_tradable (boolean; USDC is false)
- is_blocklisted (boolean; GLORY is true)
- active

### `cast_commands`
- id
- fid
- cast_hash (**unique**)
- text
- parsed_action ('buy' | 'sell' | 'status' | null)
- parsed_symbol
- parsed_amount
- parsed_percent
- status ('received' | 'parsed' | 'validated' | 'quoted' | 'executing' | 'executed' | 'failed' | 'rejected')
- error_reason
- created_at

### `trade_intents`
- id
- cast_command_id
- wallet_id
- action ('buy' | 'sell')
- asset_symbol
- amount_type ('usdc_in' | 'percent_out')
- amount_value
- status
- created_at

### `trade_executions`
- id
- trade_intent_id
- execution_id (**unique**, deterministic from cast_hash — chain idempotency key)
- tx_hash (nullable until submitted)
- execution_price_usdc
- quantity
- notional_usdc
- fees_usdc (swap + gas)
- status ('pending' | 'submitted' | 'confirmed' | 'reverted' | 'failed')
- created_at
- confirmed_at

### `lots`
- id
- wallet_id
- asset_symbol
- initial_quantity
- remaining_quantity
- avg_cost_usdc (per unit, net of fees)
- opening_execution_id
- opened_at
- closed_at (nullable)

### `lot_closures`
- id
- lot_id
- closing_execution_id
- quantity_closed
- avg_cost_usdc_at_close
- realized_pnl_usdc
- realized_return_pct
- closed_at

### `positions` *(materialized summary; derivable from lots)*
- id
- wallet_id
- asset_symbol (unique per wallet)
- quantity
- avg_cost_usdc
- updated_at

### `scoring_events`
- id
- user_id
- cast_command_id
- execution_id (nullable for compound events)
- event_type ('trade_executed' | 'profitable_close' | 'return_10_bonus' | 'return_25_bonus')
- points
- month (YYYY-MM)
- counted_in_daily_slot (boolean — false for events past the 5/day cap)
- created_at

### `leaderboard_snapshots`
- id
- user_id
- month (YYYY-MM, unique with user_id)
- points
- realized_pnl_usdc
- rank
- captured_at (null until frozen at month-end)

### `user_stats` *(all-time, not shown in MVP UI)*
- user_id (unique)
- total_points
- total_realized_pnl_usdc
- months_active
- updated_at

### `reward_epochs`
- id
- month (unique)
- status ('pending_snapshot' | 'snapshot_ready' | 'distributed' | 'partial')
- pool_glory_amount
- snapshot_at
- distributed_at
- airdrop_tx_hashes (jsonb array)
- created_at

---

## API / Backend Requirements

### Auth / App
- `POST /api/auth/siwf` — Farcaster Quick Auth callback
- session handling

### Wallets
- `POST /api/wallets` — create arena wallet (idempotent by user)
- `GET /api/wallets/me` — status, address, balance, policy
- `POST /api/wallets/withdraw` — withdraw to Farcaster-verified address

### Farcaster ingestion
- `POST /api/webhooks/neynar` — verify signature, dedupe, enqueue

### Trading (internal, invoked by Workflow steps)
- parser (agent tool)
- policy validator
- quote fetcher
- executor
- replier

### Leaderboard (read-side)
- `GET /api/leaderboard/current` — current month standings
- `GET /api/leaderboard/me` — user's rank + stats
- `GET /api/leaderboard/trades/recent` — recent public executions
- `GET /api/users/:fid/portfolio` — holdings + recent trades

### Rewards
- `GET /api/admin/rewards/:epoch` — top 10 + CSV export (admin only)
- `POST /api/admin/rewards/:epoch/distributed` — mark distributed + record tx hashes

### Cron
- `0 0 1 * *` — monthly leaderboard snapshot job

---

## Functional Requirements

### Onboarding
- user can sign in with Farcaster
- user can create arena wallet (one-click, backend-provisioned)
- user can see wallet address + QR
- user can fund wallet by sending USDC
- user can see approved assets and grammar before trading
- user can withdraw to Farcaster-verified address at any time

### Trade Execution
- user can issue a supported public trade command
- system parses valid commands via agent + Zod schema
- system rejects invalid commands with templated Commodus reply
- system executes valid trades durably via Vercel Workflow
- system publishes public confirmation or rejection
- each cast is processed exactly once (idempotent at 4 layers)

### Leaderboard
- leaderboard updates from stored executions and closed trades
- FIFO lot accounting is authoritative
- points and rank are visible in app
- user's portfolio, cost basis, and recent trades are visible in app

### Rewards
- system determines monthly winners automatically at month rollover
- system exposes CSV export of winners
- operator performs airdrop out-of-band
- operator marks epoch distributed with tx hashes

---

## UX Requirements

### Arena page (home)
Must show:
- arena wallet address + QR
- wallet balance (USDC + ETH-for-gas)
- approved assets
- how to trade (exact grammar)
- sample commands
- daily trade slots remaining
- wallet cap remaining

### Portfolio page
Must show:
- holdings (symbol, quantity, avg cost, current value)
- total portfolio value in USDC
- realized PnL (month + all-time)
- recent trades (ten most recent)

### Leaderboard page
Must show:
- rank, username, points, realized PnL (USDC), last trade time
- user's own row highlighted
- current month label

### Rules page
Must show:
- exact command grammar
- full whitelist
- scoring formula + daily cap + monthly reset
- $0.25 profitable-close floor explanation
- how monthly GLORY airdrop works
- policy limits (trade size, daily cap, wallet cap)

### Admin pages (operator only, allowlisted FID)
- `/admin/rewards/:epoch` — leaderboard snapshot + CSV export + mark-distributed

---

## Security and Trust Requirements

- verify all incoming Farcaster webhook requests (Neynar HMAC signature)
- keep trade execution secrets server-side only
- Privy server wallet keys never leave Privy infrastructure
- enforce hard asset whitelist (and blocklist for GLORY)
- enforce max trade size, max daily trade count, wallet cap
- enforce max slippage (1%) and price-impact cap (3%)
- do not execute unparseable commands
- do not allow duplicate processing of the same cast (4-layer idempotency)
- transaction submission is always idempotent (reserve-then-submit)
- log all command, validation, execution, and reply events
- show the user: their address, their balance, their trades, their PnL — every decision auditable

Trust is critical because the product asks users to fund a wallet that Commodus controls. The $50 wallet cap is the core risk mitigation for MVP custody; migration to non-custodial delegated execution (Option B) is the first post-hackathon task.

---

## Known MVP Compromises

These are conscious tradeoffs for hackathon velocity. Each has a planned resolution.

| Compromise | Reason | Resolution |
|---|---|---|
| Privy **server wallets** (Option A custody) | Zero consent UX, one call to provision | Migrate to Privy embedded wallet + delegated actions (Option B) before any public launch. See `future.md` "Post-Hackathon Custody Migration". |
| **$50 USDC wallet cap** enforced in deposit-handling | Caps blast radius of custodial design | Lift cap when Option B is live. |
| **Vercel Queues / Workflow** both in public beta | New primitives, best-fit DX | If unreliable, fall back to Upstash QStash + Supabase state machine; no code redesign needed. |
| **Templated reply copy only** (no LLM replies) | Deterministic voice, safer for money-moving flows | Agent grows a `publish_cast` tool post-MVP; voice is then LLM-curated with guardrails. |
| **Manual offchain GLORY airdrops** | No contract, zero smart-contract risk for MVP | Optionally automate via a `Distributor` contract + merkle airdrops post-MVP. |
| **Single-region Supabase, no DR** | Not a hackathon concern | Supabase multi-region/read replicas when traffic warrants. |
| **Admin UI gated by single allowlisted FID** | Simple auth for one operator | Role-based access when team grows. |
| **No rate limiting beyond policy caps** | Policy caps are sufficient at hackathon scale | Add IP/FID rate limits before public launch. |
| **Base mainnet from day one** (no staging chain) | Real assets make the demo real | Add Base Sepolia staging environment if team grows. |

---

## Success Metrics

### MVP success metrics
- number of users who sign in
- number of users who create arena wallets
- number of funded wallets
- number of public trade casts
- command parse success rate
- trade execution success rate
- weekly active traders
- number of users who trade more than once
- leaderboard page views
- month-1 airdrop recipients (target: 10 eligible winners)

### Demo success
A successful demo should show, in order:
1. A first-time user signs in with Farcaster
2. Arena wallet is provisioned, address shown
3. User deposits USDC (pre-demo)
4. User posts `@commodus buy 10 usdc of aero` from Farcaster
5. Commodus replies publicly within seconds
6. Mini App shows updated portfolio + rank
7. User posts `@commodus sell 50% of aero`
8. Commodus replies publicly with realized PnL
9. Leaderboard page shows the user climbing

---

## Launch Choreography

Order of operations for going live:

1. **Infrastructure ready** — Supabase schema applied, Vercel deployment live, Neynar webhook pointed at prod URL, Privy app configured, 0x API key in place.
2. **Seed wallet prepped** — small ETH reserve to auto-seed new arena wallets.
3. **`@commodus` FID profile polished** — bio, pfp, pinned cast explaining the game.
4. **First `reward_epoch` row created** for the launch month.
5. **Commodus casts the `$GLORY` launch** via Clanker: *"Rome proclaims its coin. @clanker launch GLORY — supply N, ticker $GLORY."*
6. **Commodus casts the arena opening:** *"The arena opens. Speak thy decrees: `@commodus buy N usdc of SYMBOL`. Glory awaits."*
7. **Public trading begins.**
8. **End of month:** leaderboard freezes automatically; operator exports CSV; airdrop completed; recap cast published.

---

## Open Questions

Most prior open questions resolved during grilling. Remaining:

- **Exact `MONTHLY_GLORY_POOL` value** — set at `$GLORY` Clanker launch.
- **Whether to backfill pre-launch testing data** before first real month, or start fresh. Low-stakes; operator preference.
- **Whether to manually bless the first few users** (seed some traders before public launch) vs. open immediately. Marketing decision.

---

## Suggested Build Order

### Phase 1 — Foundation (built on existing starter)
- apply Supabase schema + RLS policies
- wire `supabase-js` client into the existing starter
- confirm Farcaster Quick Auth sign-in flow works end-to-end
- add `asset_whitelist` seed data (USDC, WETH, AERO, DEGEN, VIRTUAL; GLORY blocklisted)
- add admin-FID allowlist env var

### Phase 2 — Arena wallet
- integrate Privy SDK for server-wallet provisioning
- implement `POST /api/wallets` (creates Privy server wallet, seeds ~$0.50 ETH)
- implement `GET /api/wallets/me` (status + balances)
- implement `POST /api/wallets/withdraw`
- Arena page UI with address, QR, balance, sample commands
- Rules page with grammar + whitelist + scoring

### Phase 3 — Cast ingestion + pipeline
- implement `POST /api/webhooks/neynar` with HMAC verification + Redis idempotency + Supabase insert
- stand up Vercel Queue `trade-commands`
- stand up Vercel Workflow `process-trade-command` with all durable steps
- integrate `@openai/agents` with `emit_trade_intent` tool + Zod schema
- integrate 0x Swap API for quoting + calldata
- implement Permit2 allowance step
- implement transaction submission via Privy
- implement templated reply publishing via Neynar

### Phase 4 — Scoring + UI
- implement FIFO lot accounting (`lots`, `lot_closures`)
- implement scoring event log + daily cap logic
- Leaderboard page UI (current month)
- Portfolio page UI (holdings + cost basis + realized PnL)
- `status` command support (public reply + deep link)

### Phase 5 — Rewards + polish
- monthly snapshot cron
- `/admin/rewards/:epoch` UI with CSV export + mark-distributed
- copy pass on all Commodus replies
- demo script dry run
- `$GLORY` launched via Clanker the day before public opening

---

## One-Line Product Definition

**Commodus is a Farcaster trading game where users fund an arena wallet, trade in public, climb the leaderboard, and earn GLORY.**
