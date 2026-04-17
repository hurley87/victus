-- Pin search_path on the trigger helper to prevent search-path-hijack attacks.
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
