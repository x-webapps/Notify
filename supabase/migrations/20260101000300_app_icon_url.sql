-- Optional presentation fields for apps. Both are plain public links, never secrets.
alter table public.apps
  add column if not exists icon_url text
    check (icon_url is null or (char_length(icon_url) <= 2048 and icon_url ~* '^https://')),
  add column if not exists app_url text
    check (app_url is null or (char_length(app_url) <= 2048 and app_url ~* '^https?://'));
