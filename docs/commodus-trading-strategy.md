# Commodus Autotrader v1 — Trading Strategy

This document describes the **human-approved trading strategy** for Commodus Autotrader v1. It exists so operators and contributors can review assumptions, tune behavior over time, and keep implementation aligned with intent.

## Scope: strategy only, not policy

**This document is not a separate enforcement layer.** It does not define Commodus-specific trade restrictions, alternate whitelists, or bypass paths. The application must continue to enforce the **same** rules as for normal players:

- The same asset whitelist and trade restrictions
- The same execution pipeline (quote, policy, Privy, fees, scoring)
- The same portfolio / lot accounting and leaderboard scoring

Autotrader code may only **choose among actions that the normal player system would already allow** for the Commodus arena wallet and FID. This doc explains *how* Commodus ranks candidates and when it prefers HOLD—the not *what* counts as legal in the game.

If this document and the code ever disagree on *eligibility*, **normal player restrictions win**. If they disagree on *preferences* (weights, thresholds), update this document when you change those weights so the record stays honest.

---

## 1. Strategy summary

Commodus trades as a **public opponent with receipts**: autonomous, visible, and auditable on the same rails as everyone else.

The goal is **not** optimal trading or maximum returns. The goal is **entertaining, auditable, small autonomous trades** that create **narrative** and **leaderboard competition**—a character you can compare yourself to, not a hedge fund.

---

## 2. v1 trading philosophy

- **Small moves only.** Size and frequency stay within the spirit of the arena, not maximum capital deployment.
- **Prefer HOLD when signals are weak.** Doing nothing is a valid, often preferred action.
- **Prefer whitelisted tokens** with enough social attention (when measured) and **clean quote quality** from the existing trade path.
- **Never trade unlisted or unapproved tokens.** Only symbols the normal player system already allows.
- **Never bypass normal player rules.** No special cases in policy, execution, or scoring for Commodus-as-autotrader.
- **Avoid overtrading.** Cadence and churn should feel human-scaled, not bot-spam.
- **Every action should produce a readable story**—wins, losses, and holds should make sense in a short narrative.

---

## 3. Decision inputs

The decision engine may consider, among other things:


| Input                                | Role                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Whitelisted tokens**               | The only symbols that may appear in a BUY; same list as players.                                         |
| **Commodus wallet balance**          | Cash and positions available for sells and sizing.                                                       |
| **Existing Commodus positions**      | What can be sold; portfolio shape for “fit.”                                                             |
| **Recent Commodus trade history**    | Cooldown, churn, and narrative continuity.                                                               |
| **Quote availability**               | Whether a viable 0x (or configured) path exists.                                                         |
| **Quote quality**                    | Slippage, price impact, and other signals from **existing** normal trade checks—not a parallel standard. |
| **Optional Neynar social signal**    | Mentions / attention for **whitelisted** tokens only (see below).                                        |
| **Normal player trade restrictions** | Rate limits, policy, and any other gates—applied identically.                                            |


---

## 4. Decision actions


| Action   | When                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **BUY**  | Only a **whitelisted** token, only if **normal player rules** allow the trade (balance, limits, policy, quote, etc.).           |
| **SELL** | Only from an **existing Commodus position**, only if **normal player rules** allow it.                                          |
| **HOLD** | **Default** when the signal is weak, the quote is poor, restrictions reject the trade, or autotrader is **disabled / dry-run**. |


HOLD is not a failure state; it is often the correct competitive and narrative choice.

---

## 5. Candidate scoring (v1 heuristic)

Among **eligible** BUY or SELL candidates (already passing normal player gates), the engine ranks options with a simple weighted score. **Initial v1 model:**

```
score =
  socialScore      * 0.25
+ quoteQualityScore * 0.25
+ portfolioFitScore * 0.20
+ cooldownScore    * 0.10
- riskScore        * 0.30
```

- **socialScore** — Optional signal from Neynar (or similar), normalized; only informs **which approved token** to favor, not whether a token is tradable.
- **quoteQualityScore** — Derived from the same slippage / impact / quality outputs the normal path already uses.
- **portfolioFitScore** — How well a candidate fits diversification, existing exposure, or story (implementation-defined, still within allowed positions).
- **cooldownScore** — Encourages spacing trades so Commodus does not spam; higher when a trade is “due” in a healthy cadence.
- **riskScore** — Proxy for size, concentration, or volatility (implementation-defined, bounded by the same max sizes and policy as players).

This is a **v1 heuristic**. Weights and sub-scores may change; when they do, **update this document** so review and code stay aligned.

---

## 6. Neynar usage

- Neynar provides **social context only** (e.g., attention or mentions) to rank or order **whitelisted** candidates.
- **Neynar-discovered tokens that are not on the whitelist are ignored** for trading—they cannot become tradable through social signal alone.
- Social signal can influence **which approved token** Commodus focuses on, never **whether** a token is allowed.

---

## 7. Narrative rules

- Public posts use **first-person Commodus** voice, consistent with the product.
- The **LLM summarizes** the deterministic analysis and outcome (what was considered, what was chosen, why HOLD).
- The **LLM does not change trade decisions**; decisions are made by the rule-bound engine, then described.
- Copy should be **creative and short**, and **not financial advice** (no recommendations to users; in-character flavor only).

---

## 8. Review process

1. **Update this document** when strategy, weights, or assumptions change.
2. **Keep implementation aligned** with the documented strategy; treat drift as a bug in either code or docs.
3. On conflict: **normal player trade restrictions and app enforcement always win** over this strategy doc.

---

## 9. v1 implementation pointers (code)

- **Cron** — `GET /api/cron/commodus-autotrade` (see `vercel.json`, `0 14 * * *` UTC). Idempotency key per run: `commodus-autotrade:YYYY-MM-DD:slot-1`. Optional `?dryRun=1`.
- **Bootstrap** — `POST /api/admin/commodus/bootstrap` (Bearer `ADMIN_API_TOKEN`) provisions the Commodus `users` + `farcaster_accounts` + `arena_wallets` + `wallet_policies` row and a dedicated Privy wallet. Fund that wallet with USDC like any player; `funded_at` is set so the same **wallet-funded** gate as everyone else applies.
- **Engine** — `lib/commodus/autotrader/decision.ts` (weights in §5) + `snapshot.ts` (whitelist, 0x quotes, positions, cooldown). **Sizing v1:** BUY **1 USDC** stated; SELL **25%** of position.
- **Execution** — `lib/commodus/autotrader/execute.ts` reuses `validatePolicy`, `reserveOrLoadExecution`, Privy swap, decode, fee transfer, lots, `scoreTradeAfterExecution` (same path as human players).
- **Narrative** — `lib/commodus/autotrader/narrate.ts`: LLM copies only; trades are already decided in code.
- **State** — `commodus_autotrader_runs` (Supabase migration `20260425120000_add_commodus_autotrader_runs.sql`).

---

## 10. Operator testing

How to test: [`commodus-testing.md`](./commodus-testing.md).

---

*Last updated: 2026-04-25 — initial v1 strategy document; §9 implementation alignment; §10 links to operator testing guide.*