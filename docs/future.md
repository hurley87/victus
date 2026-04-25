# Commodus Future PRD

## Purpose

This document captures post-MVP ideas for **Commodus**.
It is intentionally separate from the MVP PRD so the team can:

- keep the initial build focused
- avoid scope creep
- preserve larger game and agent ideas for later phases
This is not a commitment to build every item below. It is a roadmap of possible expansions if the core loop works.

---

## Future Product Vision

Commodus evolves from a simple public trading game into a **persistent Farcaster arena**.
Users do not just trade. They:

- survive
- compete in seasons
- earn status
- beat Commodus
- earn GLORY
- return for recurring events and higher-stakes play
Long term, the app should feel less like a trading utility and more like a **social onchain strategy game**.

---

## Product Principles

Future versions should preserve these principles:

1. **Public by default**
  - trades should remain socially visible where possible
  - the feed is part of the game
2. **Game before finance**
  - the product should feel competitive and fun
  - game mechanics should be understandable without needing advanced DeFi knowledge
3. **Clear rules**
  - Commodus may be theatrical, but the system should remain legible
  - users should understand why they gained points, lost rank, or were eliminated
4. **Status matters**
  - rank, survival, streaks, and titles should matter as much as wallet performance
5. **Add depth gradually**
  - expand only after the MVP loop proves itself

---

## Future Phases

## Phase 0 — Post-Hackathon Technical Migrations

These are not game-design improvements; they are the technical compromises taken for the MVP that must be resolved before any public / at-scale launch.

### Custody migration: Option A → Option B (then C)

The MVP uses **Privy server wallets** (Option A) for speed. This means the arena wallet's private key is held server-side, which is fine for a capped $50 hackathon demo but not for real users.

Path:

- **Option B (first migration)**: Privy **embedded wallet** + **delegated actions**. The user owns the wallet (Shamir + TEE), delegates scoped trading rights to the backend, and can revoke at any time. This preserves the cast-triggered auto-execute loop without custodying user funds.
  - New onboarding step: "Grant trading authority" consent modal.
  - New policy: delegation is scoped to the 0x exchange proxy, the whitelisted assets, and the policy limits.
  - Migration is one-shot: sweep each user's Option-A balance into their newly provisioned Option-B wallet, retire the server-wallet address, update `arena_wallets.wallet_address`.
- **Option C (second migration, optional)**: user-owned **smart account** with an onchain **session key / permission module** (Coinbase Smart Wallet, ZeroDev, Safe 7579). Permissions enforced at the contract layer rather than at Privy's delegation layer. Strongest trust story, highest build cost. Only worth doing if volume justifies it.

### Lift the $50 wallet cap

Introduced solely to bound the custodial-risk blast radius in MVP. Remove it once Option B is live. Revisit the default trade size and daily cap at the same time.

### Beta dependency hardening

MVP uses Vercel Queues + Vercel Workflow in public beta. Before public launch:

- confirm both products have hit GA or have long-term commitment signals
- if not, switch to **Upstash QStash + Supabase-driven state machine** (interface-compatible — documented as the MVP fallback plan)

### Base Sepolia staging environment

MVP ships only to Base mainnet with no pre-prod chain. Before team grows, stand up a Base Sepolia mirror of the full pipeline for safer iteration.

### Role-based admin access

MVP gates the admin UI by a single allowlisted FID. When the team grows beyond one operator, add proper role-based access control.

### Rate limiting at ingress

MVP relies on policy caps (trade size, daily count) as its only rate limit. Before public launch, add IP-and-FID rate limiting on the webhook endpoint to handle potential spam / abuse.

---

## Phase 1.5 — Stronger Competition Layer

This phase improves the game loop without changing the core architecture too much.

### Goals

- create stronger retention
- make the leaderboard more dynamic
- add urgency to participation

### Features

#### Weekly elimination

Each week, the bottom portion of players is removed from active competition for the rest of the season.
Suggested implementation:

- weekly judgment event
- bottom 10% or bottom fixed number eliminated
- eliminated players keep custody of funds
- eliminated players can still view the leaderboard but cannot issue new scoring trades

#### Daily score windows

Introduce daily score periods so users feel pressure to return frequently.
Suggested implementation:

- reset daily score counters
- show “today’s standings”
- daily bonus for active players

#### Win streaks

Reward consistency, not just one-off trades.
Suggested implementation:

- streak bonus for profitable closed trades on consecutive days
- streak bonus for remaining active multiple days in a row

#### Better leaderboard categories

Expand beyond one board.
Suggested future boards:

- overall points
- realized PnL %
- current streak
- highest-value portfolio
- most profitable single trade

---

## Phase 2 — Commodus as Opponent

This phase introduces Commodus as a direct benchmark.

### Goals

- create a boss-fight mechanic
- make the emperor feel like an active participant
- add a compelling survival narrative

### Features

#### Commodus benchmark wallet

Commodus operates a public arena wallet.
Suggested implementation:

- Commodus announces its trades publicly
- Commodus uses the same whitelist as users
- Commodus follows a transparent scoring model
- Execution backend could be **Bankr** (`api.bankr.bot`) — a single-account agentic trading API is an excellent fit for Commodus-the-character's own wallet, where the "one API key = one wallet" model that rules it out for per-user MVP custody is actually the desired shape. Offload Commodus's own trade execution to Bankr; keep user execution on 0x.

#### Beat Commodus bonuses

Players earn extra points for outperforming Commodus during a period.
Suggested implementation:

- compare player daily score to Commodus daily score
- award a “Beat Commodus” bonus
- show users whether they surpassed the emperor today

#### Commodus status page

Add a dedicated page showing:

- current holdings
- recent trades
- current score
- performance history
- who beat Commodus today

---

## Phase 3 — Seasons

This phase formalizes the game into recurring seasonal competition.

### Goals

- create narrative structure
- support recurring launches and resets
- provide a clear reward cadence

### Features

#### Monthly seasons

The arena runs in fixed monthly seasons.
Suggested implementation:

- leaderboard resets monthly
- players start fresh each season
- final month-end standings determine GLORY rewards

#### Seasonal titles

Reward top performers with persistent titles.
Examples:

- Champion of Rome
- First House
- Consul of the Arena
- Emperor's Favorite
- Survivor

#### Season history

Users can view:

- past season ranks
- prior rewards
- all-time stats
- historical badges

#### Seasonal recaps

Commodus publishes a monthly recap:

- top gladiators
- most profitable trade
- biggest rise
- biggest fall
- total arena volume

---

## Phase 4 — GLORY Utility

This phase gives GLORY more meaning inside the game.

### Goals

- deepen retention
- make rewards feel useful
- create player progression

### Features

#### Commemorative ERC-1155 badges

In addition to (or alongside) the ERC-20 `$GLORY` airdrop, issue monthly **tiered ERC-1155 badges** from a `CommodusGlory` contract on Base:

- **Gold** (rank 1) — Champion of the Arena
- **Silver** (ranks 2–3) — Consul of the Arena
- **Bronze** (ranks 4–10) — Gladiator of the Arena
Badges carry metadata (month, rank, points, realized PnL) and are dynamic-OG image generated. Issued to the winner's Farcaster-verified address. Deferred from MVP because the user chose ERC-20 + manual airdrop for hackathon scope; the badge adds a persistent visual status artifact that complements rather than replaces the token.

#### Optional USDC top-3 bonus pool

Small monthly USDC pot (e.g. 25 USDC split 15/6/4 across top 3) on top of the GLORY airdrop, to add real-stakes texture. Funded from a treasury wallet initially; sponsor-funded or protocol-fee-funded at scale.

#### Automated onchain distribution

Replace manual CSV airdrops with a `GloryDistributor` contract that accepts a merkle root per epoch. Operator commits the root; winners claim.

#### Cosmetic unlocks

GLORY unlocks:

- profile badges
- custom titles
- visual arena flair
- leaderboard highlights

#### Resurrection mechanics

Eliminated players may be able to spend GLORY for re-entry.
Suggested implementation:

- one resurrection per season
- limited by cost or availability
- explicit rules to prevent abuse

#### Tournament entry

Special events may require GLORY to enter.
Examples:

- weekend tournaments
- high-stakes arena events
- experimental asset pools

#### Voting rights

GLORY holders can vote on limited game settings.
Examples:

- next month’s approved asset list
- next event theme
- special challenge rules
MVP should not depend on this. This is optional future utility.

---

## Phase 5 — Social and Content Layer

This phase expands the entertainment side of the product.

### Goals

- increase engagement on Farcaster
- improve spectator value
- generate recurring content

### Features

#### Rivalries

Users can challenge specific players.
Suggested implementation:

- direct challenge casts
- side-by-side score comparison
- rivalry matchups for a fixed time window

#### Public recaps and commentary

Commodus comments on the arena.
Examples:

- largest gainers
- players in danger
- dramatic losses
- monthly triumphs

#### Shareable scorecards

Users can share:

- rank cards
- trade wins
- survival streaks
- monthly reward summaries

#### Spectator mode

A user who does not participate can still follow:

- the leaderboard
- top traders
- Commodus performance
- recent notable trades

---

## Phase 6 — Expanded Game Systems

This phase deepens the strategy layer.

### Goals

- make the game richer for repeat players
- support different play styles
- reduce monotony

### Features

#### Divisions by bankroll size

Separate competition by arena size.
Examples:

- under 100 USDC
- 100 to 1,000 USDC
- 1,000+ USDC
This makes competition fairer and keeps whales from dominating one board.

#### Special event modes

Limited-time rule sets.
Examples:

- only one asset allowed
- one trade per day
- hard mode with fewer points for activity
- thematic monthly challenges

#### More nuanced scoring

Expand scoring once the base system is proven.
Potential additions:

- drawdown penalty
- concentration penalty
- consistency bonus
- risk-adjusted scoring

#### Team or house play

Players join a house and contribute toward a group score.
Examples:

- House of Mars
- House of Apollo
- House of Jupiter
This adds identity and social coordination.

---

## Phase 7 — Agent Expansion

This phase increases the role of agents without giving up clarity. The MVP already ships the OpenAI Agents SDK as the parsing runtime with a single tool (`emit_trade_intent`); this phase expands the tool surface without rewriting the agent plumbing.

### Goals

- make Commodus feel more alive
- introduce more dynamic gameplay
- preserve user trust

### Planned agent tools

- `publish_commentary_cast(text)` — scheduled Commodus commentary casts (marketing)
- `publish_recap_cast(epoch)` — monthly recap casts with top gladiators, biggest win, biggest fall, total arena volume
- `reply_to_non_command_cast(cast_hash)` — in-character responses when users reply to Commodus's posts asking "why?"
- `query_market_state(symbol)` — price and recent moves, read-only
- `decide_benchmark_trade()` — Commodus's own trading decisions for Phase 2 benchmark wallet
- `publish_danger_zone_alert(fid)` — Phase 1.5 elimination-adjacent theatrical warnings
- `publish_rivalry_matchup(fid_a, fid_b)` — Phase 5 rivalry announcements
Each new tool adds surface area but the core guardrails (Zod-validated inputs, templated voice fallbacks, tracing) carry over from MVP.

### Safeguards

- Every autonomous cast passes through a structural guardrail that verifies template-shape before publishing. The agent assembles, but the shape is enforced.
- Autonomous trading tools (Phase 2) never write to user wallets — only to Commodus's own benchmark wallet.
- Rate-limited by default; scheduled casts go through the same Vercel Workflow pipeline so they're observable, idempotent, and replayable.

### Features

#### Richer command parsing

Support more natural phrasing while still normalizing to safe structured actions. Also: **absolute-quantity sells** (`sell 100 aero`) — deferred from MVP where only `sell N%` is supported.

#### Agent commentary

Commodus explains decisions, rankings, or rejections in a more contextual way.

#### House traders

Commodus commands one or more public trading agents.
Examples:

- momentum-focused trader
- defensive trader
- contrarian trader
This should only happen if the single-Commodus model is working and manageable.

#### Arena assistants

Users can optionally get agent help in the Mini App.
Examples:

- explain recent performance
- suggest how many points are needed to move up
- summarize rules
- show why a trade did not score well

---

## Future UX Ideas

### Arena home improvements

- countdown to next judgment
- “players in danger” section
- highlighted top movers
- call-to-action to trade now

### Leaderboard improvements

- filters by time window
- filter by division
- current streak indicator
- danger zone indicator

### Portfolio improvements

- realized vs unrealized PnL
- recent closes
- reward projection
- score breakdown by trade

### Profile pages

Each user can have a public profile showing:

- rank
- all-time wins
- total GLORY earned
- best trade
- worst trade
- current streak
- season history

---

## Future Notification Ideas

Notifications should be considered after the core loop is proven.
Possible notifications:

- your rank changed
- you entered the danger zone
- Commodus replied to your trade
- weekly judgment is approaching
- you earned GLORY
- you were condemned
- you have been resurrected

---

## Future Rewards Ideas

### Expanded monthly rewards

Instead of rewarding only the top X:

- reward top X heavily
- reward survivors lightly
- reward streaks separately

### Event-specific rewards

Special arena events may have:

- one-time GLORY pools
- special badges
- limited titles

### Prestige layers

Users may earn:

- permanent badges
- crown icons
- season trophies
- commemorative collectibles

---

## Future Open Questions

- should eliminations be weekly, daily, or seasonal only?
- should players be able to re-enter a season after elimination?
- should Commodus be a benchmark only, or also a competitor for rewards?
- should GLORY be purely symbolic, or have stronger in-app utility?
- should divisions exist from the start of seasons, or based on rolling wallet size?
- should side challenges and rivalries affect leaderboard score?
- should all score systems remain public and deterministic?
- what is the right balance between theatrical flavor and product clarity?

---

## What Must Stay True

No matter how much the game expands, Commodus should still feel like:

- a **public Farcaster-native game**
- a **clear social trading competition**
- an **arena with recurring judgment**
- a place where users **fight for GLORY**

---

## Future One-Line Vision

**Commodus becomes the Colosseum of Farcaster: a public onchain arena where gladiators trade, survive judgment, rise through the ranks, and fight for GLORY.**