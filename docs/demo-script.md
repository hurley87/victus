# Demo outline (MVP)

Maintainer runs the concrete timed dry-run on production infrastructure; this document is a short runbook only.

## Goal

Walk a first-time user from zero to a scored trade and a leaderboard glance, validating custodial Commodus end-to-end.

## Steps

1. **Open Mini App** — Launch the Farcaster Mini App URL deployed to production.
2. **Sign in** — Complete authentication with the test Farcaster account.
3. **Mint gladiator** — From Arena, mint; confirm a gladiator name and arena wallet appear.
4. **Fund** — Send USDC on Base to the shown arena address until the gladiator is alive (≥ minimum mint deposit per live rules).
5. **Buy** — Cast `@commodus buy N usdc of SYMBOL` using tickers from the Rules page / Arena whitelist; expect an intent reply then a success outcome on chain (target ≤ ~15s cast → final outcome when infra is healthy).
6. **Sell** — Cast `@commodus sell P% of SYMBOL` for a held position; expect outcome reply with fill summary.
7. **Status** — Cast `@commodus status` (ack behavior per current workflow; full portfolio reply is tracked separately).
8. **Leaderboard** — Open `/leaderboard` and confirm the test account appears with expected points after trades.

## Fallbacks

- **Rules / whitelist mismatch** — Open `/rules` and copy examples that match live tradable symbols from the payload.
- **Funding delay** — Wait for the next Arena poll or trigger a refetch; deposits are confirmed on Base.
- **Provider errors** — Retry once; if quotes or Privy fail persistently, stop and check deployment logs and env (0x, Privy sponsor gas).

## Note

Timings are optional; success means the full path completes without manual(chain) intervention beyond the hosted custodial flow.
