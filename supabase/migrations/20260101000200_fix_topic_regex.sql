-- Postgres regexes reject "[...0-9-_...]" (invalid range) and repetition counts above 255.
alter table public.apps drop constraint if exists apps_default_topic_check;
alter table public.apps
  add constraint apps_default_topic_check
  check (default_topic ~ '^[a-zA-Z0-9_.~%-]{1,255}$');
