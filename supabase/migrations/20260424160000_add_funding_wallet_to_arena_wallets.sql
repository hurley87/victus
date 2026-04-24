alter table public.arena_wallets
  add column funding_wallet_address text,
  add column funding_wallet_tx_hash text,
  add column funding_wallet_verified_at timestamptz;

alter table public.arena_wallets
  add constraint arena_wallets_funding_wallet_address_format
    check (
      funding_wallet_address is null
      or funding_wallet_address ~ '^0x[a-fA-F0-9]{40}$'
    ),
  add constraint arena_wallets_funding_wallet_tx_hash_format
    check (
      funding_wallet_tx_hash is null
      or funding_wallet_tx_hash ~ '^0x[a-fA-F0-9]{64}$'
    );

create index arena_wallets_funding_wallet_address_idx
  on public.arena_wallets(lower(funding_wallet_address))
  where funding_wallet_address is not null;

create index arena_wallets_funding_wallet_tx_hash_idx
  on public.arena_wallets(lower(funding_wallet_tx_hash))
  where funding_wallet_tx_hash is not null;

comment on column public.arena_wallets.funding_wallet_address is
  'Latest externally owned wallet address verified from an on-chain USDC '
  'funding transfer into this arena wallet. Preferred withdraw destination.';

comment on column public.arena_wallets.funding_wallet_tx_hash is
  'Base transaction hash whose USDC Transfer log last verified '
  'funding_wallet_address.';

comment on column public.arena_wallets.funding_wallet_verified_at is
  'Timestamp when the application verified funding_wallet_tx_hash and saved '
  'funding_wallet_address.';
