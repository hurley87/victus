# Commodus MVP PRD

## Overview

**Commodus** is a Farcaster trading game built as a Mini App.

Users keep their existing Farcaster account, open the Mini App, designate one of their Farcaster-verified wallet addresses as their **arena address**, then issue **public trade commands** by casting at `@commodus`.

Commodus parses the command, validates it against the user's policy and the game rules, publishes an **intent reply as a Farcaster Snap cast**, and — after the user taps the Snap inline in their feed and signs the resulting `swap_token` action in their own wallet — records the executed trade, replies publicly, and updates a live leaderboard.

Execution is **non-custodial**. The server never holds keys, never holds USDC, and never pays gas.

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
2. Designate your arena address
3. Trade in public (sign swaps in your own wallet)
4. Earn points
5. Climb the leaderboard
6. Win GLORY

---

## MVP Goal

Ship a working Farcaster Mini App that proves three things:

1. users will onboard and designate an arena address
2. users will issue trade commands publicly on Farcaster and sign the resulting swap in their own wallet
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

### 3. Designate Arena Address
The user picks one of their existing Farcaster-verified wallet addresses as their **arena address**. No new wallet is provisioned. The server persists the choice and scopes all scoring to swaps signed from this address.

### 4. Review Arena Rules
The user reads what Commodus can and cannot do, including:
- only 4 whitelisted tradable assets (plus USDC as quote)
- max trades per day
- trade size is chosen by the user in their own wallet at signing time
- trades execute only when the user signs the swap themselves, inline in the Farcaster cast

### 5. First Trade
The user posts a cast such as:
- `@commodus buy 25 usdc of aero`
- `@commodus sell 50% of aero`
- `@commodus status`

### 6. Commodus Publishes the Intent
The backend:
- ingests the cast via Neynar webhook
- enqueues it to a Vercel Queue
- runs a durable Vercel Workflow that parses, validates, and publishes an **intent reply cast whose embed is a Farcaster Snap URL** hosted by Commodus

### 7. User Signs the Swap
The Farcaster client renders the Snap inline in the reply cast. The user sees a one-line summary (e.g. "Buy AERO with USDC") and taps **Confirm**. The Snap server responds with a `swap_token` action pinned to `{ sellToken, buyToken }`; the client opens the user's native wallet with the swap pre-filled. The user chooses the amount, signs, and pays gas. The tx hash is captured back at the server, which verifies it on Base, records the execution, scores the trade, and publishes an **outcome reply cast**. If the user abandons the signing dialog, nothing is executed and nothing is scored.

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
- designate arena address (one of the user's Farcaster-verified EOAs)
- show game rules + grammar
- show whitelisted assets
- show leaderboard (current month)
- show portfolio + cost basis
- show trade history

### Farcaster Snap (execution surface)
- a server endpoint at `POST /snaps/arena/:cast_hash` returning Farcaster Snap responses
- JFS-verified interaction envelope for every button tap
- renders a one-line confirm UI, then emits a `swap_token` action pinned to `{ sellToken, buyToken }`
- no in-Snap amount field; amount is chosen by the user in the native wallet sheet

### Public Trading
- users trade via public Farcaster casts at `@commodus`
- Commodus replies publicly with templated copy
- `buy`, `sell`, and `status` commands only
- fixed whitelist of 4 tradable assets + USDC
- deterministic regex grammar with LLM fallback via Vercel AI SDK `generateObject` + Zod `TradeIntentSchema`
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
- each user has **one** arena address
- the arena address is **one of the user's existing Farcaster-verified EOAs** (selected from `verifications[]`)
- the server never holds keys, never holds balances, and never pays gas
- the user signs every trade in their own native wallet via the Farcaster Snap's `swap_token` action, rendered inline in the intent reply cast; the user pays gas in ETH from that wallet
- the arena address can only be changed by an explicit re-designation flow (out of scope for MVP — set once at onboarding)
- only swaps whose `from` address equals the designated arena address count toward scoring; trades signed from any other wallet are off-game by construction

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
AMOUNT     := positive decimal (suggestion only; the user picks the actual size in their wallet)
PERCENT    := integer 1..100
SYMBOL     := member of asset_whitelist (case-insensitive)
```

`AMOUNT` and `PERCENT` are treated as **display hints** on the intent reply cast, not as enforcement values. The Farcaster `swap_token` action does not accept a sell-amount parameter, so the user picks the final size in their native wallet regardless of what the cast said. Scoring is based on what the user actually signed, not what they announced.

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

| Parameter | Value | Enforced at |
|---|---|---|
| `max_trades_per_day` | 10 | pre-fill time (intent-reply gate) |
| `max_price_impact_bps` | 300 (3%) | score time (realized fill vs. reference 0x quote) |

- Trade size is **not capped**. The Farcaster Snap `swap_token` action does not take a sell-amount parameter; size is a pure wallet-side decision. Points accrue for executed buys and sells regardless of notional.
- Intents exceeding a pre-fill-time rule are rejected with a templated Commodus line and no intent reply publishes
- Executions that exceed a score-time rule are recorded with `status='failed'` and a structured `failure_reason`; the outcome reply names the reason
- Daily counters reset at **00:00 UTC**

Columns retained in the schema but **not used for enforcement** in MVP, kept for continuity with future versions that may reintroduce custodial or quoted modes:
- `wallet_cap_usdc` — server cannot see user balance in non-custodial mode
- `max_slippage_bps` — native wallet owns slippage selection

The `max_trade_usdc` column is **scheduled for removal** from `wallet_policies` (tracked in the implementation issue). It is neither enforced nor surfaced in MVP UI.

## Execution Rules

- **Execution surface:** a Farcaster Snap hosted at `POST /snaps/arena/:cast_hash`. The snap response emits a `swap_token` action pinned to `{ sellToken, buyToken }`. The user's native wallet handles amount entry, routing, allowances, slippage selection, and gas.
- **Whitelist (pre-fill enforcement):** the server will only pin `sellToken` / `buyToken` to whitelisted symbols. Non-whitelisted casts are rejected at parse time with a templated reply, and no intent cast is published.
- **Daily rate limit (pre-fill enforcement):** a user at `max_trades_per_day` gets a cooldown reply and no intent cast is published until the UTC rollover.
- **Price impact (score-time enforcement):** after the tx confirms, the server compares realized fill vs. a reference 0x quote. Impact > 3% → `status='failed'`, reason `price_impact`, no points.
- **Size:** chosen by the user in their native wallet. Not server-enforced, not capped. Scoring treats any confirmed swap as a valid trade.
- **Slippage:** owned by the user's native wallet. Not server-enforced.
- **Gas:** paid by the user from their own ETH balance on Base. No server-side seeding, no pre-flight top-up, no seeder wallet.
- **Transaction idempotency:** the chain-layer idempotency key is `trade_executions.tx_hash` (unique). There is no reserve-before-submit because the server never submits. Replays of the tx-hash ingestion path with the same `tx_hash` are no-ops.

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
1. User's **designated arena address** (already validated to be one of the user's Farcaster `verifications[]` at designation time)
2. Any other entry in `verifications[]` (if the designated address is no longer listed at snapshot time)
3. Farcaster **custody address** (fallback)

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
- "The arena grants only ten decrees per day. Return at the next dawn."
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
- **Farcaster Snaps** — the entire trade-signing execution surface. Commodus hosts a snap server (Hono handlers on Fluid compute) that returns [SnapResponse](https://docs.farcaster.xyz/snap/llms.txt) JSON, renders a one-tap confirm inline in the intent reply cast, and emits a `swap_token` action that opens the user's native wallet pre-pinned to the right token pair.
- **`@farcaster/miniapp-sdk`** — retained **only** for sign-in (Quick Auth) and Mini App context (safe-area insets, `isInMiniApp`, capabilities). Not on the trade-execution path.
- **0x Swap API** — optional, used only for server-side reference quotes at score time (price-impact sanity check). Not on the execution path.
- **Vercel AI SDK** (`ai`, `@ai-sdk/workflow`) — `generateObject` for MVP command parsing; graduates to `WorkflowAgent` post-MVP when Commodus gains autonomous tools. Models routed via **Vercel AI Gateway**.
- **Clanker** — external, used to launch `$GLORY` as an ERC-20 on Base
- **viem / wagmi** — chain interaction (already in deps)

### Alternatives considered

The execution surface for user-signed trades was the biggest architectural call for MVP. Three options were evaluated; MetaMask Snaps were eliminated first, then the decision came down to Farcaster Mini App SDK vs. Farcaster Snaps.

**Farcaster Snaps (chosen).** A Farcaster Snap is a server endpoint that returns a small JSON `SnapResponse` describing inline UI (buttons, text, inputs) and actions. Farcaster clients render the snap **inside the cast itself** — no navigation, no Mini App launch, no embedded webview. Supported actions include `swap_token({ sellToken, buyToken })` and `send_token({ token, amount })`. The `swap_token` action pins the token pair but deliberately does **not** accept a sell-amount parameter; the user's native wallet owns amount entry. One tap in the cast, one signature in the wallet the user already trusts, zero client navigation.

**Farcaster Mini App SDK `swapToken` (eliminated).** `sdk.actions.swapToken({ sellToken, buyToken, sellAmount })` from `@farcaster/miniapp-sdk`. Does accept a `sellAmount`, which originally looked attractive for size-capped trading. Eliminated for MVP because:

1. **Context switch.** The user has to tap the cast embed, wait for the Mini App to hydrate the intent, then sign. Snaps render the confirm button directly in the feed with no load step.
2. **The amount argument is advisory anyway.** The Mini App SDK pre-fills `sellAmount`, but the user can freely edit it in the native wallet sheet. We would ship server-side enforcement for a constraint the wallet doesn't actually hold. Snaps drop the pretense entirely: size is user-determined, scoring is based on what confirmed.
3. **Duplicated surface area.** A Mini App signing page needs its own route, its own hydration query, its own error states, its own retry UI. A snap endpoint is stateless JSON.

**MetaMask Snaps (eliminated).** Sandboxed JS plugins inside the MetaMask browser extension — a different product from Farcaster Snaps despite the name collision. Eliminated because:

1. **Install friction.** Requires MetaMask installed *and* Snap install approval. Our traffic surface is Farcaster casts, where most users sign with their Farcaster client's embedded wallet.
2. **Wallet lock-in.** MetaMask-only; Farcaster Snaps run in every Farcaster client.
3. **Re-solves solved problems.** A MetaMask Snap would have to own routing, allowances, slippage, and fee estimation; Farcaster Snaps delegate all of those to the native wallet.

**When a dedicated signing surface becomes interesting.** Post-MVP, if we introduce order types that `swap_token` can't express (TWAP, stop-loss, conditional orders), a custom signing UI becomes valuable. At that point the decision is "dedicated web-app signing page vs. MetaMask Snap" — the Farcaster Snap is purpose-built for one-shot spot swaps, not programmable order types.

### Durable Execution Architecture

The trade pipeline is split into two phases. The server owns everything up to the swap signature, and everything after the tx hash arrives. The user owns the signature itself — that is the security boundary.

```
Farcaster user casts "@commodus buy 10 usdc of aero"
          │
          ▼
Neynar mention webhook ─▶ POST /api/webhooks/neynar
                              • verify X-Neynar-Signature (HMAC)
                              • Redis SETNX cast:{hash} TTL 60s
                              • insert cast_commands row (unique on cast_hash)
                              • enqueue {cast_hash} to Vercel Queue "trade-commands"
                              • return 200 (<100ms)
          │
          ▼
Vercel Queue "trade-commands"
          │
          ▼
Vercel Workflow process-trade-command — PHASE 1 (intent)
          │    each bullet = 'use step', checkpointed
          ├─ load_command(cast_hash)              replay guard; terminal status → return
          ├─ parse_command(cast_text)             regex pre-filter; LLM fallback via generateObject + Zod
          ├─ policy_validate(intent)              whitelist + daily-rate-limit cap (no size cap)
          ├─ build_snap_embed_url(intent)         derive /snaps/arena/<cast_hash>
          └─ publish_intent_reply_cast(...)       unique on (cast_hash, reply_kind='intent')
                                                   embed URL = snap endpoint
                                                   → cast_commands.status = 'awaiting_swap'

    ~~~ the workflow run ends here; the user now drives the next event ~~~

Farcaster client renders snap inline in the reply cast
          │
          ├─ Client: GET/POST /snaps/arena/:cast_hash (with JFS-signed envelope)
          ├─ Snap server: verify JFS, hydrate parsed intent, return SnapResponse with
          │               action = swap_token({ sellToken, buyToken })
          ├─ Client: opens native wallet sheet pre-pinned to the pair
          └─ User signs (chooses amount, pays gas) → tx broadcasts on Base

    ~~~ tx hash capture path — see open question below ~~~

Tx hash delivered back to server (exact mechanism TBD — tracked in the snap
execution issue; candidates: snap action result callback, post-swap snap
re-entry, or onchain event listener keyed on the arena address)
          │
          ▼
POST /api/executions/confirm { cast_hash, tx_hash, from_address }
                              • assert from_address == arena_wallets.wallet_address
                              • enqueue {cast_hash, tx_hash} to Vercel Queue "trade-confirmations"
                              • return 200
          │
          ▼
Vercel Workflow process-trade-confirmation — PHASE 2 (confirm)
          │
          ├─ verify_tx_onchain(tx_hash)           viem on Base; wait 1 confirmation
          ├─ decode_swap_log(receipt)             realized amounts; reason codes on mismatch
          ├─ score_time_enforcement               non_whitelisted / price_impact checks
          ├─ record_execution                     insert trade_executions (unique on tx_hash)
          ├─ update_lots_and_positions            FIFO bookkeeping, deterministic from execution
          ├─ score_trade                          append scoring_events, respecting daily cap
          └─ publish_outcome_reply_cast           templated; unique on (cast_hash, reply_kind='outcome')
                                                   → cast_commands.status = 'executed' | 'failed'
```

Idempotency strategy summary:
- **Webhook layer:** Redis `SETNX` + Postgres unique constraint on `cast_hash`
- **Snap layer:** every snap POST carries a JFS envelope the server verifies against the FID's signer; the snap handler is a stateless function of `(cast_hash, parsed_intent)` and safe to re-render on retries
- **Queue layer:** Vercel Queue idempotency keys (`cast_hash` for phase 1, `tx_hash` for phase 2)
- **Workflow layer:** every step is pure or idempotent check-then-act; reply publishing is guarded by a unique `(cast_hash, reply_kind)` row so intent and outcome replies publish exactly once each
- **Chain layer:** `trade_executions.tx_hash` unique. The server never submits a tx, so there is nothing to reserve; chain-layer dedup relies purely on the hash arriving from the user's signed transaction.

**Open question (tracked in the snap execution issue):** the exact mechanism by which `tx_hash` is delivered from the user's wallet back to the server after `swap_token` is not yet finalized. Three candidates:
1. The Farcaster client returns the tx hash to the snap server on the next snap POST (snap re-entry).
2. A dedicated snap action result callback URL.
3. Fall back to a viem listener on the arena address watching for `Swap` events on whitelisted pools, keyed to the `awaiting_swap` cast within a time window.

Option 3 is the guaranteed-to-work safety net; 1 and 2 are preferred if they are supported. This will be resolved during the snap execution prototype.

### Fallback plan if Vercel Queues/Workflow beta churn

If either beta product becomes unreliable during the hackathon, drop to:
- **Upstash QStash** as the queue
- A hand-rolled state machine in Supabase (`cast_commands.status` column drives transitions)
- Step functions become simple serverless functions that mutate the row

The interfaces are compatible; the primitives are swappable. **Documented, not built.**

### Agent Scope: MVP vs Future

The MVP uses the **Vercel AI SDK** (`ai` package) because it runs on the same primitives as the rest of the trade pipeline — Vercel Workflow, Fluid compute, AI Gateway — with zero rewrite when Commodus graduates from "parser" to "autonomous entity."

**MVP approach — structured output, not a tool loop:**
- Parsing is a single `generateObject` call bound to `TradeIntentSchema` (Zod), wrapped in a `'use step'` workflow step for durability + retries.
- A deterministic regex pre-filter handles the happy-path grammar cheaply; the LLM is invoked only on regex miss, which keeps cost and latency predictable.
- The same `TradeIntentSchema` is reused by the policy engine and by tests — one source of truth.
- **No** tool-loop runtime in MVP. No approvals, no multi-turn agent reasoning, no autonomous posting. Just extract an intent.

**Post-MVP — graduate to `WorkflowAgent` (`@ai-sdk/workflow`):**
When Commodus grows a real tool surface, each of these becomes a durable workflow step (`'use step'`) attached to a single `WorkflowAgent`. Migration is additive; the MVP `TradeIntentSchema` and workflow structure stay intact.
- `publish_commentary_cast(text)` — scheduled market commentary for marketing
- `query_market_state(symbol)` — for Commodus's own benchmark wallet (Phase 2)
- `decide_benchmark_trade()` — autonomous trading by Commodus (multi-step tool loop, gated by `needsApproval` where appropriate)
- `reply_to_non_command_cast(cast_hash)` — in-character responses to replies

**Why Vercel AI SDK over OpenAI Agents SDK:**
- Native fit with Vercel Workflow (`'use step'` tools, suspension survives process restarts).
- Model-agnostic via AI Gateway — swap `openai/gpt-5-mini` for parsing with `anthropic/claude-sonnet-4-6` for reasoning without code changes.
- `generateObject` is the right primitive for the MVP task; no agent loop needed until there's a tool surface to loop over.

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
- wallet_address (unique — must be one of the user's Farcaster `verifications[]`)
- source (`'user_verified'`; reserved for future values if the product ever re-adds server wallets)
- status ('active' | 'closed')
- created_at

### `wallet_policies`
- id
- wallet_id (unique)
- max_trades_per_day
- wallet_cap_usdc (retained for schema continuity; not enforced in non-custodial MVP since the server never sees the user's wallet balance)
- active
- created_at

> `max_trade_usdc` was present in the initial schema migration but is **scheduled for removal**. Size is user-determined in the Snap flow; the column is neither enforced nor surfaced. The drop migration is tracked in the snap execution issue.

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
- status ('received' | 'parsed' | 'validated' | 'awaiting_swap' | 'executed' | 'failed' | 'rejected' | 'abandoned')
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
- tx_hash (**unique** — the chain-layer idempotency key; supplied by the user's signed tx)
- from_address (must match the user's `arena_wallets.wallet_address`)
- execution_price_usdc
- quantity
- notional_usdc
- fees_usdc (swap fees; gas is paid by the user and not captured)
- failure_reason (nullable; `'non_whitelisted_token'`, `'price_impact'`, `'wrong_from_address'`, `'unknown'`)
- status ('confirmed' | 'reverted' | 'failed')
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
- `POST /api/auth/siwf` — Farcaster Quick Auth callback (Mini App session)
- JFS verification on every snap POST (Farcaster-signed envelope verified against the FID's on-chain signer)
- session handling

### Arena
- `POST /api/arena/address` — designate an arena address (must be in the user's Farcaster `verifications[]`; idempotent per user)
- `GET /api/arena/me` — designated address, rules snapshot, sample command

### Farcaster ingestion
- `POST /api/webhooks/neynar` — verify signature, dedupe, enqueue

### Trading
- `POST /snaps/arena/:cast_hash` — Farcaster Snap endpoint. Verifies the JFS envelope, asserts the signer's FID owns `cast_hash`, hydrates the parsed intent, and returns a `SnapResponse` whose action is `swap_token({ sellToken, buyToken })`. Stateless; safe to re-enter.
- `POST /api/executions/confirm` — receive `{ cast_hash, tx_hash, from_address }` once the user's signed tx is observed (delivery mechanism TBD — see Durable Execution Architecture open question); verifies the tx on Base and advances the workflow.
- internal workflow steps: parser, policy validator, intent reply publisher (snap-embed variant), snap handler, tx verifier, execution recorder, scorer, outcome reply publisher

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
- user can pick one of their Farcaster-verified addresses as their arena address
- user can see their designated arena address
- user can see approved assets and grammar before trading

### Trade Execution
- user can issue a supported public trade command
- system parses valid commands via agent + Zod schema
- system rejects invalid commands with templated Commodus reply
- system publishes an intent reply cast whose embed is a Farcaster Snap URL when validation passes
- the Farcaster client renders the snap inline in the cast
- user taps Confirm; the snap emits a `swap_token` action; the native wallet opens pre-pinned to the pair
- user chooses the amount, signs, and pays gas
- system captures the resulting tx hash, verifies it on Base, records the execution, scores the trade, and publishes an outcome reply cast
- each cast produces at most one intent reply and one outcome reply (idempotent at webhook, snap, queue, workflow, and chain layers)

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
- the user's designated arena address (copyable)
- approved assets
- how to trade (exact grammar)
- sample commands
- daily trade slots remaining
- a pointer to the user's native wallet for balance/gas visibility (no in-app balance display in MVP)

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
- exact command grammar (including the caveat that amount/percent in a cast are display hints; the user picks the final size in their wallet)
- full whitelist
- scoring formula + daily cap + monthly reset
- $0.25 profitable-close floor explanation
- how monthly GLORY airdrop works
- daily trade cap (`max_trades_per_day`) and the fact that trade size is user-determined, not capped

### Admin pages (operator only, allowlisted FID)
- `/admin/rewards/:epoch` — leaderboard snapshot + CSV export + mark-distributed

---

## Security and Trust Requirements

- verify all incoming Farcaster webhook requests (Neynar HMAC signature)
- the server holds no private keys; there are no custodial assets to protect
- only the designated arena address (which must be one of the user's Farcaster `verifications[]` at designation time) counts for scoring
- enforce hard asset whitelist at pre-fill time (non-whitelisted casts are rejected before any intent reply publishes)
- enforce daily trade rate limit at pre-fill time
- verify JFS envelopes on every snap POST; reject requests whose signer FID does not match the caster of `cast_hash`
- enforce price-impact cap (3%) at score time against a reference 0x quote
- do not execute unparseable commands
- do not allow duplicate processing of the same cast (idempotency at webhook, queue, workflow, and chain layers)
- chain-layer idempotency is guarded by `trade_executions.tx_hash` unique; replays of `POST /api/executions/confirm` with the same hash are no-ops
- log all command, validation, execution, and reply events

Trust is straightforward because Commodus is non-custodial: users sign their own trades from their own wallet, and the server is purely a referee. The residual trust question is "does Commodus score fairly?" — every scoring decision is deterministic, derived from on-chain receipts, and auditable by tx hash.

---

## Known MVP Compromises

These are conscious tradeoffs for hackathon velocity. Each has a planned resolution.

| Compromise | Reason | Resolution |
|---|---|---|
| **Farcaster Snap `swap_token`** is the only execution surface | Ships non-custodial with zero server-side key management; users pay their own gas; renders inline in the cast with no navigation | If Farcaster clients lag on Snap support, fall back to the Mini App SDK `swapToken` action on a `/arena/trade?cast=<hash>` page (same pair-pinning, worse UX). |
| **Trade size is user-determined** | The Farcaster `swap_token` action deliberately has no sell-amount parameter; the native wallet owns size | Accepted permanently for spot trading. If size-gated gameplay returns post-MVP, it moves to a dedicated signing surface, not into `swap_token`. |
| **Tx-hash capture path from snap → server is not yet finalized** | Farcaster Snap docs do not specify a standard post-action callback | Prototype all three paths (snap re-entry / action callback / onchain listener) in the snap execution issue; ship with whichever is guaranteed to work. |
| **Vercel Queues / Workflow** both in public beta | New primitives, best-fit DX | If unreliable, fall back to Upstash QStash + Supabase state machine; no code redesign needed. |
| **Templated reply copy only** (no LLM replies) | Deterministic voice, safer for money-moving flows | Agent grows a `publish_cast` tool post-MVP; voice is then LLM-curated with guardrails. |
| **Manual offchain GLORY airdrops** | No contract, zero smart-contract risk for MVP | Optionally automate via a `Distributor` contract + merkle airdrops post-MVP. |
| **Single-region Supabase, no DR** | Not a hackathon concern | Supabase multi-region/read replicas when traffic warrants. |
| **Admin UI gated by single allowlisted FID** | Simple auth for one operator | Role-based access when team grows. |
| **No rate limiting beyond policy caps** | Policy caps are sufficient at hackathon scale | Add IP/FID rate limits before public launch. |
| **Base mainnet from day one** (no staging chain) | Real assets make the demo real | Add Base Sepolia staging environment if team grows. |
| **No in-app balance display** | Balances live in the user's native wallet; duplicating them in-app would force an RPC query path the server does not otherwise need | Add a read-only `GET /api/arena/balance` backed by viem if the UX gap matters. |

---

## Success Metrics

### MVP success metrics
- number of users who sign in
- number of users who designate an arena address
- number of public trade casts
- command parse success rate
- intent-reply publish success rate (server-owned)
- user-signed tx confirmation rate (user-owned; an honest measure of Snap + native-wallet integration health)
- trade execution success rate (confirmed & passing score-time enforcement)
- weekly active traders
- number of users who trade more than once
- leaderboard page views
- month-1 airdrop recipients (target: 10 eligible winners)

### Demo success
A successful demo should show, in order:
1. A first-time user signs in with Farcaster
2. User picks one of their Farcaster-verified addresses as their arena address
3. User posts `@commodus buy 10 usdc of aero` from Farcaster
4. Commodus publishes an intent reply cast within seconds; the cast renders a Farcaster Snap inline
5. User taps **Confirm** in the snap; the native wallet opens pre-pinned to USDC → AERO
6. User chooses the amount (e.g. 10 USDC), signs; tx confirms on Base
7. Commodus publishes an outcome reply naming the realized fill
8. Mini App shows updated portfolio + rank
9. User posts `@commodus sell 50% of aero`, taps Confirm in the snap, chooses the amount, signs, and the outcome reply names realized PnL
10. Leaderboard page shows the user climbing

---

## Launch Choreography

Order of operations for going live:

1. **Infrastructure ready** — Supabase schema applied (including the non-custodial pivot migration), Vercel deployment live, Neynar webhook pointed at prod URL, 0x API key in place (for reference quotes only).
2. **`@commodus` FID profile polished** — bio, pfp, pinned cast explaining the game.
3. **First `reward_epoch` row created** for the launch month.
4. **Commodus casts the `$GLORY` launch** via Clanker: *"Rome proclaims its coin. @clanker launch GLORY — supply N, ticker $GLORY."*
5. **Commodus casts the arena opening:** *"The arena opens. Speak thy decrees: `@commodus buy N usdc of SYMBOL`. Sign thy swap. Glory awaits."*
6. **Public trading begins.**
7. **End of month:** leaderboard freezes automatically; operator exports CSV; airdrop completed; recap cast published.

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

### Phase 2 — Arena address
- implement `POST /api/arena/address` (validate against the user's Farcaster `verifications[]`, upsert `arena_wallets`)
- implement `GET /api/arena/me` (designated address + rules snapshot)
- Arena page UI with address picker, copyable address, sample commands
- Rules page with grammar + whitelist + scoring

### Phase 3 — Cast ingestion + pipeline
- implement `POST /api/webhooks/neynar` with HMAC verification + Redis idempotency + Supabase insert
- stand up Vercel Queue `trade-commands`
- stand up Vercel Workflow `process-trade-command` phase 1 (parse → validate → publish intent reply)
- implement `parse_command` step: regex pre-filter → `generateObject` (Vercel AI SDK, AI Gateway model) → `TradeIntentSchema` (Zod)
- implement `POST /snaps/arena/:cast_hash` Farcaster Snap endpoint (JFS verification, snap response with `swap_token` action pinned to the pair)
- prototype and lock in the tx-hash capture path (snap re-entry vs. action callback vs. onchain listener)
- implement `POST /api/executions/confirm` + Vercel Queue `trade-confirmations`
- stand up Vercel Workflow phase 2 (verify tx → decode → score-time enforcement → record → score → publish outcome reply)
- integrate 0x Swap API for reference quotes (score-time price-impact check only)
- implement templated reply publishing via Neynar for both intent and outcome reply kinds

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

**Commodus is a Farcaster trading game where users pick an arena address, trade in public by signing Farcaster Snap `swap_token` actions inline in their own casts, climb the leaderboard, and earn GLORY.**
