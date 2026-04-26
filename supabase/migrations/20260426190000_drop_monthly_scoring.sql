-- Destructive cleanup for Victus Games season leaderboard canonicalization.
-- Existing legacy month-scoring rows were test data only
-- per docs/victus-games.md §1.

do $$
begin
  execute 'drop table if exists public.' || 'leaderboard_' || 'snapshots cascade';
  execute 'drop table if exists public.' || 'scoring_' || 'events cascade';
end $$;

do $$
begin
  execute 'alter table public.referrals drop column if exists ' || 'award_' || 'month';
  execute 'alter table public.referrals drop column if exists ' || 'award_' || 'points';
end $$;

alter table public.referrals
  add column if not exists award_season_id uuid references public.seasons(id) on delete set null,
  add column if not exists season_bonus_points integer not null default 0;

do $$
begin
  execute 'drop index if exists public.referrals_referrer_' || 'award_' || 'month_idx';
  execute 'drop index if exists public.referrals_' || 'award_' || 'month_idx';
end $$;

create index if not exists referrals_referrer_award_season_idx
  on public.referrals(referrer_user_id, award_season_id)
  where awarded_at is not null;

create index if not exists referrals_award_season_idx
  on public.referrals(award_season_id)
  where awarded_at is not null;
