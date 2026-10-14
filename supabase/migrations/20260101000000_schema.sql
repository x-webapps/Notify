-- Push notification admin panel: schema, RLS and helper functions.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.admins (
  email text primary key check (email = lower(email))
);

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  package_name text not null unique check (char_length(package_name) between 1 and 200),
  fcm_project_id text not null check (fcm_project_id ~ '^[a-z][a-z0-9-]{4,29}$'),
  default_topic text not null default 'all' check (default_topic ~ '^[a-zA-Z0-9_.~%-]{1,255}$'),
  channel_id text not null default 'app_updates_channel' check (char_length(channel_id) between 1 and 100),
  -- Name of a per-app Edge Function secret (never the secret itself).
  secret_key text check (secret_key is null or secret_key ~ '^FCM_SERVICE_ACCOUNT_[A-Z0-9_]{1,60}$'),
  url_allowlist text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 65),
  body text not null check (char_length(body) between 1 and 240),
  url text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  image_url text check (image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^https://')),
  target_type text not null check (target_type in ('topic', 'condition', 'token')),
  target_value text not null check (char_length(target_value) between 1 and 4096),
  status text not null check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  fcm_message_id text,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  check (status <> 'scheduled' or scheduled_at is not null)
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  title text not null check (char_length(title) between 1 and 65),
  body text not null check (char_length(body) between 1 and 240),
  url text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  image_url text check (image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^https://')),
  created_at timestamptz not null default now()
);

create index notifications_app_created_idx on public.notifications (app_id, created_at desc);
create index notifications_status_scheduled_idx on public.notifications (status, scheduled_at);
create index templates_app_idx on public.templates (app_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Admin check used by every policy
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, false)
     and exists (
       select 1 from public.admins a
       where a.email = lower(auth.jwt() ->> 'email')
     );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.apps enable row level security;
alter table public.notifications enable row level security;
alter table public.templates enable row level security;

-- Admins can read the list; it is managed only through the SQL editor.
create policy admins_select on public.admins
  for select to authenticated using (public.is_admin());

create policy apps_all on public.apps
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy notifications_all on public.notifications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy templates_all on public.templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Non-admins (including anonymous visitors) get zero rows from every table, which is how
-- the panel detects "not authorized". Rows in "admins" are added only via the SQL editor.

-- ---------------------------------------------------------------------------
-- Atomic claiming (service role only; used by the Edge Functions)
-- ---------------------------------------------------------------------------
create or replace function public.claim_notification(p_id uuid)
returns setof public.notifications
language sql
security definer
set search_path = public
as $$
  update public.notifications
     set status = 'sending', claimed_at = now(), error = null
   where id = p_id and status in ('scheduled', 'failed')
  returning *;
$$;

create or replace function public.claim_due_notifications(p_limit int default 20)
returns setof public.notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Recover rows whose function run died before it could record a result.
  update public.notifications
     set status = 'failed', error = 'Timed out while sending (the function did not finish)'
   where status = 'sending' and claimed_at < now() - interval '15 minutes';

  return query
  update public.notifications n
     set status = 'sending', claimed_at = now()
   where n.id in (
     select id from public.notifications
      where status = 'scheduled' and scheduled_at <= now()
      order by scheduled_at
      limit p_limit
      for update skip locked
   )
  returning n.*;
end;
$$;

revoke all on function public.claim_notification(uuid) from public, anon, authenticated;
revoke all on function public.claim_due_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_notification(uuid) to service_role;
grant execute on function public.claim_due_notifications(int) to service_role;
