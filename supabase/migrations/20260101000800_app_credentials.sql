-- Per-app service-account keys, uploaded from the panel and stored encrypted.
-- The table has RLS on and NO policies, so only the service role (Edge Functions) can read it.
-- Browsers never see the ciphertext; they only see the two non-secret columns on public.apps.

create table public.app_credentials (
  app_id uuid primary key references public.apps(id) on delete cascade,
  ciphertext text not null,       -- base64(iv || AES-GCM(key JSON)), bound to app_id
  project_id text not null,
  client_email text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_credentials enable row level security;
revoke all on public.app_credentials from anon, authenticated;

-- Display-only status, maintained by the app-credentials function.
alter table public.apps
  add column has_credential boolean not null default false,
  add column credential_email text;
