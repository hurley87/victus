# Commodus MVP PRD

## Overview

**Commodus** is a Farcaster trading game built as a Mini App.

Users keep their existing Farcaster account, open the Mini App, create and fund an **arena wallet**, then issue **public trade commands** by casting at `@commodus`.

Commodus parses the command, validates it against the user's policy and the game rules, executes the trade from the user's arena wallet, replies publicly, and updates a live leaderboard.

At the end of each month, the top players receive **GLORY**.

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

These can come later if the core loop works.

---

## Core User Experience

### 1. Discover
A user sees a cast from or about Commodus and opens the Mini App.

### 2. Enter the Arena
The user signs in with Farcaster and reads a simple explanation of the game:
- trade in public
- only approved assets
- leaderboard is based on points
- top players earn GLORY monthly

### 3. Create Arena Wallet
The user creates a dedicated arena wallet inside the Mini App.

### 4. Grant Trading Authority
The user authorizes Commodus to execute trades from the arena wallet within strict limits.

### 5. Fund Arena Wallet
The user deposits funds into the wallet.

### 6. Trade in Public
The user posts a cast such as:
- `@commodus buy 25 usdc of aero`
- `@commodus sell 50% of virtual`

### 7. Commodus Executes
The backend:
- ingests the cast
- parses the trade intent
- checks rules and permissions
- executes the trade if valid
- stores the result
- replies publicly

### 8. Track Performance
The user opens the Mini App to see:
- rank
- points
- PnL
- portfolio
- recent trades
- monthly standings

### 9. Monthly Reward
At the end of the month, top players receive GLORY.

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
- Farcaster sign-in
- onboarding flow
- create arena wallet
- fund arena wallet
- show game rules
- show whitelisted assets
- show leaderboard
- show portfolio
- show trade history

### Public Trading
- users trade via public Farcaster casts
- Commodus account replies publicly
- buy and sell commands only
- fixed whitelist of supported assets
- command parser for simple trade grammar
- validation and policy checks before execution

### Backend
- ingest Farcaster casts mentioning Commodus
- parse trade intent
- validate trade
- execute trade from arena wallet
- persist commands, executions, positions, and leaderboard state
- idempotent processing

### Rewards
- monthly leaderboard
- top X users receive GLORY
- reward calculation can be manual or semi-automated in MVP

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

---

## Product Requirements

## Identity
- users must use their existing Farcaster account
- no new Farcaster account creation
- Farcaster identity is the canonical social identity in the app

## Wallets
- each user has one arena wallet
- arena wallet is separate from the user's normal trading wallet
- users must explicitly create and fund it
- users must explicitly authorize Commodus to trade from it within constraints

## Trade Commands
Supported command types:
- buy
- sell
- status

Examples:
- `@commodus buy 25 usdc of aero`
- `@commodus buy 10 usdc of eth`
- `@commodus sell 50% of aero`
- `@commodus status`

Command grammar should be intentionally narrow for MVP.

## Asset Rules
MVP supports:
- Base only
- spot trading only
- small whitelist of 3 to 5 assets
- USDC as base quote asset
- no leverage
- no bridging
- no perps
- no obscure assets

## Policy Rules
Each user wallet should have configurable limits, with sane defaults:
- max trade size
- approved assets only
- max number of trades per day
- sufficient balance required

For MVP, these can be global defaults rather than user-editable settings.

---

## Leaderboard and Scoring

The leaderboard should feel game-like, but stay simple.

### Proposed MVP scoring
- **1 point** for each executed trade
- **10 points** for each profitable closed trade
- **+10 bonus points** for a closed trade with realized return of **10%+**
- **+25 bonus points** for a closed trade with realized return of **25%+**
- only first **5 scoring trades per day** count toward points
- monthly realized PnL % is used as tiebreaker

### Why this scoring model
This rewards:
- participation
- profitable trading
- bigger wins

It discourages:
- spam trading
- leaderboard farming via tiny trades only

### Monthly rewards
Top X players receive GLORY monthly.

Suggested distribution:
- 1st: 30%
- 2nd: 20%
- 3rd: 15%
- 4th: 10%
- 5th: 10%
- 6th–10th: split remaining 15%

This can be adjusted later.

---

## Commodus Voice

Commodus should feel imperial and theatrical, but never unclear.

### Tone
- Roman
- concise
- authoritative
- playful
- readable

### Successful trade examples
- "Order accepted. 25 USDC deployed into AERO."
- "The decree is carried out."
- "Commodus has entered the market."

### Rejection examples
- "Order denied. Asset not approved for this arena."
- "Order denied. Insufficient balance."
- "Commodus refuses. This trade violates the laws of the arena."

The copy should enhance the game without making the product confusing.

---

## Technical Architecture

## Stack
- Next.js App Router
- builders-garden/farcaster-miniapp-starter as the base
- Supabase for database and persistence
- Vercel for hosting and serverless execution
- Neynar for Farcaster data, webhooks, and cast publishing
- Privy for wallet creation and delegated execution
- OpenAI agent for command parsing and structured trade intent generation

## High-level architecture
1. User opens Mini App
2. User signs in with Farcaster
3. User creates arena wallet
4. User funds arena wallet
5. User posts cast at `@commodus`
6. Neynar webhook sends event to backend
7. Backend validates webhook and stores cast
8. OpenAI parser converts cast into structured intent
9. Policy engine validates request
10. Execution service places trade
11. Result is stored in DB
12. Commodus publishes a reply cast
13. Leaderboard updates

---

## Data Model

Minimum tables:

### `users`
- id
- created_at
- updated_at

### `farcaster_accounts`
- id
- user_id
- fid
- username
- display_name
- pfp_url

### `arena_wallets`
- id
- user_id
- wallet_address
- wallet_provider_id
- status
- created_at

### `wallet_policies`
- id
- wallet_id
- max_trade_usdc
- max_trades_per_day
- active
- created_at

### `asset_whitelist`
- id
- symbol
- name
- address
- decimals
- active

### `cast_commands`
- id
- fid
- cast_hash
- text
- parsed_action
- parsed_symbol
- parsed_amount
- status
- error_reason
- created_at

### `trade_intents`
- id
- cast_command_id
- wallet_id
- action
- asset_symbol
- amount_type
- amount_value
- status
- created_at

### `trade_executions`
- id
- trade_intent_id
- tx_hash
- execution_price
- quantity
- notional_usdc
- status
- created_at

### `positions`
- id
- wallet_id
- asset_symbol
- quantity
- avg_cost
- updated_at

### `portfolio_snapshots`
- id
- wallet_id
- total_value_usdc
- realized_pnl_usdc
- unrealized_pnl_usdc
- captured_at

### `leaderboard_snapshots`
- id
- user_id
- month
- points
- realized_pnl_pct
- rank
- captured_at

### `reward_epochs`
- id
- month
- total_token_amount
- status
- created_at

---

## API / Backend Requirements

### Auth / App
- Farcaster sign-in endpoint
- session handling

### Wallets
- create arena wallet
- get wallet status
- get funding instructions
- get wallet policy

### Farcaster ingestion
- Neynar webhook endpoint
- idempotent cast ingestion
- signature verification

### Trading
- parse command
- validate command
- execute trade
- fetch status
- fetch recent trades

### Leaderboard
- current month standings
- user rank
- top players
- recent activity

### Rewards
- monthly reward snapshot
- export winners
- mark rewards distributed

---

## Functional Requirements

## Onboarding
- user can sign in with Farcaster
- user can create arena wallet
- user can see wallet address
- user can fund wallet
- user can see approved assets before trading

## Trade Execution
- user can issue a supported public trade command
- system can parse valid commands
- system can reject invalid commands
- system can execute valid trades
- system can publish public confirmation or rejection
- each cast is processed only once

## Leaderboard
- leaderboard updates from stored executions and closed trades
- points and rank are visible in app
- user's portfolio and recent trades are visible in app

## Rewards
- system can determine monthly winners
- system can export or display winners for GLORY distribution

---

## UX Requirements

### Arena page
Must show:
- arena wallet status
- wallet balance
- approved assets
- how to trade
- sample commands

### Portfolio page
Must show:
- holdings
- portfolio value
- realized PnL
- recent trades

### Leaderboard page
Must show:
- rank
- username
- points
- realized PnL %
- last trade time

### Rules page
Must show:
- how commands work
- what assets are allowed
- scoring rules
- how monthly rewards work

---

## Security and Trust Requirements

- verify all incoming Farcaster webhook requests
- keep trade execution secrets server-side only
- enforce hard asset whitelist
- enforce max trade size
- enforce max daily scoring trades
- do not execute unparseable commands
- do not allow duplicate processing of the same cast
- log all command, validation, and execution events
- show enough user-facing detail to make the system feel credible

Trust is critical because the product asks users to fund a wallet and let Commodus trade from it.

---

## Success Metrics

### MVP success metrics
- number of users who sign in
- number of users who create arena wallets
- number of funded wallets
- number of public trade casts
- command success rate
- weekly active traders
- leaderboard visits
- number of users who trade more than once
- number of users eligible for monthly rewards

### Demo success
A successful demo should show:
- onboarding
- wallet creation
- funding
- public cast trade
- Commodus reply
- updated leaderboard

---

## Open Questions

- exact whitelist for MVP
- exact DEX / routing implementation
- manual vs automated monthly GLORY distribution
- whether users can edit policy limits in MVP
- whether `status` command should reply publicly or link back to app
- whether closed-trade accounting should require full sell back into USDC for clean PnL
- whether leaderboard resets monthly or maintains all-time stats too

---

## Suggested Build Order

### Phase 1
- clone starter
- get Mini App metadata working
- get Farcaster sign-in working
- add Supabase schema

### Phase 2
- create arena wallet flow
- fund wallet screen
- approved assets screen
- rules page

### Phase 3
- Neynar webhook ingestion
- cast parser
- command validation
- execution service
- Commodus reply casts

### Phase 4
- portfolio tracking
- points engine
- leaderboard UI
- monthly winner calculation

### Phase 5
- polish
- copy updates
- demo script
- launch prep

---

## One-Line Product Definition

**Commodus is a Farcaster trading game where users fund an arena wallet, trade in public, climb the leaderboard, and earn GLORY.**
