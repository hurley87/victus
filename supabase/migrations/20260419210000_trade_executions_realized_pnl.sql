-- Issue #10: realized P&L on the closing trade_executions row (sells).

alter table public.trade_executions
  add column realized_pnl_usdc   numeric(38, 18),
  add column realized_return_pct numeric(38, 18);

comment on column public.trade_executions.realized_pnl_usdc is
  'Aggregate realized profit/loss in USDC for a sell execution (FIFO), '
  'after swap fee on proceeds. Buys leave this null.';

comment on column public.trade_executions.realized_return_pct is
  'realized_pnl_usdc / total cost basis of lots closed × 100. Null when '
  'no cost basis was closed.';
