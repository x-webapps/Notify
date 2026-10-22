# Push Admin: a minimal push-notification panel for your Android apps

A small OneSignal-style admin panel for **your own** Android apps. Pick an app, write a notification and
send it to everyone, to an audience (app version, country, time zone), to one device, now, later, or at a
local time on every device. Everything runs on **free tiers**.

```
Admin panel (static SPA on GitHub Pages, deployed by GitHub Actions)
        |  Supabase JS client (Google login, anon key only)
        v
Supabase Auth + Postgres (RLS) + Storage + Edge Functions (Deno) + pg_cron
                                      |
                                      v
                    FCM HTTP v1 (service account kept in Supabase secrets)
```

* **Firebase** is used only for FCM delivery inside your apps (and, optionally, its delivery-stats API).
* The repo is **public**, so it contains **no secrets**.
* Android side: [ANDROID_SETUP.md](ANDROID_SETUP.md) and [Guideline_Notification.md](Guideline_Notification.md).
  The panel's **Settings → Android integration guide** has a copy-paste brief for an AI coding agent.

## Features

| Area | What you get |
|---|---|
| Apps | Name, package, icon URL, App URL (auto-detected Play Store link), channel, default topic, **service account key upload** (checked with Firebase, stored encrypted; the project ID fills in from it), link-domain allow-list. Advanced: a server secret name |
| Compose | Title/message with counters, link, image (paste a URL or upload to Storage) with a **link checker**, live Android preview, emoji picker, `{app_name}` `{date}` `{time}` `{day}` variables, truncation hints |
| Targets | All users, **Audience** (saved topics combined with AND/OR), custom topic, advanced condition, single device token |
| Timing | Send now, schedule a date/time, **device local time** (for example 9:00 AM on each phone), or **Repeat** (daily, weekly, monthly) |
| Delivery options | Expiry (TTL), replace key (collapse key and tag), priority, campaign label. Every send is tagged with an FCM analytics label (`push_YYYYMMDD` by default) |
| Safety | A send to a whole app asks you to type the app name, with an optional test to a saved device first; several named test devices per app (kept in your browser only) |
| Workflow | Drafts, templates, duplicate/resend, cancel scheduled, recurring sends (pause/resume/delete), history with search and pagination. Finished History rows older than 30 days are deleted nightly |
| Insight | Dashboard: sent in the last 7 days, success rate, scheduled, 7-day chart, recent activity |
| Admin | Google login with an admin allow-list, theme (light default), apps export/import, Android guide for other apps |

## Repo layout

| Path | What |
|---|---|
| `web/` | Vite + vanilla TypeScript panel (only dependency: `@supabase/supabase-js`) |
| `web/src/android-guide.md` | The agent-ready Android brief shown in Settings (its PushTopics code comes from `audience.ts`) |
| `supabase/migrations/` | Tables, RLS, claim functions, drafts, audiences, delivery options, local-time sends, image bucket |
| `supabase/functions/send-notification` | Sends now (called by the panel) |
| `supabase/functions/process-scheduled` | Sends due scheduled notifications (called by `pg_cron`) |
| `supabase/functions/_shared/` | FCM, admin check, validation, variables, delivery, tests |
| `supabase/manual/` | SQL you run by hand once (admin seed, cron job). Placeholders only; keep filled copies as `*.local.sql` (git-ignored) |
| `.github/workflows/` | `deploy.yml` (tests + GitHub Pages), `keepalive.yml` (daily ping) |

---

## Setup, step by step

Windows is assumed; use **Git Bash** for commands that contain `$(...)`.

### 1. Supabase project
1. Create a project at supabase.com (free plan).
2. **Settings → API Keys**: copy the **Project URL** and the legacy **anon** key (`eyJ…`; the cron job needs it).
   Never use the `service_role` / `sb_secret_…` key anywhere outside Supabase, and never paste it in chats.
3. **Authentication → Providers → Email**: turn **off** email signups. Only Google is used.

### 2. Google login
1. Google Cloud Console → *APIs & Services → Credentials → Create credentials → OAuth client ID → Web application*.
2. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase → **Authentication → Providers → Google**: paste the Client ID and Secret and enable it.

### 3. Database
```bash
npm install --prefix web
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push              # applies every file in supabase/migrations/
```
Then, in the Supabase **SQL editor**, run [`supabase/manual/seed_admin.sql`](supabase/manual/seed_admin.sql)
with your Google account email (lowercase). Only emails in `admins` get access.
The migrations also create the **Storage bucket** for uploaded images.

### 4. FCM service account and secrets
One service account can serve every app if it has the role **Firebase Cloud Messaging API Admin** in *every*
app's Firebase project.

1. Firebase console → *Project settings → Service accounts → Generate new private key*. Save the JSON
   **outside this folder**.
2. In each app's Firebase project: Google Cloud Console → *IAM → Grant access* → the service account email →
   **Firebase Cloud Messaging API Admin**, and enable **Firebase Cloud Messaging API (V1)** (*APIs & Services → Library*).
   **Or from a terminal** (needs the Google Cloud CLI and an Owner account of that project):
```bash
gcloud auth list                # is an Owner account listed/active? if not:
gcloud auth login               # opens a browser, sign in as the project Owner
gcloud config set account OWNER_EMAIL   # only if several accounts are listed
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" --role="roles/firebasecloudmessaging.admin"
gcloud projects get-iam-policy PROJECT_ID --flatten="bindings[].members" --filter="bindings.members:SERVICE_ACCOUNT_EMAIL" --format="value(bindings.role)"
gcloud services enable fcm.googleapis.com --project=PROJECT_ID
```
   Keep the `serviceAccount:` prefix (a plain email fails with "should appear as user:..."). The service account email is
   shown in the panel under *App settings → Check connection → Service account used*. Wait 1-2 minutes afterwards.
3. Set the secrets (Git Bash):
```bash
npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat C:/Users/<you>/Documents/key.json)"
npx supabase secrets set CRON_SECRET="<long random string, 32+ chars>"
npx supabase secrets set ALLOWED_ORIGINS="https://<user>.github.io,http://localhost:5173"
npx supabase secrets set CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```
(On Windows PowerShell `openssl` does not exist and the command stores an empty value; use the PowerShell command in
`Setup_Guide.md`, Stage 3.)
`CREDENTIAL_ENCRYPTION_KEY` encrypts the per-app keys uploaded in the panel (see below). Generate it once and keep a
copy somewhere safe: if it changes, stored keys can no longer be decrypted and must be uploaded again.

**Per-app key (recommended):** when adding an app, choose its Firebase service account key file
(Firebase console → Project settings → Service accounts → Generate new private key). The panel fills in the project
ID, checks the key with Firebase (nothing is sent) and stores it AES-256-GCM encrypted. The browser never gets it back.
This replaces the `gcloud` role-granting steps above for that app, because the Firebase Admin SDK account that
Firebase creates already has permission to send. Order of use when sending: uploaded key, then the app's
`FCM_SERVICE_ACCOUNT_<APP_KEY>` secret name (advanced), then the central `FCM_SERVICE_ACCOUNT`.
Secret names must start with `FCM_SERVICE_ACCOUNT_`; the function refuses to read any other environment variable.

> If key creation is blocked by the organization policy `iam.disableServiceAccountKeyCreation`, an organization
> admin has to relax it for the project, or you create the key in a project outside that organization.

### 5. Deploy the functions
```bash
npx supabase functions deploy send-notification
npx supabase functions deploy process-scheduled
npx supabase functions deploy app-credentials
```
JWT verification stays **on** for all three (never pass `--no-verify-jwt`). Redeploy after any change in
`supabase/functions/`.

### Recurring sends
In Compose choose *When → Repeat* (daily, weekly or monthly at a time in a chosen time zone). Schedules live under
the app's *Recurring* tab, where you can pause, resume or delete them. They run from the same every-minute scheduler
(section 6), so that job must exist. The migration `20260101000900` updates the job to also wake up for recurring
sends; if you created it from an older `cron.sql`, run the current one again.

### History cleanup
The migration `20260101001000` schedules a nightly `pg_cron` job (03:17 UTC) that deletes **finished** notifications
(sent, failed, cancelled) older than 30 days, so the table stays small however many apps send. Scheduled and
sending rows are never touched, and a local-time send is removed together with its time zones only once it is
finished. Uploaded images in the `notification-images` bucket are not deleted. To change the 30 days, edit the number
in the `cron.schedule` call (minimum 7). To run it once by hand: `select public.purge_old_notifications(30);`

### 6. Scheduler (`pg_cron`): required for Schedule and Device local time
Copy [`supabase/manual/cron.sql`](supabase/manual/cron.sql) to `supabase/manual/cron.local.sql`, replace the three
placeholders (project URL, anon key, and the **same** `CRON_SECRET` as above) and run it once, either by pasting
it in the SQL editor or with:
```bash
npx supabase db query --linked -f supabase/manual/cron.local.sql
```
It stores the values in Supabase Vault and schedules a job that runs every minute and calls `process-scheduled`
**only when something is due**. Never commit the `.local.sql` file.

Check it: `select jobname, active from cron.job;` and
`select * from cron.job_run_details order by start_time desc limit 5;`
If you change the job text in `cron.sql`, re-run only its `select cron.schedule(...)` block (same job name
replaces the old one; do not run the `vault.create_secret` lines twice).

### 7. GitHub repo and Pages
1. Create a **public** repo (Pages on the free plan needs public) and enable **2FA** on your GitHub account.
2. Run `git status` and confirm no `.json` key, `.env` or `*.local.sql` file is listed.
3. Push to `main`.
4. Repo → **Settings → Pages → Source: GitHub Actions**.
5. Repo → **Settings → Secrets and variables → Actions → Variables** (repository variables):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the keep-alive workflow reuses them).
6. Supabase → **Authentication → URL Configuration**:
   * Site URL: `https://<user>.github.io/<repo>/`
   * Redirect URLs: `https://<user>.github.io/<repo>/` (keep the trailing slash) and `http://localhost:5173/`
7. The push triggers **Deploy admin panel to GitHub Pages**. Every later push to `main` redeploys automatically
   (tests run first; a failing test blocks the deploy).

### 8. Your Android apps
Follow [ANDROID_SETUP.md](ANDROID_SETUP.md), or open **Settings → Android integration guide** in the panel,
copy it, and paste it into an AI coding agent inside the app's project. In short: `google-services.json`,
`firebase-messaging`, notification channel, link handler, and `PushTopics.sync(this)` at startup.
Audiences and local-time sends only reach users on an app version that includes `PushTopics`.

### 9. Local development (optional)
```bash
cd web
copy .env.example .env     # fill in URL + anon key
npm run dev                # http://localhost:5173
npm test                   # web tests
```
Function tests (needs Deno): `cd supabase/functions && deno test --no-lock _shared/`

---

## Using the panel

* **Dashboard**: 7-day stats and recent activity. **Apps**: your apps; open one to compose.
* **Audience tab** (per app): save audiences such as *Country: IN* or *Version 42*. In the composer choose
  **Target → Audience**, tick several and choose *Match all* (AND) or *Match any* (OR). FCM allows at most
  5 topics per condition. The tab also shows the Android code the devices need.
* **Device local time**: pick a date and a wall-clock time. The panel creates one scheduled send per UTC offset
  (up to 38), each at that time in its zone, and shows them as one row in History (*View zones* lists each).
  If that time has already passed in some zones you choose to skip them or send them the next day.
  Supports All users, Audience or a custom topic. A phone's offset is refreshed when the app starts, so a phone
  that crossed a daylight-saving change without being opened may be an hour off. `{date}` and `{day}` use your
  browser's time zone, so avoid `{time}` in local-time sends.
* **Delivery options**: expiry drops the message if the phone stays offline too long; a replace key lets a newer
  message replace the older one; normal priority saves battery; the campaign label groups FCM delivery stats.
* **Drafts and templates**: *Save draft* keeps unfinished work (removed once sent); templates can use variables.
* **Images**: paste an https URL or upload a JPG/PNG/WebP under 1 MB (stored in Supabase Storage, 1 GB free).
  Under the field the panel warns about GIF/SVG links (GIFs do not animate in notifications), page links such as
  `imgur.com/abc` instead of a direct image, links that do not load, and very large images. A browser cannot read the
  file size of a third-party image, so the size warning is only a pixel-count estimate. If an image looks broken the
  panel asks before sending.
* **Recurring sends**: *When → Repeat* (see above). Manage them in the app's *Recurring* tab.
* **Sending to everyone**: a send, schedule, local-time send or recurring send to the app's whole audience asks you to
  type the app's name. If you saved a test device, the same dialog can send a test to it first.
* **Test devices**: in *Send a test*, name a device token and **Save device** (up to 10 per app). They are stored in
  this browser only, not on the server.

## Test checklist
1. Sign in with Google. A non-listed account must see "Not authorized" and be signed out.
2. Add an app (name, package, FCM project ID).
3. Compose, paste a device token, **Send test to token**.
4. Send to **All users** (confirm the modal). Check foreground, background and killed; tap opens the link.
5. Link `javascript:alert(1)` must be rejected (inline error; the server rejects it too).
6. **Schedule** one two minutes ahead; History shows *Scheduled*, then *Sent*. Schedule another and **Cancel** it.
7. Send twice with the same **replace key**: the second replaces the first on the phone.
8. Audience: save *Country: <yours>*, send to it, confirm only matching devices receive it.
9. **Device local time**: set a time a few minutes ahead for All users; open *View zones* in History.
10. Save a draft, reuse a template, upload an image, export and re-import the apps JSON (no secrets inside).
11. Add an app with its service account key file: Check connection must say *Connected*.
12. Choose **Repeat** (daily) a few minutes ahead: it appears in the *Recurring* tab and then in History.
13. Image link ending in `.gif`: a warning appears under the field. Send to **All users**: type the app name to confirm.

## Security notes
* **Never commit:** the service account JSON, the Supabase `service_role` / `sb_secret_…` key, the Google OAuth
  client secret, `*.local.sql` files, `.env` files. `.gitignore` covers the usual names; check `git status` every time.
* The browser only ever has the **anon key**. Every table has RLS that requires a verified email listed in `admins`.
  Storage uploads are admin-only (public read, so phones can fetch the image).
* The functions verify the caller's JWT and re-check `admins` on the server, re-validate link, image, target and
  delivery options, and only read secrets named `FCM_SERVICE_ACCOUNT*`. The scheduler endpoint also requires the
  private `x-cron-secret`. Responses never contain secrets or access tokens.
* **Uploaded service account keys are stored in the database, encrypted** (AES-256-GCM, bound to the app id) with the
  master key `CREDENTIAL_ENCRYPTION_KEY`, which lives only in the Edge Function secrets. The table has no policies, so
  browsers cannot read it, and the key is never sent back. A database dump alone is useless without the master key,
  but someone with both database access and the function secrets could decrypt. Upload only keys you can revoke, and
  delete or rotate a key in Google Cloud (IAM → Service accounts → Keys) if it may have leaked. Removing it in the
  panel (*App settings → Remove key*) only deletes this panel's copy.
* GitHub Pages cannot set HTTP headers, so the CSP is a `<meta>` tag in the production build. A meta CSP
  **cannot** enforce `frame-ancestors`, so the page could be framed by another site (clickjacking). Every action
  still needs your signed-in session and a confirmation click, which limits the risk. `noindex` and `robots.txt` are included.
* Anyone you add to `admins` can message every user of every app. Keep Google and GitHub accounts on 2FA.
* If a secret was ever pasted into a chat or committed, rotate it.

## Delivery report (optional, Firebase)
FCM's Data API (`fcmdata.googleapis.com`) can report delivery counts per day and analytics label for Android apps.
It needs the API enabled in the app's Firebase project and a role that includes `fcmdata.deliverydata.list`
for the service account. Data appears several days late and only a 7-day window is returned, so history would need
daily snapshots. The panel does not show this report yet.

## Keeping the free project alive
Free Supabase projects pause after about a week of inactivity. The `pg_cron` job normally keeps the database
active and `keepalive.yml` makes one request per day as a backup. If the project is paused anyway:
Supabase dashboard → your project → **Restore project**. GitHub disables scheduled workflows after 60 days
without repository activity; re-enable it in the Actions tab if that happens.

## Troubleshooting
| Problem | Check |
|---|---|
| Login loops or fails | Supabase Site URL / Redirect URLs (trailing slash), Google redirect URI |
| "Not authorized" | Email missing in `admins` (lowercase), or Google email not verified |
| Blank page | Actions build log; repo Variables set; Pages source is *GitHub Actions* |
| Send fails with 403 | Service account lacks *Firebase Cloud Messaging API Admin* in that project, or FCM V1 API is off |
| `SENDER_ID_MISMATCH` | Token comes from another Firebase project than the app's FCM project ID |
| "Sent" but nothing arrives | App not subscribed (`PushTopics.sync` missing), notification permission off, wrong project ID. New subscriptions can take a few minutes |
| Audience / local-time send reaches nobody | The device runs an app version without `PushTopics`; topic names must match exactly (`country_IN`, `v_42`, `utc_p0530`) |
| CORS error in the browser | `ALLOWED_ORIGINS` secret must contain the exact Pages origin (no path) |
| Scheduled item stays *Scheduled* | `select * from cron.job;` must show the job; check `cron.job_run_details`, `net._http_response`, `CRON_SECRET` match, anon key is the legacy JWT |
| Add app / save fails after an update | A migration is missing: run `npx supabase db push` |
| Image upload fails | Bucket missing (run `db push`), file over 1 MB, or not JPG/PNG/WebP |
