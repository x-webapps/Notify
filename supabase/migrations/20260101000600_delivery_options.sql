-- Per-notification FCM delivery options + analytics label.
--   ttl_seconds     : drop the message if the device stays offline longer (null = FCM default, 4 weeks)
--   collapse_key    : a newer message with the same key replaces the older one (queue + tray)
--   priority        : 'high' wakes the device now, 'normal' saves battery
--   analytics_label : FCM analytics label used to group delivery stats (auto-filled when sending)

alter table public.notifications
  add column if not exists ttl_seconds integer
    check (ttl_seconds is null or ttl_seconds between 0 and 2419200),
  add column if not exists collapse_key text
    check (collapse_key is null or collapse_key ~ '^[a-zA-Z0-9_.~%-]{1,64}$'),
  add column if not exists priority text not null default 'high'
    check (priority in ('high', 'normal')),
  add column if not exists analytics_label text
    check (analytics_label is null or analytics_label ~ '^[a-zA-Z0-9_.~%-]{1,50}$');

alter table public.drafts
  add column if not exists ttl_seconds integer
    check (ttl_seconds is null or ttl_seconds between 0 and 2419200),
  add column if not exists collapse_key text
    check (collapse_key is null or collapse_key ~ '^[a-zA-Z0-9_.~%-]{1,64}$'),
  add column if not exists priority text not null default 'high'
    check (priority in ('high', 'normal')),
  add column if not exists analytics_label text
    check (analytics_label is null or analytics_label ~ '^[a-zA-Z0-9_.~%-]{1,50}$');
