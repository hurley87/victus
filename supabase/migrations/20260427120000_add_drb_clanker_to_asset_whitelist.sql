-- DebtReliefBot (DRB) and Clanker (CLANKER) on Base. Addresses often copied from
-- DEX UIs (0x5116…8923, 0xc1a6…4f97) are Uniswap v3 pools; balances and swaps
-- use the token contracts below.
insert into public.asset_whitelist (symbol, name, address, decimals, is_tradable, is_blocklisted)
values
  ('DRB', 'DebtReliefBot', '0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2', 18, true, false),
  ('CLANKER', 'tokenbot', '0x1bc0c42215582d5a085795f4badbac3ff36d1bcb', 18, true, false);
