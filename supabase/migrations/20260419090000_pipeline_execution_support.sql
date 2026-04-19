-- Durable single-phase pipeline support (issue #8)
--
-- Two additive changes layered onto the custodial-restore schema:
--
--   1. trade_executions.privy_transaction_id
--      The reconciler needs a canonical Privy-side handle so a stuck
--      row (pending/submitted for > 15 min) can be resolved out-of-band
--      via `GET /v1/transactions/{id}`. Populated by `submit_swap`
--      immediately after the sign-and-broadcast call. UNIQUE so a
--      replay that races into the same step can't produce two
--      handles for the same execution.
--
--   2. cast_replies (cast_hash, reply_kind) guard
--      Neynar's `idempotency-key` header dedupes at their edge, but
--      the workflow step that publishes the reply also needs its own
--      replay guard: if the step was retried after the Neynar call
--      succeeded but before the step returned, we want the retry to
--      be a true no-op (not another Neynar round trip). A tiny
--      check-then-insert table keyed on `(cast_hash, reply_kind)`
--      gives us that without taking on a larger reply audit schema.
--
-- Both are safe to apply against any environment; no data backfill
-- needed.

-- =========================================================================
-- trade_executions.privy_transaction_id
-- =========================================================================

alter table public.trade_executions
  add column privy_transaction_id text;

alter table public.trade_executions
  add constraint trade_executions_privy_transaction_id_key
    unique (privy_transaction_id);

comment on column public.trade_executions.privy_transaction_id is
  'Privy-side canonical transaction id returned by the server-wallet '
  'eth_sendTransaction call. Set by submit_swap. Reconciler uses this '
  'to resolve the final on-chain tx_hash for rows stuck in submitted '
  'state without a populated tx_hash (the sponsored UserOp path returns '
  'an empty hash at broadcast time).';

-- =========================================================================
-- cast_replies — reply-kind idempotency guard
-- =========================================================================

create table public.cast_replies (
  id              uuid primary key default gen_random_uuid(),
  cast_hash       text not null references public.cast_commands(cast_hash)
                  on delete cascade,
  reply_kind      text not null
                  check (reply_kind in ('intent', 'outcome')),
  reply_cast_hash text,
  published_at    timestamptz not null default now(),
  constraint cast_replies_hash_kind_unique unique (cast_hash, reply_kind)
);

comment on table public.cast_replies is
  'Per-cast reply idempotency guard. Exactly one row per '
  '(cast_hash, reply_kind) — the workflow step performs a check-then-'
  'insert so a replay after a successful Neynar publish is a pure '
  'no-op (no second API call). Neynar''s own `idempotency-key` header '
  'is still set as a belt-and-braces defense at their edge.';

create index cast_replies_cast_hash_idx on public.cast_replies(cast_hash);

alter table public.cast_replies enable row level security;
