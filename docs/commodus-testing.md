# Testing Commodus Autotrader

Validate the autotrader from unit tests through a real swap and cast. **Preview or staging first**, then production.

Strategy and file map: [`commodus-trading-strategy.md`](./commodus-trading-strategy.md) §9.

---

## Prerequisites (once per environment)

| Item | Note |
|------|------|
| Env | `COMMODUS_FID`, `CRON_SECRET`, `ADMIN_API_TOKEN`, `NEYNAR_SIGNER_UUID` (casts), same Supabase / Privy as the app |
| Bootstrap | `POST /api/admin/commodus/bootstrap` with Bearer `ADMIN_API_TOKEN` (idempotent) |
| USDC | Fund the Commodus arena wallet on Base (v1 BUY = **1 USDC**; buffer for fees). No autodeposit. |
| Gas | If `PRIVY_SPONSOR_GAS` is false, the arena wallet needs a little ETH on Base |

```bash
curl -s -X POST "$BASE/api/admin/commodus/bootstrap" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

---

## 1. Unit tests

```bash
pnpm test lib/commodus/autotrader
```

Use full `pnpm test` after changes that touch `vitest` / env / shared policy mocks.

---

## 2. Dry run

Decision + snapshot + `commodus_autotrader_runs` row; **no** swap, **no** cast. Use a **unique** `slotKey` (avoid the daily cron key until you mean to use it).

```bash
curl -s "$BASE/api/cron/commodus-autotrade?dryRun=1&slotKey=test:dry:$(date +%s)" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Expect `status: "dry_run"`. Check `commodus_autotrader_runs.analysis` in Supabase.

---

## 3. Live run

Full pipeline including cast. **New `slotKey` per attempt** (idempotency skips repeats).

```bash
SLOT="manual:$(date +%Y-%m-%dT%H%M%S)"
curl -s "$BASE/api/cron/commodus-autotrade?slotKey=$SLOT" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Verify:

1. JSON: `executed` or `hold_posted`, `publishedCastHash` when a cast was sent.
2. `commodus_autotrader_runs` row for that `slotKey`.
3. If `executed`: `trade_executions` + explorer (swap and fee).
4. Farcaster: new top-level cast on Commodus.

**Idempotency:** same `slotKey` again → `status: "skipped"`, no second trade.

---

## 4. Policy HOLD + cast (optional)

Temporarily set Commodus `max_trades_per_day` to `0` in `wallet_policies`, run step 3 with a fresh `slotKey`, expect `hold_posted` and a cast. **Revert** the policy after.

---

## 5. Production cron

Daily slot key: `commodus-autotrade:YYYY-MM-DD:slot-1` (UTC). After steps 1–3 look good:

```bash
curl -s "$BASE/api/cron/commodus-autotrade" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Watch host logs at the scheduled time; expect one success or `skipped` if the day’s slot already finished.

---

## Tips

- **`$BASE`** — `http://localhost:3000`, a Vercel preview URL, or production.
- **Slot keys** — Use `test:…` / `manual:…` for experiments; keep the `commodus-autotrade:YYYY-MM-DD:slot-1` shape for the real daily run.
- **Auth** — When `CRON_SECRET` is set, cron requests need `Authorization: Bearer <CRON_SECRET>`.
- **`not_provisioned`** — Complete prerequisites; fund the wallet.
- **Retries** — New `slotKey` for a new attempt; do not edit old run rows to replay.
- **Casts** — Set `NEYNAR_SIGNER_UUID` before debugging publish behavior.

---

*Last updated: 2026-04-25*
