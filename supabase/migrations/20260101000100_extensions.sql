-- Needed for the scheduler (see supabase/manual/cron.sql for the job itself).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
