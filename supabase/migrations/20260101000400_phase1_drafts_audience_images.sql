-- Phase 1: drafts, saved audience topics, notification time zone, image bucket.

-- ---------------------------------------------------------------------------
-- Drafts: unfinished notifications (fields may still be empty)
-- ---------------------------------------------------------------------------
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 65),
  body text not null default '' check (char_length(body) <= 240),
  url text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  image_url text check (image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^https://')),
  target_choice text not null default 'default'
    check (target_choice in ('default', 'topic', 'condition', 'token', 'audience')),
  target_value text not null default '' check (char_length(target_value) <= 4096),
  updated_at timestamptz not null default now()
);
create index drafts_app_idx on public.drafts (app_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Saved audience topics (what the app subscribes to: version, country, ...)
-- ---------------------------------------------------------------------------
create table public.audience_topics (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  name text not null check (name ~ '^[a-zA-Z0-9_.~%-]{1,255}$'),
  label text not null check (char_length(label) between 1 and 60),
  kind text not null default 'custom' check (kind in ('custom', 'version', 'country', 'timezone')),
  created_at timestamptz not null default now(),
  unique (app_id, name)
);

-- ---------------------------------------------------------------------------
-- Time zone used to fill {date} / {time} / {day} when a notification is sent
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists tz text not null default 'UTC' check (char_length(tz) <= 64);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.drafts enable row level security;
alter table public.audience_topics enable row level security;

create policy drafts_all on public.drafts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy audience_topics_all on public.audience_topics
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Image uploads (public read so FCM / phones can fetch them, admin-only write)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notification-images', 'notification-images', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy notification_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'notification-images' and public.is_admin());
create policy notification_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'notification-images' and public.is_admin());
create policy notification_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'notification-images' and public.is_admin());
