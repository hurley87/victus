# Custodial withdraw to Farcaster-verified address

**Status:** cut (was GitHub issue #14, closed as wontfix)
**Date cut:** 2026-04-18

## What was proposed

A `POST /api/arena/withdraw` endpoint that would let a user sweep their arena wallet's USDC (and optionally tokens) back to a Farcaster-verified address of theirs. The arena wallet was a Privy-provisioned server wallet; withdraw existed because funds were custodial.

## Why it was cut

The MVP pivoted to a non-custodial execution model:

- Users trade from their own Farcaster-verified EOA via the Mini App SDK's `swapToken` action.
- The server never holds keys, never holds USDC, and never seeds gas.
- The `arena_wallets` row is an index entry that points at the user's own address; there is no "custody" to exit.

With nothing to withdraw from, a withdraw endpoint is not just unnecessary — it would be misleading (suggesting custody where there is none) and structurally impossible (no private key on the server to sign the sweep).

## When this could come back

This entry becomes interesting again only if the product re-introduces any of:

- A true custodial balance held by the platform (e.g. a Privy / Turnkey server wallet)
- A pooled escrow model for competition prize distribution where the server pays out on behalf of users
- A non-custodial-but-server-assisted flow where the server submits signed user txs and needs to sweep leftover dust

None of those are on the MVP roadmap. If any ship, fork this file into a live spec and reopen.

## Related

- PRD: `docs/mvp.md` § Wallets, § Execution Rules
- Non-custodial pivot migration: `supabase/migrations/20260418120534_pivot_non_custodial_execution.sql`
- Arena address designation: issue #5
- User-signed execution: issue #7
