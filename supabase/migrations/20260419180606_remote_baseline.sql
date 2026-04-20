-- Baseline migration: applied on the hosted Supabase project before this
-- version existed in git. Kept as a no-op so `supabase db push` / local
-- migration order matches `supabase_migrations.schema_migrations`.
select 1;
