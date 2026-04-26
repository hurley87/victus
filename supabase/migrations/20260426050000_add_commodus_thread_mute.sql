alter table public.commodus_thread_memory
  add column is_muted boolean not null default false;

comment on column public.commodus_thread_memory.is_muted is
  'When true, Commodus social ranking must persist inbound casts but never reply in this thread.';
