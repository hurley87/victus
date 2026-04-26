-- Add BankrCoin (BNKR) for Base mainnet. The address some surfaces show as
-- 0xaec0…ce703 is the Uniswap v3 pool (BNKR/WETH); execution and balances use
-- the underlying ERC-20: 0x22af33fe…d3c76f3b.
insert into public.asset_whitelist (symbol, name, address, decimals, is_tradable, is_blocklisted)
values
  ('BNKR', 'BankrCoin', '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b', 18, true, false);
