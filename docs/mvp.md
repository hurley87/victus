# Commodus MVP PRD

## Overview

**Commodus** is a Farcaster trading game built as a Mini App.

Users keep their existing Farcaster account, open the Mini App, **mint a gladiator** (a one-time ritual gated by a **$5 USDC deposit** into a per-user **arena wallet** that Commodus custodies via Privy), then issue **public trade commands** by casting at `@commodus`.

Commodus parses the command, validates it against the user's policy and the game rules, **executes the swap autonomously from the arena wallet**, and publishes public intent and outcome reply casts naming the realized fill. The user does not sign each trade; they fund the arena wallet once at mint time and Commodus trades on their behalf from that point on.

Execution is **custodial**. Commodus holds the private key for each user's arena wallet via Privy's server-wallet API (TEE-executed inside an AWS Nitro Enclave — keys are reassembled only in memory for a single signing call and never persist outside the enclave). The application server has authorization to sign but not to export. Gas is sponsored by Privy, funded by a 0.5% fee-on-swap charged at execution time.

At the end of each month, the top 10 players are recognized on a frozen leaderboard; **monthly prizes are optional and operator-led** (off-app distribution, no in-product token narrative in MVP).

---

## Product Thesis

Most trading products are private and utility-first.

Commodus makes trading:
- **public**
- **game-like**
- **social**
- **competitive**

The core loop is simple:

1. Mint your gladiator ($5 USDC, one time)
2. Cast decrees in public; Commodus trades on your behalf
3. Earn points
4. Climb the leaderboard
5. Top the monthly leaderboard

---

## MVP Goal

Ship a working Farcaster Mini App that proves three things:

1. users will mint a gladiator (depositing $5 USDC into a custodial arena wallet) to enter the arena
2. users will issue trade commands publicly on Farcaster and let Commodus execute them autonomously
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
- onchain reward-token distribution contracts

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
- top 10 are highlighted monthly (prizes at operator discretion)

### 3. Mint Your Gladiator
The user chooses a gladiator name (free text, validated), which triggers the mint ritual:
1. Commodus lazily provisions a per-user **Privy server wallet** on Base — the arena wallet. Private key material is TEE-custodied by Privy and never extractable. The user does not import a seed phrase, does not install anything, and does not manage the key material.
2. The Mini App surfaces the arena address with a **Deposit ≥ $5 USDC** CTA (copy / QR).
3. Once the first deposit of ≥ $5 USDC is observed on Base, the `gladiators` row flips `status = 'alive'` and trading unlocks.

The gladiator is soft-minted (a DB record, not an on-chain NFT) for MVP. No gas, no smart-contract risk. The user's arena wallet exists *only after* they commit to the mint — sign-ins that don't mint cost Commodus zero.

### 4. Review Arena Rules
The user reads what Commodus can and cannot do, including:
- only approved tradable assets (plus USDC as quote; live list from `asset_whitelist`)
- max trades per day
- max size per trade (`max_trade_usdc`)
- wallet cap (`wallet_cap_usdc`) beyond which new buys are rejected
- 0.5% fee-on-swap (minimum $0.05) deducted from each trade to fund gas sponsorship
- Commodus executes swaps autonomously from the arena wallet; the user does not sign per trade

### 5. First Trade
The user posts a cast such as:
- `@commodus buy 25 usdc of aero`
- `@commodus sell 50% of aero`
- `@commodus status`

### 6. Commodus Executes
The backend:
- ingests the cast via Neynar webhook
- enqueues it to a Vercel Queue
- runs a durable Vercel Workflow that parses, validates, quotes, deducts the fee, and **signs + submits the swap via Privy's server-wallet API** from the arena wallet, then records the execution and publishes an **intent reply cast** followed by an **outcome reply cast** naming the realized fill

The user sees a public cast thread: decree → intent acknowledgement → outcome. No signing dialog, no Mini App navigation mid-trade. If any step fails (insufficient balance, policy rejection, revert on-chain), Commodus replies with a templated line naming the reason; the trade is not scored.

### 7. Track Performance
The user opens the Mini App to see:
- arena wallet balance (live, from Base)
- rank
- points
- realized PnL
- portfolio (holdings + cost basis)
- recent trades
- monthly standings

### 8. Monthly recognition
At the end of each UTC month, the leaderboard for that UTC month is frozen and the top 10 are named. **MVP does not promise a specific token or onchain reward** — any monthly prize is operator-defined and fulfilled outside the app (see § Monthly rewards).

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
- **mint-your-gladiator ritual** — name picker + lazy Privy wallet provisioning + $5 USDC deposit gate
- surface arena address + live balance with a copy-to-clipboard deposit affordance
- show game rules + grammar
- show whitelisted assets
- show leaderboard (current month)
- show portfolio + cost basis
- show trade history

### Custodial Execution (Privy server wallets)
- per-user Privy server wallet created **lazily at gladiator-mint time** (not at sign-in); wallet id stored on `arena_wallets.privy_wallet_id`. Users who sign in but never mint cost Commodus nothing.
- Commodus holds authorization to sign from the wallet via Privy's server-wallet API; private key material is TEE-custodied (AWS Nitro Enclave — reassembled in memory only, never persisted outside the enclave, not extractable by Privy, AWS, or a compromised Privy stack)
- **Gas sponsored by Privy.** Each swap is submitted with `sponsor: true`; Privy pays gas from a sponsorship balance that the operator tops up. That balance is refilled by the fee-on-swap collected at execution time (see Execution Rules).
- swap execution runs inside a durable Vercel Workflow step that calls Privy's signing API and receives the tx hash synchronously in the step's return value

### Public Trading
- users trade via public Farcaster casts at `@commodus`
- Commodus replies publicly with templated copy
- `buy`, `sell`, and `status` commands only
- fixed whitelist of tradable assets + USDC (see § Asset Rules; current MVP targets **three** Base tokens plus USDC as quote)
- deterministic regex grammar with LLM fallback via Vercel AI SDK `generateObject` + Zod `TradeIntentSchema`
- validation, quoting, and policy checks before execution; execution runs server-side without user interaction

### Backend
- ingest Farcaster casts via Neynar mention webhook
- enqueue to Vercel Queue
- process via Vercel Workflow (parse → validate → quote → execute → record → reply)
- persist commands, intents, executions, lots, positions, scoring, leaderboard state in Supabase
- idempotent processing at webhook, queue, workflow, and chain layers

### Rewards
- monthly leaderboard snapshot
- top 10 users are surfaced for operator follow-up
- any payout is fully manual (admin CSV export + fulfillment outside the app)

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
- reward-token utility (voting, tournament entry, etc.)

---

## Product Requirements

## Identity
- users must use their existing Farcaster account
- no new Farcaster account creation
- Farcaster identity is the canonical social identity in the app

## Wallets
- each user has **one** arena wallet, provisioned at gladiator-mint time (not at sign-in — see § Gladiator Mint)
- the arena wallet is a **Privy server wallet** on Base; `arena_wallets.privy_wallet_id` is the canonical Privy identifier and `arena_wallets.wallet_address` is its Base EOA
- private key material is TEE-custodied by Privy (AWS Nitro Enclave); the application server has authorization to sign but cannot export the key
- **gas is sponsored by Privy** on every swap (`sponsor: true`). The operator tops up a Privy sponsorship balance; that balance is refilled by the 0.5% fee-on-swap charged at execution. The arena wallet never needs an ETH balance.
- USDC is the only asset the user deposits; traded assets (e.g. AERO, DEGEN, VIRTUAL — **live list from `asset_whitelist`**) live on the arena wallet post-buy and are sold back to USDC on sell commands
- withdraw functionality is **out of scope for MVP** (see Known MVP Compromises); a user who wants their balance back contacts the operator
- only swaps signed from the arena wallet count toward scoring; by construction, all swaps originate from there
- the arena wallet cannot be changed once provisioned (one per user in MVP)

## Gladiator Mint

The gladiator is the user's identity in the arena and the gate on Commodus's exposure to inactive wallets.

### What the mint is (MVP)
- **Soft mint only.** A row in the `gladiators` table: `(user_id, name, status, minted_at)`. No on-chain NFT in MVP — no smart-contract risk, no user-paid mint gas, nothing to audit. (On-chain soulbound NFT is deferred to post-MVP; the schema is forward-compatible via an optional `token_id` column added later.)
- **Name picker.** Free text, 3–32 chars, ASCII letters/numbers/spaces/hyphens, **globally unique** (first mint wins the name). Displayed on leaderboard and in Commodus's replies ("Maximus. Order accepted. 10 USDC → AERO.").
- **Immortal for MVP.** No death, no retirement, no re-mint. This aligns with the non-goal "no weekly eliminations." A user mints once, ever.

### Mint gate
- `min_mint_deposit_usdc = 5` — the user's arena wallet must be funded with **≥ $5 USDC** for `gladiators.status` to flip from `'pending_funding'` to `'alive'`.
- Trading is gated on `status = 'alive'`. A user with a pending gladiator can see the arena address and the live deposit balance but cannot cast a trade command.

### Why this gate exists
- **Abuse protection.** Commodus pays gas sponsorship only on wallets that have already funded $5 USDC. A bot that signs in and pokes around costs $0. A bot that funds $5 has already contributed more than it can consume in gas.
- **Narrative fit.** "Mint your gladiator to enter the arena" maps onto the Roman voice in a way "deposit $5 to unlock trading" never will. The mint is a ritual, not a meter.
- **Float economics.** The $5 minimum × N users = custodied USDC float. At MVP scale this is legally negligible (see § Compliance Posture) but opens a post-MVP yield surface.

### Mint flow
1. User signs in with Farcaster (Quick Auth). No arena wallet yet.
2. User opens the Mini App, sees a "Mint Your Gladiator" CTA.
3. User enters a name; backend calls `POST /api/gladiators/mint`:
   - provisions a Privy server wallet via the server-wallet API
   - inserts `arena_wallets` (`privy_wallet_id`, `wallet_address`)
   - inserts `gladiators` (`name`, `status='pending_funding'`)
   - returns the arena address to the client
4. UI shows the arena address + QR + "Send ≥ $5 USDC on Base to fund your gladiator."
5. A backend poller (or Alchemy/onchain listener) watches Base for incoming USDC to the arena address; on first confirmed deposit of cumulative ≥ $5 USDC, `gladiators.status = 'alive'`.
6. UI flips into trading-enabled mode; user can cast their first decree.

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
AMOUNT     := positive decimal (USDC amount to spend; server-enforced against policy)
PERCENT    := integer 1..100
SYMBOL     := member of asset_whitelist (case-insensitive)
```

`AMOUNT` and `PERCENT` are **authoritative** — they are the exact sizes Commodus executes against on the user's behalf. `AMOUNT` is denominated in USDC (buy side). `PERCENT` is a share of the user's current on-chain holding of `SYMBOL` inside the arena wallet (sell side), resolved at execution time by reading the arena wallet's token balance.

### Rules
- **single command per cast** — multi-command casts rejected
- **case-insensitive** on keywords and symbols
- **emojis and unicode whitespace stripped** before matching
- **any unrecognized token** → cast is rejected with a templated Commodus line listing the valid forms
- **percentage-only sells in MVP** — absolute-quantity sells deferred to future
- the parsed result is validated through a Zod schema before reaching the policy engine

### Examples
- `@commodus buy 25 usdc of aero`
- `@commodus buy 10 usdc of virtual`
- `@commodus sell 50% of aero`
- `@commodus status`

## Asset Rules

MVP supports:
- **Base mainnet only**
- **spot trading only**
- **whitelist driven by `asset_whitelist`** (USDC as quote + **three** tradable Base tokens in the current seed; **WETH is retired** — not offered for new trades)

| Symbol | Role | Notes |
|---|---|---|
| USDC | Quote | Required; all PnL denominated in USDC |
| AERO | Tradable | Base-native volatility |
| DEGEN | Tradable | Farcaster-culture token |
| VIRTUAL | Tradable | Agent/AI theme alignment |

- Symbols outside the active whitelist are rejected with a templated Commodus line
- USDC is the sole quote asset — no symbol-to-symbol pairs
- no leverage, no perps, no bridging
- whitelist entries live in the `asset_whitelist` table and are editable via DB (no redeploy)

## Policy Rules

Global defaults for MVP. **Not user-editable.**

| Parameter | Value | Enforced at |
|---|---|---|
| `min_mint_deposit_usdc` | 5 | mint-funding check (gladiator unlocks at `status='alive'`) |
| `max_trade_usdc` | 10 | pre-submit (quote step) |
| `max_trades_per_day` | 10 | pre-submit (intent step) |
| `wallet_cap_usdc` | 50 | pre-submit on buys (arena wallet USDC + notional value of held positions) |
| `max_slippage_bps` | 100 (1%) | submit time (passed into the swap router's minOut calc) |
| `max_price_impact_bps` | 300 (3%) | score time (realized fill vs. reference 0x quote) |
| `swap_fee_bps` | 50 (0.5%) | execution (deducted from USDC leg; credited to operator treasury) |
| `swap_fee_min_usdc` | 0.05 | execution (floor on fee so dust trades still contribute) |

- Intents exceeding a pre-submit rule are rejected with a templated Commodus line and no trade is submitted
- Executions that exceed a score-time rule are recorded with `status='failed'` and a structured `failure_reason`; the outcome reply names the reason
- Daily counters reset at **00:00 UTC**
- `wallet_cap_usdc` is evaluated against live on-chain balance of the arena wallet (USDC + notional-at-quote-time of currently-held tradable positions). Sells are never capped by `wallet_cap_usdc`.

## Execution Rules

- **Execution surface:** a Vercel Workflow step that calls Privy's server-wallet signing API from the arena wallet. Routing is 0x Swap API (for quote + `transaction` calldata); Commodus submits the returned calldata via Privy and receives the tx hash synchronously.
- **Whitelist (pre-submit enforcement):** the server only submits swaps between whitelisted symbols. Non-whitelisted casts are rejected at parse time with a templated reply.
- **Daily rate limit (pre-submit enforcement):** a user at `max_trades_per_day` gets a cooldown reply and no trade is submitted until the UTC rollover.
- **Size (pre-submit enforcement):** buy `AMOUNT` must be ≤ `max_trade_usdc`. Sell `PERCENT` applied to the live on-chain balance of the held symbol; a sell command against zero-balance is rejected with a templated reason.
- **Wallet cap (pre-submit enforcement, buys only):** rejected if arena wallet USDC + notional-at-quote-time of currently-held tradable positions exceeds `wallet_cap_usdc`.
- **Slippage:** `max_slippage_bps` is passed to the 0x quote; the router enforces `minOut` on-chain. No user-side slippage picker.
- **Price impact (score-time enforcement):** after the tx confirms, the server compares realized fill vs. a reference 0x quote at the same block height. Impact > 3% → `status='failed'`, reason `price_impact`, no points.
- **Gas:** **sponsored by Privy** on every swap. The Privy signing call is invoked with `sponsor: true`; Privy pays gas from a sponsorship balance that the operator funds. The arena wallet never holds ETH. Sponsorship is only exposed on wallets that have cleared the $5 gladiator-mint gate, which caps upside abuse.
- **Fee-on-swap:** Commodus charges `max(swap_fee_bps × notional_usdc, swap_fee_min_usdc)` — 0.5% with a $0.05 floor — deducted from the **USDC leg** at execution (for buys: subtracted from the USDC input before the 0x quote; for sells: subtracted from the USDC output after the swap). The fee is transferred to the operator treasury in the same workflow step (either atomically via a multi-call or as a follow-up transfer from the arena wallet). The fee-on-swap revenue line refills the Privy sponsorship balance, which makes the gas-sponsored UX self-funding at volume.
- **Cost basis includes the fee.** `avg_cost_usdc` and realized PnL are computed net of `swap_fee_usdc` and sponsored gas (estimated at submission block). This kills fee-farming attacks and ensures leaderboard rank reflects real economic performance.
- **Reserve-before-submit idempotency:** `trade_executions.execution_id` is a deterministic key (derived from `cast_hash`) inserted with `status='pending'` **before** the Privy signing call. The unique constraint prevents double-submit on workflow replays. On signing-call return, `tx_hash` is populated and `status` moves to `submitted` → `confirmed` / `reverted`.
- **Transaction idempotency:** the chain-layer idempotency key is `trade_executions.tx_hash` (unique). Replays that reach the chain step with an already-observed `tx_hash` are no-ops.

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

## Monthly rewards (MVP)

MVP optimizes for **leaderboard clarity and a clean custodial trading loop**, not for a named reward token. Month-end handling:

### What “rewards” mean in MVP
- Top 10 finishers are **frozen in `leaderboard_snapshots`** and surfaced in `/admin/rewards/:epoch`.
- Any prize (USDC, merch, shout-outs, etc.) is **operator-defined** and **fulfilled off-app**. The product copy and Rules page **do not** promise a specific token.

### Operator workflow (suggested)
1. **00:00 UTC, day 1 of each month** — a Vercel cron job:
   - inserts a `reward_epochs` row with `status='snapshot_ready'`
   - freezes `leaderboard_snapshots` for the closed month (top 10 locked)
2. Operator opens `/admin/rewards/:epoch`:
   - table of top 10 with FID, username, rank, points, realized PnL, resolved recipient address
   - **"Download CSV"** — exports payout rows (e.g. `address, reward_amount`) as the operator configures
3. Operator fulfills prizes out-of-band (bank transfer, USDC send, manual process — **not specified in MVP**)
4. Operator records proof in admin UI if desired → `reward_epochs.status='distributed'` + optional tx hash metadata
5. Commodus may publish a monthly recap cast naming the top 10

### Recipient address resolution (if sending onchain value)

Rewards must **not** default to the custodial arena wallet. Resolve in this order against the user's Farcaster account at snapshot time:

1. First entry in the user's Farcaster `verifications[]`
2. Any other entry in `verifications[]`
3. Farcaster **custody address** (fallback)

Recorded in `reward_epochs` for audit. The arena wallet address is explicitly excluded from this resolution.

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

**Successful trade** (prefixed with gladiator name)
- "Maximus. Order accepted. 25 USDC deployed into AERO."
- "Maximus. The decree is carried out. Sold half thy AERO for 13.40 USDC. +2.40 realized."
- "Maximus. Commodus has entered the market on thy behalf."

**Status reply (public, with deep link)**
- "Rank 17. 42 points. Portfolio 38.12 USDC. View the full ledger: {deep_link}"

**Grammar rejection**
- "Speak as Rome taught you, gladiator. Valid decrees: `buy N usdc of SYMBOL`, `sell N% of SYMBOL`, `status`."

**Policy rejection**
- "Order denied. Asset not approved for this arena."
- "The arena grants only ten decrees per day. Return at the next dawn."
- "Commodus refuses. This trade violates the laws of the arena."
- "No gladiator bears thy name. Mint one in the arena before thou dost decree."

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
- **Privy server wallets** — the execution surface. Each user gets a per-user Privy wallet on Base, provisioned at arena-join time. Commodus signs and submits swap transactions from this wallet via Privy's server-wallet API. Private key material is HSM-custodied by Privy; the application server holds authorization but cannot export.
- **`@farcaster/miniapp-sdk`** — retained **only** for sign-in (Quick Auth) and Mini App context (safe-area insets, `isInMiniApp`, capabilities). Not on the trade-execution path.
- **0x Swap API** — used at execution time (quote + `transaction` calldata that Privy submits) and at score time (reference quote for price-impact sanity check).
- **Vercel AI SDK** (`ai`, `@ai-sdk/workflow`) — `generateObject` for MVP command parsing; graduates to `WorkflowAgent` post-MVP when Commodus gains autonomous tools. Models routed via **Vercel AI Gateway**.
- **viem / wagmi** — chain interaction (already in deps)

### Alternatives considered

The execution surface was the biggest architectural call for MVP. Three viable options were considered; one was ruled out by protocol reality, one by UX, and one chosen.

**Custodial Privy server wallets (chosen).** Per-user Privy wallet on Base, TEE-executed in AWS Nitro Enclaves, with gas sponsorship by Privy funded by a 0.5% fee-on-swap. The user mints a gladiator (one-time $5 USDC deposit), then casts decrees; Commodus executes autonomously. Chosen because:

1. **Highest agent-feel.** The product premise is "Commodus trades on your behalf." A user signing every trade themselves is a DEX with a chat skin, not an agent. Autonomous execution is the product.
2. **Deterministic tx hashes.** Privy's signing API returns the tx hash in the same RPC call that submits it. No capture-path reverse-engineering, no listener fallback, no latency edge cases. See `docs/spikes/snap-tx-hash.md` for the receipts on why this matters.
3. **Revenue surface actually works.** Fee-on-swap and yield on idle balances are both viable when Commodus holds the balance. In a non-custodial model there's nothing to skim and nothing to yield. The fee-on-swap also refills the gas sponsorship balance, which makes the gas-free UX self-funding at volume.
4. **Abuse bound by lazy provisioning + mint gate.** Privy wallets are created only on gladiator-mint (not sign-in), and the mint requires a $5 USDC deposit. A bot that signs in but doesn't mint costs $0; a bot that mints has already contributed more than it can consume in sponsored gas.
5. **TEE custody posture.** Private keys are reassembled only inside AWS Nitro Enclaves for the duration of a single signing call — not extractable by Privy, AWS, or a compromised Privy control plane. The application server's signing authorization is a revocable service-account credential, not a key-material copy.
6. **Durable-workflow fit.** A single `submit_swap` step inside the existing Vercel Workflow calls Privy, gets the hash back, and moves on. The rest of the pipeline (quote → record → score → reply) is unchanged from the pre-Snap design.

**Farcaster Mini App SDK `swapToken` — one-tap-per-trade (eliminated for MVP).** `sdk.actions.swapToken({ sellToken, buyToken, sellAmount })` returns tx hashes from the client. Technically solid — the spike's follow-on discovery confirmed the SDK already delivers the value the Snap approach was reverse-engineering. Eliminated because:

1. **Narrative ceiling.** Three taps per trade (open mini-app → confirm → sign in native wallet) kills the agent story. "Commodus tells you to tap the button" is a worse product than "Commodus trades."
2. **Revenue model doesn't land.** Non-custodial means no idle balance to yield on and no clean path to a fee-on-swap that the user can't route around.
3. **Retained as fallback posture.** If regulatory pressure forces a pivot out of custody, the mini-app-per-trade model is the escape hatch — documented in Known MVP Compromises.

**Delegated signers / session keys (ruled out by protocol).** A user signs once to authorize Commodus to trade within a scoped policy (EIP-7702-style session keys, EIP-5792 delegations, etc.). Would give both the agent feel *and* user-custody. Ruled out because Farcaster ships no native API for it (verified against `miniapps.farcaster.xyz/llms-full.txt` — every on-chain action requires a user tap; "delegated signers" in Farcaster docs refers to Farcaster cast signers, not EVM transaction authorization). Building custom delegation is a multi-week trust-surface project that isn't justified for a solo operator at MVP scale. Re-evaluate post-MVP when the Farcaster / AA ecosystem catches up.

**Farcaster Snaps (evaluated, protocol-unsuitable).** A server endpoint returning `SnapResponse` JSON with a `swap_token` action rendered inline in the cast. The spike at `docs/spikes/snap-tx-hash.md` (commit `521cd9e6`, unmerged) proved empirically that the Snap 2.0 protocol has no slot for returning tx hashes from `swap_token` — no action-result callback, no re-entry payload carrying the hash. The only deterministic capture mechanism was a protocol-independent onchain listener, which works but produces a worse UX than any of the three mechanisms above. Discarded.

**MetaMask Snaps (eliminated).** Different product from Farcaster Snaps despite the name collision. Requires MetaMask-install plus per-Snap approval; most Farcaster traffic signs with the client's embedded wallet. Not a viable surface.

**When this decision gets revisited.** Two triggers:
1. **Regulatory pressure** — if the custody posture creates money-transmitter exposure we cannot carry, pivot to mini-app-per-trade on the path documented in Known MVP Compromises. The schema migration that restored custody (`<timestamp>_restore_custodial_execution.sql`) is reversible symmetrically.
2. **Protocol advance** — if Farcaster or the AA stack ships a first-party delegated-signer API with the scoping semantics we need (per-token allowlist, daily-notional cap, expiry), that's strictly better than custody. Re-evaluate.

### Durable Execution Architecture

Every cast runs end-to-end inside a single Vercel Workflow. There is no "user drives the next event" break point — Commodus owns the whole pipeline from webhook ingress to outcome reply. The security boundary is custody (Privy's TEE), not signature possession.

Wallet provisioning is **not** part of this workflow — it happens synchronously inside the gladiator-mint endpoint (`POST /api/gladiators/mint`), before the user can cast a decree. By the time a cast arrives, the arena wallet already exists and `gladiators.status = 'alive'` (or the policy step rejects the decree).

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
Vercel Queue "trade-commands" (idempotency key = cast_hash)
          │
          ▼
Vercel Workflow process-trade-command
          │   each bullet = 'use step', checkpointed and retryable
          │
          ├─ load_command(cast_hash)              replay guard; terminal status → return
          ├─ parse_command(cast_text)             regex pre-filter; LLM fallback via generateObject + Zod
          │                                       → cast_commands.status = 'parsed'
          │
          ├─ policy_validate(intent)              gladiator_alive + whitelist + daily-rate-limit
          │                                       + max_trade_usdc + wallet_cap_usdc
          │                                       (reads live arena wallet state)
          │                                       → cast_commands.status = 'validated' | 'rejected'
          │
          ├─ compute_fee(intent)                  fee_usdc = max(notional * swap_fee_bps / 10_000,
          │                                                     swap_fee_min_usdc)
          │                                       trade_executions.fee_usdc set
          │
          ├─ quote_swap(intent, arena_wallet)     0x Swap API: quote + transaction calldata
          │                                       net-of-fee notional for buys
          │                                       derives execution_id = deterministic(cast_hash)
          │                                       inserts trade_executions row
          │                                         status='pending', execution_id unique
          │                                       → cast_commands.status = 'quoted'
          │
          ├─ publish_intent_reply_cast(...)       unique on (cast_hash, reply_kind='intent')
          │                                       templated: "Order accepted. 10 USDC → AERO."
          │
          ├─ submit_swap(execution_id)            Privy server-wallet API signs + submits the
          │                                       0x-returned calldata from the arena wallet
          │                                       with sponsor=true (Privy pays gas from the
          │                                       operator's sponsorship balance).
          │                                       Response carries tx_hash synchronously.
          │                                       trade_executions: status='submitted', tx_hash set
          │                                       → cast_commands.status = 'executing'
          │
          ├─ transfer_fee(execution_id)           Privy signs a USDC transfer of fee_usdc from
          │                                       arena wallet → operator treasury wallet.
          │                                       Idempotent on (execution_id, 'fee') reply-kind
          │                                       equivalent. Failure is non-fatal for scoring;
          │                                       logs a fee_transfer_failed event for retry.
          │
          ├─ verify_tx_onchain(tx_hash)           viem on Base; wait 1 confirmation
          │                                       trade_executions: confirmed_at set
          │
          ├─ decode_swap_log(receipt)             realized quantity, execution_price_usdc, fees
          │
          ├─ score_time_enforcement               non_whitelisted / price_impact checks;
          │                                       on violation: status='failed' + failure_reason
          │                                       else: status='confirmed'
          │
          ├─ update_lots_and_positions            FIFO bookkeeping, deterministic from execution
          │
          ├─ score_trade                          append scoring_events, respecting daily cap
          │
          └─ publish_outcome_reply_cast           templated; unique on (cast_hash, reply_kind='outcome')
                                                  → cast_commands.status = 'executed' | 'failed'
```

Idempotency strategy summary:
- **Webhook layer:** Redis `SETNX` + Postgres unique constraint on `cast_hash`.
- **Queue layer:** Vercel Queue idempotency key = `cast_hash`.
- **Workflow layer:** every step is pure or idempotent check-then-act; reply publishing is guarded by a unique `(cast_hash, reply_kind)` row so intent and outcome replies publish exactly once each.
- **Reserve-before-submit layer:** `trade_executions.execution_id` is a deterministic unique key derived from `cast_hash`, inserted with `status='pending'` in `quote_swap` **before** the Privy signing call. On workflow replay, the unique constraint blocks a second insert; the workflow picks up the existing row and skips straight to `submit_swap` (or `verify_tx_onchain` if `tx_hash` is already set). This is the mechanism that prevents a double-submit if the workflow crashes between reserve and signing-response.
- **Chain layer:** `trade_executions.tx_hash` unique. Any path that observes a hash already present is a no-op.

**Reconciliation fallback.** If `submit_swap` returns a tx hash but the subsequent `verify_tx_onchain` never observes the receipt within 15 minutes (RPC flakiness, reorg, mempool eviction), a reconciler job (see `lib/execution/reconciler.ts`, carried over from the spike) scans Base for swaps originating from the arena wallet that match the `execution_id`'s expected pair and notional, and completes the execution record from on-chain state. Privy's synchronous response is the primary source of truth; the reconciler exists for the long tail.

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
- wallet_address (unique — Base EOA of the Privy server wallet)
- privy_wallet_id (unique — Privy's canonical identifier for server-side signing API calls)
- status ('active' | 'closed')
- created_at (set at gladiator-mint time, not at sign-in)

### `gladiators`
- id
- user_id (unique — one gladiator per user in MVP; immortal)
- name (3–32 chars, ASCII letters/numbers/spaces/hyphens; globally unique)
- status ('pending_funding' | 'alive')
- minted_at
- funded_at (nullable; set when cumulative USDC deposits ≥ `min_mint_deposit_usdc`)
- *(post-MVP)* `token_id` — on-chain soulbound NFT id, added in a forward-compatible migration when the NFT mint ships

### `wallet_policies`
- id
- wallet_id (unique)
- max_trade_usdc
- max_trades_per_day
- wallet_cap_usdc
- max_slippage_bps
- max_price_impact_bps
- active
- created_at

### `asset_whitelist`
- id
- symbol (unique)
- name
- address (Base)
- decimals
- is_tradable (boolean; USDC is false)
- is_blocklisted (boolean; e.g. reserved or retired symbols kept out of the arena surface)
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
- execution_id (**unique** — deterministic from `cast_hash`; the reserve-before-submit idempotency key)
- tx_hash (unique; set after Privy returns; the chain-layer idempotency key)
- fee_tx_hash (nullable; hash of the USDC fee-transfer from arena → treasury)
- execution_price_usdc
- quantity
- notional_usdc (pre-fee for buys, post-fee for sells)
- swap_fee_usdc (Commodus fee-on-swap, 0.5% / $0.05 min)
- sponsored_gas_usdc (USDC-equivalent of the gas Privy sponsored at submission block)
- failure_reason (nullable; `'non_whitelisted_token'`, `'price_impact'`, `'insufficient_balance'`, `'revert'`, `'unknown'`)
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
- pool_glory_amount *(historic column name; stores operator-facing reward pool metadata for the epoch)*
- snapshot_at
- distributed_at
- airdrop_tx_hashes (jsonb array)
- created_at

---

## API / Backend Requirements

### Auth / App
- `POST /api/auth/siwf` — Farcaster Quick Auth callback (Mini App session)
- session handling

### Arena / Gladiator
- `POST /api/gladiators/mint` — body `{ name }`. Creates a Privy server wallet for the authenticated user (if not already provisioned), inserts `arena_wallets` + `gladiators` (status=`pending_funding`), returns `{ wallet_address, gladiator: { name, status } }`. Idempotent per user — a replay returns the existing records.
- `GET /api/arena/me` — gladiator (name, status), arena address, live balance (USDC + held positions), rules snapshot, sample command. Returns a `needs_funding` flag while `gladiators.status = 'pending_funding'`.
- **(internal)** funding watcher — poller or on-chain listener that flips `gladiators.status` to `'alive'` and sets `funded_at` when cumulative USDC deposits to the arena wallet reach `min_mint_deposit_usdc`.

### Farcaster ingestion
- `POST /api/webhooks/neynar` — verify signature, dedupe, enqueue

### Trading
- internal workflow steps: parser, policy validator, quoter (0x), Privy signer/submitter, tx verifier, swap-log decoder, score-time enforcer, execution recorder, scorer, intent/outcome reply publishers
- no user-facing trading endpoint in MVP; the workflow is the trading surface

### Reconciliation
- `POST /api/admin/executions/reconcile` — trigger reconciler for stuck `submitted`/`pending` executions (admin only, also invoked by cron)

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
- `*/5 * * * *` — reconciler sweep for `trade_executions` stuck in `pending`/`submitted` > 15 min

---

## Functional Requirements

### Onboarding
- user can sign in with Farcaster (no wallet provisioned yet)
- user can mint a gladiator: pick a name → system lazily provisions a Privy arena wallet → user deposits ≥ $5 USDC → system flips `gladiators.status = 'alive'`
- user can see their arena address + live balance
- user can see the funding progress meter while `status = 'pending_funding'`
- user can see approved assets and grammar before trading
- user cannot issue a trade command until their gladiator is `'alive'`

### Trade Execution
- user can issue a supported public trade command
- system parses valid commands via agent + Zod schema
- system rejects invalid commands with templated Commodus reply
- system rejects commands from users whose gladiator is not `'alive'` with a templated "mint your gladiator first" reply
- system validates policy (whitelist, daily cap, `max_trade_usdc`, `wallet_cap_usdc`) before submission
- system computes `swap_fee_usdc = max(notional * swap_fee_bps / 10_000, swap_fee_min_usdc)` and applies it to the USDC leg
- system reserves a `trade_executions` row (status=`pending`, unique `execution_id`) before calling Privy
- system signs + submits the swap via Privy's server-wallet API from the arena wallet, with `sponsor: true` so gas is paid from the Privy sponsorship balance
- system transfers `swap_fee_usdc` from arena → operator treasury (idempotent on `execution_id`)
- system verifies the tx on Base, decodes the swap log, records realized fill (net of fee + sponsored-gas), scores the trade
- system publishes one intent reply (pre-submit) and one outcome reply (post-confirmation) per cast
- each cast produces at most one intent reply, one outcome reply, and one `trade_executions` row (idempotent at webhook, queue, workflow, reserve, and chain layers)

### Leaderboard
- leaderboard updates from stored executions and closed trades
- FIFO lot accounting is authoritative
- points and rank are visible in app
- user's portfolio, cost basis, and recent trades are visible in app

### Rewards
- system determines monthly winners automatically at month rollover
- system exposes CSV export of winners
- operator fulfills any prize out-of-band (not prescribed in MVP)
- operator marks epoch distributed; may attach optional tx hashes for audit

---

## UX Requirements

### Arena page (home)
Must show (post-mint, gladiator `alive`):
- the user's gladiator name ("Maximus")
- the user's arena address (copyable) with a prominent "Deposit USDC" call-to-action
- live arena wallet balance (USDC + each held position's quantity and notional value)
- approved assets
- how to trade (exact grammar)
- sample commands
- daily trade slots remaining

Must show (pre-mint, no gladiator yet):
- **"Mint Your Gladiator"** CTA with name input

Must show (post-mint, pre-funding, gladiator `pending_funding`):
- gladiator name + "Pending: send ≥ $5 USDC to fund your gladiator" banner
- arena address (copyable) with QR
- live funding progress ("$3.14 / $5.00 USDC deposited")
- trading UI disabled with "mint your gladiator to enter the arena" tooltip

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
- the gladiator mint ritual ($5 USDC deposit, one-time, immortal for MVP)
- exact command grammar (amount/percent are authoritative sizes, enforced server-side)
- full whitelist
- scoring formula + daily cap + monthly reset
- $0.25 profitable-close floor explanation
- how month-end leaderboard freeze and operator rewards work (no named token)
- daily trade cap (`max_trades_per_day`), per-trade cap (`max_trade_usdc`), wallet cap (`wallet_cap_usdc`)
- **fee-on-swap**: 0.5% of each trade's USDC leg (minimum $0.05) credited to the operator treasury and used to fund gas sponsorship
- **gas posture**: sponsored by Privy — the user never needs ETH in the arena wallet
- custody posture: Commodus custodies the arena wallet via Privy (TEE-executed in AWS Nitro Enclave, keys non-extractable); user deposits USDC and Commodus trades on their behalf; withdraw is out of scope for MVP (contact operator)

### Admin pages (operator only, allowlisted FID)
- `/admin/rewards/:epoch` — leaderboard snapshot + CSV export + mark-distributed

---

## Security and Trust Requirements

- verify all incoming Farcaster webhook requests (Neynar HMAC signature)
- **private keys are custodied by Privy** (HSM-backed); the application server holds signing authorization but cannot export key material
- Privy authorization scoped to a service-account principal that cannot rotate, export, or transfer-out; any operation beyond `sign_transaction` requires an operator-side admin flow (out of scope for MVP)
- only the arena wallet signs trades; every `trade_executions` row carries an `execution_id` tied to a specific `cast_hash` so no trade can be submitted that isn't traceable to a user decree
- enforce hard asset whitelist at pre-submit time
- enforce daily trade rate limit, `max_trade_usdc`, and `wallet_cap_usdc` at pre-submit time
- enforce price-impact cap (3%) at score time against a reference 0x quote
- do not execute unparseable commands
- do not allow duplicate processing of the same cast (idempotency at webhook, queue, workflow, reserve, and chain layers)
- reserve-before-submit idempotency is guarded by `trade_executions.execution_id` unique; replays that reach `quote_swap` with an already-reserved `execution_id` pick up the existing row instead of inserting a second
- chain-layer idempotency is guarded by `trade_executions.tx_hash` unique
- log all command, validation, quote, submission, execution, and reply events (include `cast_hash`, `execution_id`, and `tx_hash` where applicable)

Trust posture shifted from "referee-only" to "custodian-plus-referee" in the custodial model. Users need to trust two things: (1) Commodus will execute only the trades they decree (guaranteed by `execution_id` derivation from `cast_hash` and public cast thread), and (2) Commodus will not rug the custodied balance. (2) is an irreducible trust assumption for any custodial service; the mitigations are Privy's HSM isolation, scoped signing authorization, public on-chain audit of every trade, and the operator's reputation.

## Compliance Posture

Operating Commodus as a custodial trading service exposes it to money-transmitter / custody-adjacent regulatory frameworks that the non-custodial version sidestepped. Specifically:

- **US FinCEN / state MTLs.** Taking custody of user USDC and executing on-chain swaps on their behalf plausibly meets the functional definition of money transmission under several state regimes (NY BitLicense, TX MSB, etc.), even where the asset is stablecoin rather than fiat. Enforcement against small-scale trading bots has historically been rare but is not zero.
- **EU MiCA.** Custody + execution falls under MiCA's CASP ("crypto-asset service provider") regime as of late 2024. MVP's geographic posture is Farcaster-audience-centric (US / EU / global), not geofenced.
- **CFTC commodities.** Spot swaps of non-security tokens on decentralized routers are currently out of scope for CFTC oversight, but the line is actively litigated.

**MVP posture (accepted risk, pending legal review):**

1. **Scale.** Each arena wallet is capped at `wallet_cap_usdc = $50` and `max_trade_usdc = $10`; aggregate custodied balance at MVP scale is small enough that the risk-adjusted expected cost of an enforcement action is dominated by legal-review cost.
2. **No fiat on/off-ramp.** Deposits are USDC-in / USDC-stays; Commodus never touches fiat. This removes the most aggressive MTL triggers.
3. **No custody of third-party users' keys.** Private keys are custodied by Privy; Commodus is arguably a user of Privy's custody service rather than a custodian itself. This is a legal-argument posture, not a factual firewall.
4. **Withdraw deferred.** MVP does not implement user-initiated withdraw (see Known MVP Compromises). Withdraw-on-request is operator-mediated; this narrows the custody surface but also narrows how long the posture is defensible before legal review is non-optional.
5. **Pending legal review.** The operator commits to legal review before any of: (a) aggregate custodied balance exceeding $10k, (b) introduction of fiat rails, (c) public marketing beyond the Farcaster / crypto-native audience, (d) any public token launch or tradable reward asset tied to the product.

This is documented here because the compliance surface is the single biggest post-MVP risk that the architecture doesn't mitigate directly; future maintainers should see the accepted risk explicitly rather than infer it from the absence of discussion.

---

## Known MVP Compromises

These are conscious tradeoffs for hackathon velocity. Each has a planned resolution.

| Compromise | Reason | Resolution |
|---|---|---|
| **Custodial Privy server wallets** are the execution surface | Required for the autonomous-agent product thesis; only mechanism that gives deterministic tx hashes + fee-on-swap + yield-on-idle revenue | Re-evaluate if (a) regulatory pressure mandates non-custody, in which case pivot to Mini App SDK `swapToken` per trade (`feat/miniapp-per-trade` escape hatch), or (b) Farcaster / AA ecosystem ships first-party delegated signers with usable scoping semantics. |
| **Soft-mint gladiators (DB row, no on-chain NFT)** | Ships the narrative ritual and abuse gate without the smart-contract surface; no user-paid mint gas; forward-compatible schema for a later NFT migration | Post-MVP: soulbound ERC-721 mint on Base when there's product reason (retire-and-remint mechanic, cross-product identity, collectibility). Add `gladiators.token_id` in a non-breaking migration. |
| **Immortal gladiators in MVP (no death/retirement)** | Aligns with the "no weekly eliminations" non-goal; keeps MVP scope on the trading loop rather than lifecycle mechanics | Revisit when adding tournament seasons, resurrection, or lineage mechanics — any of which wants a retirement signal. |
| **Lazy wallet provisioning at mint (not at sign-in)** | Sign-in without mint costs Commodus $0; Privy sponsorship is only exposed on wallets that have cleared the $5 mint gate | No resolution needed; this is the correct steady-state policy. |
| **No user-initiated withdraw in MVP** | Withdraw flow is operationally the most failure-sensitive path (partial fills, network races, support load); deferring lets MVP ship | Withdraw-by-request via operator; add a self-serve `POST /api/arena/withdraw` with rate-limiting and amount-cap once Phase 5 settles. |
| **Money-transmitter / custody regulatory exposure accepted at MVP scale** | $50 wallet cap + $10 per-trade cap + no fiat rails keeps exposure small; legal-review cost exceeds risk-adjusted enforcement cost at this scale | Legal review before any of: aggregate custodied balance >$10k, fiat rails, marketing outside crypto-native audience. See § Compliance Posture. |
| **Privy gas sponsorship funded by fee-on-swap** | Users shouldn't need to hold ETH for a USDC-in product; operator absorbs the cash-flow lag between topping up the sponsorship balance and collecting fee-on-swap revenue | Steady state at scale: sponsorship balance is self-refilling from fees. If volume outruns fee revenue, switch to a user-paid gas model (arena wallet holds ETH, gasless via paymaster, or ERC-4337 with sponsored gas metered per user). |
| **Single Privy server-wallet per user (no multi-sig, no recovery)** | Simplest possible custody topology; Privy's TEE execution (AWS Nitro Enclaves) is the only failure mitigation | If a Privy outage or key-loss becomes a real risk, move to dual-custody or a self-hosted signer + HSM. |
| **Vercel Queues / Workflow** both in public beta | New primitives, best-fit DX | If unreliable, fall back to Upstash QStash + Supabase state machine; no code redesign needed. |
| **Templated reply copy only** (no LLM replies) | Deterministic voice, safer for money-moving flows | Agent grows a `publish_cast` tool post-MVP; voice is then LLM-curated with guardrails. |
| **Manual offchain rewards** | No reward contract in MVP; operator fulfills prizes manually | Optionally automate via a distributor contract + merkle claims post-MVP. |
| **Single-region Supabase, no DR** | Not a hackathon concern | Supabase multi-region/read replicas when traffic warrants. |
| **Admin UI gated by single allowlisted FID** | Simple auth for one operator | Role-based access when team grows. |
| **No rate limiting beyond policy caps** | Policy caps are sufficient at hackathon scale | Add IP/FID rate limits before public launch. |
| **Base mainnet from day one** (no staging chain) | Real assets make the demo real | Add Base Sepolia staging environment if team grows. |

---

## Operations — logs (Axiom)

Production and preview function logs are drained to **Axiom** via the Vercel Marketplace integration. The app emits **one JSON object per line** on stdout (and `level: error` on stderr) from `lib/logger.ts`, with fields such as `level`, `ts`, `msg`, `castHash`, `fid`, and `step` (workflow steps also include `duration_ms` on `step_end`).

Example **APL** queries (adjust dataset / field names to match your Axiom dataset schema; Vercel may wrap lines in a container field):

```apl
// All log lines for one cast
['vercel'] | where castHash == "0x…"

// Errors only
['vercel'] | where level == "error"

// Webhook outcomes in the last 24h
['vercel'] | where msg == "accepted" or msg == "rate-limited" | where _time > ago(24h)

// Workflow step latency (successful steps only; failures emit msg == "step_failed")
['vercel'] | where msg == "step_end" | summarize avg(duration_ms) by step

// Thrown / failed workflow steps
['vercel'] | where msg == "step_failed"

// Failed Neynar publish attempts (HTTP status is a separate field)
['vercel'] | where msg == "neynar_cast_publish_failed"
```

Confirm field paths in the Axiom UI after the first deploy; if logs arrive as escaped JSON strings, parse with `extend parsed = parse_json(message)` (or the integration’s documented field) and query `parsed.castHash` instead.

---

## Success Metrics

### MVP success metrics
- number of users who sign in
- number of users who mint a gladiator (arena wallet provisioned, name chosen)
- number of gladiators who reach `alive` status (≥ $5 USDC deposit cleared)
- sign-in → mint → funded conversion funnel
- number of public trade casts
- command parse success rate
- intent-reply publish success rate (server-owned)
- deposit-to-first-trade latency (onboarding funnel health)
- trade submission success rate (Privy signing call returns a tx hash)
- trade execution success rate (tx confirmed & passing score-time enforcement)
- weekly active traders
- number of users who trade more than once
- leaderboard page views
- month-1 top-10 snapshot completed (10 named finishers)

### Demo success
A successful demo should show, in order:
1. A first-time user signs in with Farcaster
2. User taps "Mint Your Gladiator", enters a name ("Maximus"); Mini App lazily provisions the Privy arena wallet and surfaces the address + a "Deposit ≥ $5 USDC" CTA
3. User sends $10 USDC to the arena address; Mini App balance updates live, gladiator flips from `pending_funding` to `alive`, trading unlocks
4. User posts `@commodus buy 10 usdc of aero` from Farcaster
5. Commodus publishes an intent reply cast within seconds ("Maximus. Order accepted. 10 USDC → AERO.")
6. Commodus executes the swap autonomously (sponsored gas, no ETH in arena wallet); outcome reply naming the realized fill publishes within ~15s of the original cast
7. Mini App shows updated arena wallet (USDC reduced by notional + 0.5% fee, AERO holding visible) + rank
8. User posts `@commodus sell 50% of aero`; outcome reply names realized PnL within ~15s
9. Leaderboard page shows the user climbing, displayed by gladiator name
10. At no point does the user open a signing dialog, hold ETH, or leave Farcaster

---

## Launch Choreography

Order of operations for going live:

1. **Infrastructure ready** — Supabase schema applied (including the non-custodial pivot and the `restore_custodial_execution` migration on top), Vercel deployment live, Neynar webhook pointed at prod URL, 0x API key in place, Privy server-wallet API key provisioned, **Privy gas-sponsorship balance funded** (seed with ~$500 to cover launch-week traffic before fee-on-swap revenue recycles), operator USDC treasury wallet configured (receives fee-on-swap transfers).
2. **`@commodus` FID profile polished** — bio, pfp, pinned cast explaining the game.
3. **First `reward_epoch` row created** for the launch month.
4. **Commodus casts the arena opening:** *"The arena opens. Mint thy gladiator with 5 USDC. Speak thy decrees: `@commodus buy N usdc of SYMBOL`. Commodus trades on thy behalf."*
5. **Public trading begins.**
6. **End of month:** leaderboard freezes automatically; operator exports CSV; fulfills any prizes off-app; recap cast published if desired.

---

## Open Questions

Most prior open questions resolved during grilling. Remaining:

- **Whether to backfill pre-launch testing data** before first real month, or start fresh. Low-stakes; operator preference.
- **Whether to manually bless the first few users** (seed some traders before public launch) vs. open immediately. Marketing decision.

---

## Suggested Build Order

### Phase 1 — Foundation (built on existing starter)
- apply Supabase schema + RLS policies
- wire `supabase-js` client into the existing starter
- confirm Farcaster Quick Auth sign-in flow works end-to-end
- add `asset_whitelist` seed data (USDC quote + AERO, DEGEN, VIRTUAL tradable; **WETH retired** via follow-on migration in this repo)
- add admin-FID allowlist env var

### Phase 2 — Gladiator mint + arena wallet provisioning
- implement `POST /api/gladiators/mint` (validate name, create Privy server wallet via server-wallet API, insert `arena_wallets` + `gladiators` with `status='pending_funding'`)
- implement funding watcher (poller or Alchemy webhook on arena address for USDC transfers) that flips `gladiators.status='alive'` on first ≥ $5 USDC cumulative deposit
- implement `GET /api/arena/me` (gladiator state + arena address + live balance + rules snapshot)
- Arena page UI with three states: (a) pre-mint "Mint Your Gladiator" form, (b) pending-funding banner with progress meter, (c) post-funding trading-enabled view
- Rules page with grammar + whitelist + scoring + mint ritual + fee-on-swap + custody posture

### Phase 3 — Cast ingestion + custodial execution pipeline
- implement `POST /api/webhooks/neynar` with HMAC verification + Redis idempotency + Supabase insert
- stand up Vercel Queue `trade-commands`
- stand up Vercel Workflow `process-trade-command`:
  - `parse_command` step: regex pre-filter → `generateObject` (Vercel AI SDK, AI Gateway model) → `TradeIntentSchema` (Zod)
  - `policy_validate` step: `gladiator_alive` + whitelist + daily cap + `max_trade_usdc` + `wallet_cap_usdc`
  - `compute_fee` step: `fee_usdc = max(notional * swap_fee_bps / 10_000, swap_fee_min_usdc)`
  - `quote_swap` step: 0x Swap API quote + calldata (net-of-fee notional for buys); reserve `trade_executions` row (`execution_id` unique, status=`pending`, `swap_fee_usdc` set)
  - `publish_intent_reply_cast` step: templated, idempotent on `(cast_hash, 'intent')`
  - `submit_swap` step: Privy server-wallet signing call with `sponsor: true`; tx hash synchronously returned
  - `transfer_fee` step: Privy signs USDC transfer of `fee_usdc` from arena → operator treasury; idempotent on `execution_id`
  - `verify_tx_onchain` step: viem on Base, 1 confirmation
  - `decode_swap_log` step: realized quantity, price, fees
  - `score_time_enforcement` step: price-impact check against 0x reference
  - `update_lots_and_positions` + `score_trade` steps (cost basis net of `swap_fee_usdc` + `sponsored_gas_usdc`)
  - `publish_outcome_reply_cast` step: templated, idempotent on `(cast_hash, 'outcome')`
- implement `lib/execution/reconciler.ts` (carried from spike) + cron trigger for stuck executions

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

---

## One-Line Product Definition

**Commodus is a Farcaster trading game where users mint a gladiator (one-time $5 USDC deposit into a custodial arena wallet), issue public trade decrees by casting at `@commodus`, watch Commodus execute on their behalf with sponsored gas, and climb the monthly leaderboard.**
