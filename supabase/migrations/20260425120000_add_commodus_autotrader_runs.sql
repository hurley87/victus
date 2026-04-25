-- Commodus Autotrader: one row per daily slot, idempotent by slot_key.

create table public.commodus_autotrader_runs (
  id                 uuid primary key default gen_random_uuid(),
  slot_key           text not null unique,
  status             text not null default 'pending'
    check (status in (
      'pending',
      'in_progress',
      'hold_posted',
      'executed',
      'failed',
      'dry_run',
      'skipped'
    )),
  cast_command_id    uuid null references public.cast_commands (id) on delete set null,
  trade_execution_id uuid null references public.trade_executions (id) on delete set null,
  published_cast_hash text null,
  analysis           jsonb not null default '{}'::jsonb,
  error              text null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index commodus_autotrader_runs_status_idx
  on public.commodus_autotrader_runs (status);

create index commodus_autotrader_runs_created_at_idx
  on public.commodus_autotrader_runs (created_at desc);

create trigger commodus_autotrader_runs_set_updated_at
  before update on public.commodus_autotrader_runs
  for each row execute function public.set_updated_at();

alter table public.commodus_autotrader_runs enable row level security;
