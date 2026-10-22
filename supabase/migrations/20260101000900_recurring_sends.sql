-- Recurring sends: a schedule (daily / weekly / monthly at a wall-clock time in a time zone)
-- that the scheduler turns into one normal notification row per run.

create table public.recurring_sends (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 65),
  body text not null check (char_length(body) between 1 and 240),
  url text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  image_url text check (image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^https://')),
  target_type text not null check (target_type in ('topic', 'condition')),
  target_value text not null check (char_length(target_value) between 1 and 4096),
  ttl_seconds integer check (ttl_seconds is null or ttl_seconds between 0 and 2419200),
  collapse_key text check (collapse_key is null or collapse_key ~ '^[a-zA-Z0-9_.~%-]{1,64}$'),
  priority text not null default 'high' check (priority in ('high', 'normal')),
  analytics_label text check (analytics_label is null or analytics_label ~ '^[a-zA-Z0-9_.~%-]{1,50}$'),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  time_of_day text not null check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  tz text not null,                                   -- IANA name, e.g. Asia/Kolkata
  weekdays smallint[] not null default '{}',          -- 0 = Sunday .. 6 = Saturday (weekly)
  day_of_month smallint check (day_of_month between 1 and 31),  -- monthly; short months use their last day
  ends_on date,                                       -- last local date a run may happen on (optional)
  active boolean not null default true,
  next_run_at timestamptz,                            -- maintained by the trigger / claim function
  last_run_at timestamptz,
  run_count integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  check (frequency <> 'weekly' or (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[])),
  check (frequency <> 'monthly' or day_of_month is not null)
);

create index recurring_sends_due_idx on public.recurring_sends (next_run_at) where active;
create index recurring_sends_app_idx on public.recurring_sends (app_id, created_at desc);

alter table public.notifications
  add column if not exists recurring_id uuid references public.recurring_sends(id) on delete set null;

alter table public.recurring_sends enable row level security;
create policy recurring_sends_all on public.recurring_sends
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- First run strictly after p_after, as an absolute instant. DST is handled by Postgres: the wall-clock
-- time is resolved in p_tz for each candidate date.
create or replace function public.next_recurring_run(
  p_freq text, p_time text, p_tz text, p_weekdays smallint[], p_dom smallint, p_after timestamptz
)
returns timestamptz
language plpgsql
stable
as $$
declare
  d date := (p_after at time zone p_tz)::date;
  cand timestamptz;
  ok boolean;
  last_day int;
begin
  for i in 0..400 loop
    last_day := extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int;
    ok := case p_freq
      when 'daily' then true
      when 'weekly' then extract(dow from d)::smallint = any (p_weekdays)
      when 'monthly' then extract(day from d)::int = least(p_dom::int, last_day)
      else false
    end;
    if ok then
      cand := (d + p_time::time) at time zone p_tz;
      if cand > p_after then
        return cand;
      end if;
    end if;
    d := d + 1;
  end loop;
  return null;
end;
$$;

-- Validates the time zone and keeps next_run_at right whenever the schedule changes.
create or replace function public.recurring_prepare()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.tz) then
    raise exception 'Unknown time zone: %', new.tz;
  end if;

  if tg_op = 'INSERT'
     or new.frequency is distinct from old.frequency
     or new.time_of_day is distinct from old.time_of_day
     or new.tz is distinct from old.tz
     or new.weekdays is distinct from old.weekdays
     or new.day_of_month is distinct from old.day_of_month
     or new.ends_on is distinct from old.ends_on
     or new.active is distinct from old.active then
    if new.active then
      new.next_run_at := public.next_recurring_run(new.frequency, new.time_of_day, new.tz, new.weekdays, new.day_of_month, now());
      if new.next_run_at is null or (new.ends_on is not null and (new.next_run_at at time zone new.tz)::date > new.ends_on) then
        new.next_run_at := null;
        new.active := false;
      end if;
    else
      new.next_run_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger recurring_sends_prepare
  before insert or update on public.recurring_sends
  for each row execute function public.recurring_prepare();

-- Scheduler: take every due schedule exactly once and move it to its next run. A run that was missed
-- (the scheduler was down) happens once, late, and is not repeated for each missed slot.
create or replace function public.claim_due_recurring(p_limit int default 20)
returns setof public.recurring_sends
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id from public.recurring_sends
     where active and next_run_at <= now()
     order by next_run_at
     limit p_limit
     for update skip locked
  ),
  nxt as (
    select r.id,
           public.next_recurring_run(r.frequency, r.time_of_day, r.tz, r.weekdays, r.day_of_month, greatest(now(), r.next_run_at)) as at
      from public.recurring_sends r join due on due.id = r.id
  )
  update public.recurring_sends r
     set last_run_at = now(),
         run_count = r.run_count + 1,
         next_run_at = case
           when nxt.at is null or (r.ends_on is not null and (nxt.at at time zone r.tz)::date > r.ends_on) then null
           else nxt.at end,
         active = not (nxt.at is null or (r.ends_on is not null and (nxt.at at time zone r.tz)::date > r.ends_on))
    from nxt
   where r.id = nxt.id
  returning r.*;
end;
$$;

revoke all on function public.claim_due_recurring(int) from public, anon, authenticated;
grant execute on function public.claim_due_recurring(int) to service_role;

-- ---------------------------------------------------------------------------
-- Let the existing every-minute scheduler job also wake up for due recurring sends.
-- (No-op when the job has not been created yet; manual/cron.sql contains the same command.)
-- ---------------------------------------------------------------------------
do $do$
begin
  if to_regclass('cron.job') is not null
     and exists (select 1 from cron.job where jobname = 'process-scheduled-notifications') then
    perform cron.schedule(
      'process-scheduled-notifications',
      '* * * * *',
      $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/process-scheduled',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      )
      where exists (
        select 1 from public.notifications
        where (status = 'scheduled' and scheduled_at <= now() and kind <> 'local_parent')
           or (status = 'sending' and claimed_at < now() - interval '15 minutes')
      )
      or exists (
        select 1 from public.recurring_sends where active and next_run_at <= now()
      );
      $job$
    );
  end if;
end
$do$;
