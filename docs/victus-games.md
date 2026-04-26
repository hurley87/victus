# Victus Games — PRD

## 1. Summary

**Victus Games** is a weekly fantasy-style token trading contest built on top of the existing Victus Imperium execution pipeline. Every player starts each season with the same virtual **10 USDC arena balance**, **5 trade tickets**, and access to **6 approved tokens**. The wallet is used only to execute trades on-chain; the **Victus game ledger** is the sole source of truth for scoring.

The existing month-based scoring model is replaced by a season-scoped ledger. Existing legacy scoring rows are test data and can be dropped.

## 2. Mental Model

| Concept | Role |
|---|---|
| Wallet | Execution account. Holds real USDC + tokens for swap settlement. |
| Victus ledger | Game state. Tracks virtual cash, trades used, season positions. |
| Trades | The only valid game actions. |
| Deposits | Ignored by game state. |
| External token transfers | Ignored by game state. |

**Game balance and leaderboard score must never be derived from live wallet balances.**

## 3. Game Constraints

- Season length: 1 week
- Entry requirement: wallet must hold ≥ 10 USDC
- Starting virtual arena balance: 10 USDC (always exactly 10, even if wallet has more)
- Max trades per season: 5
- Approved tokens per season: 6
- Minimum trade size: 2 USDC
- Leaderboard / reward eligibility: ≥ 1 completed qualifying trade
- No leverage, no shorts, spot buy/sell only
- Only Victus-executed trades count
- Deposits, withdrawals, external transfers do not affect scoring
- Trade tickets are limited ammo, not a score source

### Eligibility examples

**Valid (eligible):** Start 10 USDC → buy 2 USDC AERO → hold 8 USDC cash → settle.

**Invalid (not eligible):** Start 10 USDC → make no trades → settle. Holding the original 10 USDC without trading does not qualify for rewards.

## 4. Data Model

New tables introduced; legacy month-scoring test data can be wiped.

### 4.1 `seasons`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. "Week 18 · 2026" |
| status | text | `upcoming` \| `active` \| `settled` |
| starts_at | timestamptz | |
| ends_at | timestamptz | |
| starting_balance_usdc | numeric | default 10 |
| max_trades | int | default 5 |
| min_trade_size_usdc | numeric | default 2 |
| settled_at | timestamptz | nullable |
| created_at | timestamptz | |

Unique partial index: only one `status='active'` season at a time.

### 4.2 `season_tokens`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| season_id | uuid FK | |
| token_symbol | text | |
| token_address | text | |
| chain_id | int | default 8453 |
| decimals | int | |
| is_active | boolean | |
| closing_price_usdc | numeric | populated at settlement |

Unique on (season_id, token_symbol). Only these tokens are tradable in the season.

### 4.3 `season_entries`
One row per player per season.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| season_id | uuid FK | |
| user_id | uuid FK | |
| wallet_id | uuid FK | arena_wallets |
| starting_balance_usdc | numeric | default 10 |
| cash_remaining_usdc | numeric | default 10 — **virtual cash, not wallet balance** |
| trades_used | int | default 0 |
| max_trades | int | default 5 |
| has_qualifying_trade | boolean | default false |
| status | text | `active` \| `settled` \| `disqualified` |
| settled_portfolio_value_usdc | numeric | nullable |
| settled_return_pct | numeric | nullable |
| created_at / updated_at | timestamptz | |

Unique on (season_id, user_id).

### 4.4 `season_trades`
Every valid Victus trade.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| season_id | uuid FK | |
| season_entry_id | uuid FK | |
| user_id | uuid FK | |
| wallet_id | uuid FK | |
| trade_execution_id | uuid FK UNIQUE | links to existing `trade_executions` for idempotency |
| action | text | `buy` \| `sell` |
| token_symbol | text | |
| token_address | text | |
| notional_usdc | numeric | |
| token_amount | numeric | |
| execution_price | numeric | |
| fees_usdc | numeric | |
| tx_hash | text | |
| status | text | `pending` \| `executed` \| `failed` |
| created_at | timestamptz | |

Only `executed` trades affect cash, positions, and scoring.

### 4.5 `season_positions`
Current game position per player per token in the active season.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| season_id | uuid FK | |
| season_entry_id | uuid FK | |
| user_id | uuid FK | |
| token_symbol | text | |
| token_address | text | |
| token_amount | numeric | derived **only** from Victus trades |
| average_entry_price | numeric | |
| updated_at | timestamptz | |

Unique on (season_entry_id, token_symbol). On-chain wallet balances are never used as game positions.

## 5. Season Entry Flow

1. Find or create the active season.
2. Read live wallet USDC balance — reject if `< 10 USDC` with `insufficient_funding`.
3. Idempotently insert a `season_entry`:
   - `starting_balance_usdc = 10`
   - `cash_remaining_usdc = 10`
   - `trades_used = 0`
   - `max_trades = 5`
   - `has_qualifying_trade = false`
   - `status = active`
4. Do **not** scale arena balance to wallet balance; 10 USDC is fixed regardless of deposit size.

## 6. Trade Validation

### 6.1 Common pre-checks (all trades)
- Active season exists.
- Player has a `season_entry` for that season.
- `season_entry.status = 'active'`.
- `trades_used < max_trades`.
- Token is in the active season's approved list.
- Action is spot `buy` or `sell` only — reject leverage, shorts, unsupported actions.

### 6.2 Buys
- Notional ≥ `min_trade_size_usdc` (2 USDC).
- Notional ≤ `cash_remaining_usdc`.
- **Live wallet USDC balance does not increase buying power.**

> Example: wallet holds 100 USDC, `cash_remaining_usdc = 6 USDC` → max Victus buy is 6 USDC.

### 6.3 Sells
- Player can only sell tokens they acquired via Victus trades in the current season.
- Load `season_position` for the token. Reject if requested `token_amount > position.token_amount`.
- Externally transferred tokens are not sellable game inventory.

> Example: wallet has 1,000 DEGEN externally, but Victus position is 100 DEGEN → max sell is 100 DEGEN.

### 6.4 Rejection reasons (canonical)
`no_active_season`, `no_season_entry`, `season_entry_inactive`, `season_max_trades_reached`, `season_token_not_approved`, `season_min_trade_size`, `season_insufficient_arena_balance`, `season_insufficient_position`, `needs_wallet_funding`.

## 7. Post-Trade Ledger Updates

### 7.1 After a successful buy
- Insert `season_trades` row (`status=executed`).
- `cash_remaining_usdc -= (USDC spent + fees, if fees are part of game accounting)`.
- `trades_used += 1`.
- If `notional_usdc >= min_trade_size_usdc`, set `has_qualifying_trade = true`.
- Upsert `season_positions`: increase `token_amount`; weighted-average `average_entry_price`.

### 7.2 After a successful sell
- Insert `season_trades` row.
- `cash_remaining_usdc += (USDC proceeds − fees)`.
- `trades_used += 1`.
- If `notional_usdc >= min_trade_size_usdc`, set `has_qualifying_trade = true`.
- Decrease `season_positions.token_amount`. If dust-level (< 1e-12), treat as closed for display.

### 7.3 Failed swap
- **Do not** consume a trade ticket.
- **Do not** update cash or positions.
- `season_trades.status` stays `pending` or is upgraded to `failed` for audit; nothing else mutates.

## 8. Leaderboard

Leaderboard never reads wallet balances.

```
portfolio_value =
    season_entry.cash_remaining_usdc
  + Σ season_position.token_amount × current_or_closing_price

performance_return =
    (portfolio_value − starting_balance_usdc) / starting_balance_usdc
```

- **Active season**: use live token prices (0x quote, cached briefly) for estimated portfolio value.
- **Settled season**: use `season_tokens.closing_price_usdc` set at settlement. Open positions are virtually settled — players do not need to manually sell before the deadline.

> Example: starting 10, current/settled 11.25 → return +12.5%.

### 8.1 Eligibility
- Eligible: `has_qualifying_trade = true` AND `status != 'disqualified'`.
- Ineligible entries are shown as **"Not qualified"** and excluded from reward rankings. Holding the original 10 USDC without trading cannot win.

## 9. Scoring (100-point system)

```
final_score = performance_points + survival_bonus + commodus_bonus
```

Referral awards are season-scoped. First funding still triggers the referral
conversion, but the bonus is recorded against the current leaderboard season as
`season_bonus_points`; it no longer participates in the retired month-based
leaderboard path. Human reviewers should explicitly sign off that referral
bonus points belong in the season reward model before this destructive cleanup
merges.

### 9.1 Performance points (up to 90)
Rank eligible players by settled portfolio value (or performance return). v0 award table:

| Rank | Points |
|---|---|
| 1 | 90 |
| 2 | 80 |
| 3 | 70 |
| 4 | 60 |
| 5 | 50 |
| 6 | 40 |
| 7 | 30 |
| 8 | 20 |
| 9 | 10 |
| 10+ | 0 |

### 9.2 Survival bonus (+5)
Awarded if the player finishes the week with a valid, non-disqualified portfolio AND has at least one qualifying trade.

### 9.3 Commodus bonus (+5)
Awarded if the player finishes above Commodus on the weekly leaderboard.

### 9.4 No trade-volume points
A player using 1 trade is not penalized vs a player using 5. Score is final portfolio value.

### 9.5 Tie-breakers
1. Higher settled portfolio value.
2. Fewer trades used.
3. Earlier season entry timestamp.

This makes one excellent trade competitive with five.

## 10. Settlement

Triggered when `now() >= season.ends_at`:

1. For each `season_token`, fetch closing price via 0x quote and store in `closing_price_usdc`.
2. For each `active` `season_entry`:
   - Compute `portfolio_value` using closing prices (no real on-chain sells).
   - Set `settled_portfolio_value_usdc`, `settled_return_pct`, `status='settled'`.
3. `seasons.status='settled'`, `settled_at=now()`.
4. Trading is implicitly frozen: validation rejects with `no_active_season` until the next season activates.

## 11. UI Requirements

### 11.1 Visible state
- Entry requirement: 10 USDC minimum wallet funding
- Arena Balance: 10 USDC (fixed)
- Cash Remaining
- Trades Remaining (e.g. 3 / 5)
- Minimum Trade Size: 2 USDC
- Approved Tokens (chip list)
- Current Portfolio Value
- Current Return
- Weekly Rank
- Commodus Rank
- Qualification Status badge

### 11.2 Wallet vs Arena distinction
The wallet card shows the live wallet balance. The arena card shows fixed 10 USDC starting balance + cash remaining. The two must be visually distinct and clearly labeled.

### 11.3 Approved copy
- "Fund your arena wallet with at least 10 USDC to enter."
- "Every Victus week starts with the same 10 USDC arena balance."
- "Your wallet may hold more funds, but extra funds do not increase your arena balance."
- "Only trades made through Victus count toward your score."
- "You must make at least one 2 USDC trade to qualify for weekly rewards."
- "Deposits, withdrawals, and outside transfers do not affect your arena portfolio."
- "Trades are limited moves. You do not earn points for using more trades."
- "Your score is based on final portfolio value."

### 11.4 Forbidden copy
Anything that implies:
- Depositing more increases arena balance.
- Live wallet balance determines leaderboard score.
- Using more trades gives more points.
- Players can win rewards without making a trade.

## 12. Edge Cases

| # | Scenario | Behavior |
|---|---|---|
| 1 | User deposits extra USDC | Ignored for game state and scoring. |
| 2 | User receives external tokens | Ignored for game positions and scoring. |
| 3 | Buy > virtual cash | Reject: "Insufficient arena balance." |
| 4 | Buy < min trade size | Reject: "Minimum trade size is 2 USDC." |
| 5 | Sell > Victus position | Reject: "You can only sell tokens bought through Victus this season." |
| 6 | Enough virtual cash but insufficient live wallet funds | Execution fails with clear message. Virtual balance is not increased. |
| 7 | Swap fails | No trade ticket consumed. No game state change. |
| 8 | Season ends | Trading freezes. Settle using official closing prices. Mark entries `settled`. |

## 13. Implementation Priority

1. Add seasons / entries / tokens / trades / positions models.
2. Make trade validation use `season_entry` and `season_positions`.
3. Enforce minimum 2 USDC trade requirement.
4. Add `has_qualifying_trade` for leaderboard / reward eligibility.
5. Switch leaderboard to Victus ledger state, not wallet balances.
6. Add UI labels for arena balance vs wallet balance.
7. Add season settlement using virtual closing prices.
8. Add scoring + tie-breakers.

## 14. Out of Scope (v0)

- Reward distribution / payouts (compute scores only).
- Auto-creation of next season (manual SQL or follow-up).
- Automatic disqualification triggers (column exists; manual for now).
- Migration of historical month-based scoring (test data; drop it).
- Deposits/withdrawals beyond the entry funding check — explicitly ignored.

## 15. Non-Goals

- Multi-chain support.
- Leverage, shorts, derivatives.
- Trade-volume rewards.
- Rewarding players who never traded.
- Allowing externally transferred tokens to count as game inventory.
