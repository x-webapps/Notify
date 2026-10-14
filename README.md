# Push Admin: a minimal push-notification panel for your Android apps

A small OneSignal-style admin panel for **your own** Android apps. Pick an app, write a notification
(title, message, optional link and image), and send it to all users, a topic, a topic condition, or a
single device. Everything runs on **free tiers**.

```
Admin panel (static SPA on GitHub Pages, deployed by GitHub Actions)
        |  Supabase JS client (Google login, anon key only)
        v
Supabase Auth + Postgres (RLS) + Edge Functions (Deno)
                                      |
                                      v
                    FCM HTTP v1 (service account kept in Supabase secrets)
```

* **Firebase** is used only for FCM delivery inside your apps.
* The repo is **public**, so it contains **no secrets**.
* Android side: see [ANDROID_SETUP.md](ANDROID_SETUP.md) (and your `Guideline_Notification.md`).

## Repo layout

| Path | What |
|---|---|
| `web/` | Vite + vanilla TypeScript panel (only dependency: `@supabase/supabase-js`) |
| `supabase/migrations/` | Tables, RLS, claim functions, `pg_cron`/`pg_net` extensions |
| `supabase/functions/send-notification` | Sends now (called by the panel) |
| `supabase/functions/process-scheduled` | Sends due scheduled notifications (called by `pg_cron`) |
| `supabase/functions/_shared/` | FCM, admin check, validation, delivery, tests |
| `supabase/manual/` | SQL you run by hand once (admin seed, cron job). Contains placeholders only |
| `.github/workflows/` | `deploy.yml` (tests + GitHub Pages), `keepalive.yml` (daily ping) |

---

## Setup, step by step

Windows is assumed; use **Git Bash** for the commands that contain `$(...)`.

### 1. Supabase project
1. Create a project at supabase.com (free plan).
2. **Settings → API**: copy the **Project URL** and the **anon** key (the legacy JWT one, starting with `eyJ`; the cron job needs it).
   Never copy or use the `service_role` key anywhere except Supabase itself.
3. **Authentication → Providers → Email**: turn **off** “Enable email signups” (and leave email login off). Only Google is used.

### 2. Google login
1. Google Cloud Console → *APIs & Services → Credentials → Create credentials → OAuth client ID → Web application*.
2. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase → **Authentication → Providers → Google**: paste the Client ID and Secret and enable it.

### 3. Database
```bash
npm install --prefix web          # also gives you npx
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push              # runs supabase/migrations/*
```
Then, in the Supabase **SQL editor**, run [`supabase/manual/seed_admin.sql`](supabase/manual/seed_admin.sql)
after replacing the email with your Google account (lowercase). Only emails in `admins` get access.

### 4. FCM service account and secrets
**Central key (recommended):** one service account that has the role **Firebase Cloud Messaging Admin**
in *every* app's Firebase project.

1. Firebase console → *Project settings → Service accounts → Generate new private key*. Save the JSON
   **outside this folder** (e.g. `C:/Users/<you>/Documents/key.json`).
2. For **each** app's Firebase project: Google Cloud Console → *IAM → Grant access* → paste the service account
   email → role **Firebase Cloud Messaging Admin**. Also make sure **Firebase Cloud Messaging API (V1)** is enabled there
   (*APIs & Services → Library*).
3. Set the secrets (Git Bash):
```bash
npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat C:/Users/<you>/Documents/key.json)"
npx supabase secrets set CRON_SECRET="<long random string, 32+ chars>"
npx supabase secrets set ALLOWED_ORIGINS="https://<user>.github.io,http://localhost:5173"
```
(You can also paste the JSON into the dashboard: *Edge Functions → Secrets*.)

**Per-app key (optional):** set a secret named `FCM_SERVICE_ACCOUNT_<APP_KEY>` (e.g. `FCM_SERVICE_ACCOUNT_GLASSWIDGETS`)
and put that **name** (not the key) into the app's “own service-account secret name” field. Names must start with
`FCM_SERVICE_ACCOUNT_`; the function refuses to read any other environment variable. Without an override the
central key is used.

> If key creation is blocked by the organization policy `iam.disableServiceAccountKeyCreation`, an organization
> admin has to relax it for the project, or you create the key in a project outside that organization.

### 5. Deploy the functions
```bash
npx supabase functions deploy send-notification
npx supabase functions deploy process-scheduled
```
JWT verification stays **on** for both (do not pass `--no-verify-jwt`).

### 6. Scheduler (`pg_cron`)
Open [`supabase/manual/cron.sql`](supabase/manual/cron.sql), replace the three placeholders (project URL, anon key and the
same `CRON_SECRET` you set above), and run it in the SQL editor. It stores them in Supabase Vault and schedules a
job that runs every minute and calls `process-scheduled` **only when something is due**.
Do not commit a filled-in copy.

Check it: `select * from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 5;`

### 7. GitHub repo and Pages
1. Create a **public** repo and enable **2FA** on your GitHub account.
2. Run `git status` and confirm no `.json` key or `.env` file is listed.
3. Push to `main`.
4. Repo → **Settings → Pages → Source: GitHub Actions**.
5. Repo → **Settings → Secrets and variables → Actions → Variables**:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (the keep-alive workflow reuses these, or you can add `SUPABASE_URL` / `SUPABASE_ANON_KEY`).
6. Supabase → **Authentication → URL Configuration**:
   * Site URL: `https://<user>.github.io/<repo>/`
   * Redirect URLs: `https://<user>.github.io/<repo>/` (keep the trailing slash) and `http://localhost:5173/`
7. The push triggers **Deploy admin panel to GitHub Pages** (Actions tab). Open the site when it is green.

### 8. Local development (optional)
```bash
cd web
copy .env.example .env     # fill in URL + anon key
npm run dev                # http://localhost:5173
npm test
```

---

## Test checklist
1. Sign in with Google. A non-listed account must see “Not authorized” and be signed out.
2. Add an app (name, package, FCM project ID).
3. Compose → paste a device token (Logcat) → **Send test to token**.
4. Send to **All users** (topic `all`); confirm the modal summary; check foreground, background and killed states.
5. Tap the notification: the link opens.
6. Link `javascript:alert(1)` must be rejected (inline error; the server rejects it too).
7. **Schedule** one two minutes ahead; History shows *Scheduled*, then *Sent*. Schedule another and **Cancel** it.
8. Save a template, reuse it, edit it, delete it.
9. Settings: export apps JSON (open it: no secrets), import it back, toggle theme, sign out.

## Security notes
* **Never commit:** the service account JSON, the Supabase `service_role` key, the Google OAuth client secret,
  your filled-in `cron.sql`, `.env` files. `.gitignore` covers the usual names, but check `git status` every time.
* The browser only ever has the **anon key**. Every table has RLS that requires a verified email listed in `admins`.
* Both functions verify the caller's JWT and re-check `admins` on the server, re-validate the link/image/target,
  and only read secrets named `FCM_SERVICE_ACCOUNT*`. Responses never contain secrets or access tokens.
* GitHub Pages cannot set HTTP headers, so the CSP is a `<meta>` tag in the production build (allows only this origin,
  the Supabase project URL and https images for the preview). A meta CSP **cannot** enforce `frame-ancestors`, so
  the page could be framed by another site (clickjacking). Every action still needs your signed-in session and a
  confirmation click, which limits the risk, but it is a known gap of static hosting. `noindex` meta and `robots.txt`
  are included.
* Anyone you add to `admins` can message every user of every app. Keep Google and GitHub accounts on 2FA.

## Keeping the free project alive
Free Supabase projects pause after about a week of inactivity. The `pg_cron` job (every minute) normally keeps the
database active, and `keepalive.yml` makes one request per day as a backup. If the project is paused anyway:
Supabase dashboard → your project → **Restore project**, then wait a minute. GitHub disables scheduled workflows after 60 days
without repository activity; re-enable it in the Actions tab if needed.

## Troubleshooting
| Problem | Check |
|---|---|
| Login loops or fails | Supabase Site URL / Redirect URLs (trailing slash), Google redirect URI |
| “Not authorized” | Email missing in `admins` (lowercase), or Google email not verified |
| Blank page | Actions build log; repo Variables set; Pages source is *GitHub Actions* |
| Send fails with 403 | Service account lacks *Firebase Cloud Messaging Admin* in that project, or FCM V1 API is off |
| `SENDER_ID_MISMATCH` | Token comes from another Firebase project than the app's FCM project ID |
| Sent but nothing arrives | App not subscribed to the topic, notification permission off, wrong project ID |
| CORS error in the browser | `ALLOWED_ORIGINS` secret must contain the exact Pages origin (no path) |
| Scheduled item stays *Scheduled* | `select * from cron.job_run_details`, `net._http_response`; `CRON_SECRET` mismatch; anon key must be the legacy JWT |
