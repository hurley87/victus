-- Issue #12: structured execution failures for score-time enforcement,
-- whitelist violations, and operator telemetry.

alter table public.trade_executions
  add column failure_reason text;

comment on column public.trade_executions.failure_reason is
  'Structured failure code when status is failed or reverted (price_impact, non_whitelisted_token, revert, etc.).';
