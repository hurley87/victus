-- =========================================================================
-- referrals (applied to hosted project as 20260426002624_add_referrals)
-- =========================================================================

create table public.referrals (
  id                uuid primary key default gen_random_uuid(),
  referrer_user_id  uuid not null references public.users(id) on delete cascade,
  referred_user_id  uuid not null references public.users(id) on delete cascade,
  referrer_fid      bigint not null,
  referred_fid      bigint not null,
  referred_at       timestamptz not null default now(),
  first_funded_at   timestamptz,
  awarded_at        timestamptz,
  award_month       text check (award_month is null or award_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  award_points      integer not null default 0,
  constraint referrals_unique_referred_user unique (referred_user_id),
  constraint referrals_no_self_user check (referrer_user_id <> referred_user_id),
  constraint referrals_no_self_fid check (referrer_fid <> referred_fid)
);

create index referrals_referrer_idx
  on public.referrals(referrer_user_id, referred_at desc);

create index referrals_referrer_award_month_idx
  on public.referrals(referrer_user_id, award_month)
  where awarded_at is not null;

create index referrals_award_month_idx
  on public.referrals(award_month)
  where awarded_at is not null;

alter table public.referrals enable row level security;
