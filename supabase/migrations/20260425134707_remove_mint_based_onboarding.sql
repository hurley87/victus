alter table public.arena_wallets
  add column funded_at timestamptz;

update public.arena_wallets aw
set funded_at = coalesce(g.funded_at, now())
from public.gladiators g
where g.user_id = aw.user_id
  and g.status = 'alive'
  and aw.funded_at is null;

comment on column public.arena_wallets.funded_at is
  'Timestamp when this arena wallet first cleared the minimum USDC funding '
  'threshold and unlocked trading.';

alter table public.wallet_policies
  rename column min_mint_deposit_usdc to min_funding_deposit_usdc;

comment on column public.wallet_policies.min_funding_deposit_usdc is
  'Minimum cumulative USDC deposit required to unlock trading for an arena '
  'wallet. MVP default: $5.';

drop table public.gladiators;
