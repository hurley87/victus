-- Lower default minimum season trade / qualifying-trade notional (docs/victus-games.md §3).
alter table public.seasons
  alter column min_trade_size_usdc set default 0.5;
