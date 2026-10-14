# Prompt: Minimal Push Notification Admin Panel (Supabase + GitHub Pages, multi-app)

Copy everything below the line into Claude Code (in an empty folder).

---

Build a minimal, OneSignal-style **push notification admin panel** for my own Android apps. It is a personal project with very low traffic, so everything must run on **free tiers**.

## Purpose
I manage several Android apps, each with its **own Firebase project** (used only for FCM). From this panel I pick an app, write a notification (title, message, optional link URL, optional image) and send it to all users of that app, a topic, or a single device. Tapping the notification opens the `url` in the browser (the apps already handle a custom data key named exactly `url`).

## Architecture (follow exactly)
```
Admin panel (static SPA, GitHub Pages free, deployed by GitHub Actions)
        |  Supabase JS client (Google login)
        v
Supabase Auth  +  Supabase Postgres (RLS)  +  Edge Functions (Deno)
                                              |
                                              v
                            FCM HTTP v1 (service account stored in Supabase Secrets)
```
- **Frontend**: Vite + vanilla TypeScript (no heavy framework), output `dist/`, hosted on **GitHub Pages** (free) and auto-deployed by a **GitHub Actions** workflow on push to `main`. Dependencies minimal: `@supabase/supabase-js` only, unless truly needed.
- The site is served from `https://<user>.github.io/<repo>/`, so set Vite `base: '/<repo>/'` (read it from an env var / `vite.config.ts`), use relative asset paths, and use hash-based routing (GitHub Pages has no SPA fallback). Include a `404.html` fallback.
- The repo will be **public** (GitHub Pages free plan), so it must contain **no secrets at all**.
- **Backend**: only **Supabase** (free plan): Auth, Postgres, Edge Functions, `pg_cron` + `pg_net`. No other server.
- **Firebase** is used ONLY for FCM delivery in the target apps. No Firebase Hosting, Storage, Firestore, or Cloud Functions.
- Mobile-friendly responsive UI, dark theme default with light toggle, clean minimal design (Linear/OneSignal-lite). No UI library; hand-written CSS with CSS variables.

## Credentials (critical)
- FCM HTTP v1 needs a Google **service account** JSON. It must live ONLY in **Supabase Edge Function secrets**, never in the database, git, frontend bundle, `VITE_*` variables, logs, or any published file.
- Support both modes:
  1. **Central service account (recommended)**: one service account (from any one project) that has been granted the role **Firebase Cloud Messaging Admin** in **every** app's Firebase project. Secret name: `FCM_SERVICE_ACCOUNT` (full JSON). FCM API (V1) must be enabled in each app's project.
  2. **Per-app override (optional)**: secrets named `FCM_SERVICE_ACCOUNT_<APP_KEY>` (e.g. `FCM_SERVICE_ACCOUNT_GLASSWIDGETS`). The `apps` table stores only the **secret name reference** (`secret_key`), never the secret itself. The function falls back to the central one when no override exists.
- Document how to set them: `supabase secrets set FCM_SERVICE_ACCOUNT="$(cat key.json)"`, and how to grant the IAM role in each Firebase project.
- Cache the OAuth access token in the function's memory until ~5 min before expiry.

## Access control
- **Supabase Auth with Google provider** only; disable email/password signups.
- Admin allow-list: table `admins(email text primary key)`. RLS on every table allows access only when `auth.jwt() ->> 'email'` exists in `admins` and `email_verified` is true. Everyone else sees "Not authorized" and is signed out.
- Edge Functions **must verify the JWT** (do not disable `verify_jwt`) and re-check the admin allow-list server-side before doing anything.
- Frontend uses only the **anon key** (public by design); the **service role key** must never appear in frontend code.
- GitHub Pages cannot set custom HTTP headers, so add `<meta http-equiv="Content-Security-Policy">` (allow only self + the Supabase project URL + Google auth), `<meta name="referrer" content="no-referrer">`, and avoid inline scripts. Add `noindex` meta and `robots.txt` disallowing all. Note honestly in the README that meta CSP cannot cover `frame-ancestors`.
- Supabase Auth: set **Site URL** and **Redirect URLs** to the GitHub Pages URL (and `http://localhost:5173` for dev); document this.

## Data model (Postgres, write full SQL migrations in `supabase/migrations/`)
- `admins(email)`
- `apps`: `id uuid pk`, `name`, `package_name`, `fcm_project_id`, `default_topic` (default `all`), `channel_id` (default `app_updates_channel`), `secret_key` (nullable, name of per-app secret), `url_allowlist text[]` (optional domain allow-list), `created_at`.
- `notifications`: `id uuid pk`, `app_id fk (on delete cascade)`, `title`, `body`, `url`, `image_url`, `target_type` (`topic`/`condition`/`token`), `target_value`, `status` (`scheduled`/`sending`/`sent`/`failed`/`cancelled`), `scheduled_at`, `sent_at`, `fcm_message_id`, `error`, `created_by`, `created_at`.
- `templates`: `id`, `app_id fk`, `name`, `title`, `body`, `url`, `image_url`.
- Add sensible indexes (`notifications(app_id, created_at desc)`, `notifications(status, scheduled_at)`).
- RLS policies for all tables as described; provide a seed snippet to insert my admin email.

## Edge Functions (`supabase/functions/`)
1. **`send-notification`** (called by the panel and by the scheduler):
   - Input: `notification_id` (row already inserted by the panel, or created by the function from a payload for "send now").
   - Steps: verify JWT/admin (or verify an internal shared secret when called by cron), load app + notification, **re-validate URL server-side**, resolve the service account (override or central), get OAuth token (RS256 JWT, scope `https://www.googleapis.com/auth/firebase.messaging`, via Web Crypto), call `POST https://fcm.googleapis.com/v1/projects/{fcm_project_id}/messages:send`, then update the row (`sent`/`failed`, message ID, error).
   - Payload:
```json
{
  "message": {
    "topic": "<topic>",
    "notification": { "title": "...", "body": "...", "image": "<optional>" },
    "data": { "url": "<optional https url>" },
    "android": { "priority": "HIGH", "notification": { "channel_id": "<app channel_id>" } }
  }
}
```
   - Targets: `topic` (default `all`), `condition` (e.g. `'news' in topics && 'pro' in topics`), or single `token` (for testing).
   - Map FCM errors to readable hints (`UNREGISTERED`, `SENDER_ID_MISMATCH`, `INVALID_ARGUMENT`, 403 = service account lacks the FCM role or API not enabled in that project).
   - Never log secrets or the access token.
2. **`process-scheduled`**: finds `notifications` where `status='scheduled' and scheduled_at <= now()`, marks them `sending` atomically (avoid double sends), and sends each. Triggered by `pg_cron` every minute via `pg_net` with an internal secret header.
3. Keep both functions small, typed, with CORS limited to the panel's origin.

## Scheduling and keep-alive (Supabase free-tier pause)
- Real scheduled notifications via `pg_cron` -> `process-scheduled` (write the SQL to enable extensions and create the job).
- Free Supabase projects **pause after ~1 week of inactivity**. The cron job above keeps the project active. As a backup, add `.github/workflows/keepalive.yml`: scheduled daily (`cron`), does one lightweight request to the Supabase REST/health endpoint using repo **Actions secrets/variables** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`; the anon key is public by design). Mention in the README how to restore a paused project.

## Screens / features
1. **Login**: Google sign-in button, not-authorized state.
2. **Apps list (home)**: cards per app (name, package, FCM project ID, last notification, "Using central key / own key"). "Add app" button.
3. **Add/Edit app**: name, package name, FCM project ID, default topic, channel ID, optional per-app secret name, optional URL domain allow-list, delete with confirm.
4. **Compose & Send** (per app, main screen):
   - Fields: Title (max 65 chars, counter), Message (max 240 chars, counter), Link URL (optional), Image URL (optional), Target (All users / custom topic / condition / single token), **Send now** or **Schedule** (date-time picker, shows local time zone).
   - **Live Android notification preview** updating as I type.
   - **URL validation** (client and server): only `http://`/`https://` with a host; reject `javascript:`, `file:`, `intent:` etc.; enforce the app's domain allow-list if set.
   - Buttons: Send now / Schedule, **Send test to a token**, Save as template.
   - Confirmation modal before sending to a topic ("This will notify all users of <App>") with a summary.
   - Show success (message ID) or the exact error with a readable hint. Disable the Send button for 3 seconds after each click and while a request is in flight.
5. **History** (per app): table with status, target, time, duplicate/resend, cancel (for scheduled), delete log. Pagination (20 per page), search.
6. **Templates** (per app): list, use in composer, edit, delete.
7. **Settings**: theme toggle, export/import apps list (JSON, never any secrets), sign out.

## Android app requirements (also generate a short `ANDROID_SETUP.md`)
- `firebase-messaging` dependency and that app's own `google-services.json`.
- Call `FirebaseMessaging.getInstance().subscribeToTopic("all")` on first launch (required: this panel has no device-token database).
- Notification channel matching the app's `channel_id` (default `app_updates_channel`), `POST_NOTIFICATIONS` permission, and handling the `url` data key on tap (see my `Guideline_Notification.md`).
- Service account IAM setup: grant **Firebase Cloud Messaging Admin** in each app's Firebase project and enable **Firebase Cloud Messaging API (V1)**. Mention the org-policy `iam.disableServiceAccountKeyCreation` possibility and what to do.

## Project structure and deliverables
- `web/` (Vite app), `supabase/` (`migrations/`, `functions/send-notification`, `functions/process-scheduled`, `config.toml`), `.github/workflows/deploy.yml` (build + deploy to GitHub Pages using `actions/upload-pages-artifact` and `actions/deploy-pages`, with `permissions: pages: write, id-token: write`), `.github/workflows/keepalive.yml`, `.gitignore` (ignore `dist`, `node_modules`, `.env*`, `*service-account*.json`, `supabase/.temp`).
- `web/.env.example` with only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. In the deploy workflow, pass these from repo Actions **variables** at build time.
- Modules: `auth.ts`, `api.ts` (Supabase calls), `validate.ts` (URL/length validation shared logic), `ui/` screens. Edge Function code split into `fcm.ts` (JWT, token, send), `auth.ts` (admin check), `index.ts`.
- Tests (Vitest for web, `deno test` for functions) covering URL validation, payload building, and admin check logic.
- `README.md` with exact step-by-step setup: create the Supabase project, enable Google provider, run migrations, insert admin email, set secrets, deploy functions (`supabase functions deploy`), enable `pg_cron`/`pg_net` and create the job, create the GitHub repo (public), enable **Settings -> Pages -> Source: GitHub Actions**, add Actions variables/secrets, set Supabase Site URL and Redirect URLs to the Pages URL, push to `main` to deploy, add the first app, run the test checklist. Include a "never commit these" list (service account JSON, service role key) and advise enabling GitHub 2FA.

## Quality bar
- TypeScript strict mode, no `any`.
- No secrets in git, in the database, in the frontend bundle, or in logs.
- Visible error handling (toasts); never leave the UI stuck on "sending".
- Accessible: labels, focus states, keyboard usable, good contrast.
- After building, run the build and tests, and clearly list what you could NOT verify (e.g. live FCM send, cron execution, Google login).

Before writing code, briefly confirm the plan and flag any constraint you think cannot work on the free tiers.

---

## Addendum: features added after the first version
Everything above is the original brief. The project now also contains the following; include it when rebuilding.
The current behaviour is documented in `README.md`, `ANDROID_SETUP.md` and `Guideline_Notification.md`.

**Look and navigation**
- Light theme is the default (white, minimal, indigo to violet to fuchsia gradient accent); dark theme stays in Settings.
- Pages: Dashboard (7-day stats, success rate, scheduled count, chart, recent activity), Apps, per-app tabs
  Compose / History / Drafts & templates / Audience / App settings, and Settings.

**Apps**
- Extra fields: `icon_url` (https), `app_url` (auto-detected Play Store link from the package name when empty).

**Composer**
- Drafts (own table, removed after sending), template variables `{app_name}` `{date}` `{time}` `{day}` filled in by the
  server at send time using the notification's time zone, emoji picker, truncation hints (about 40 / 100 characters),
  image upload to a public Supabase Storage bucket (admin-only write, 1 MB, JPG/PNG/WebP).
- Delivery options: expiry (TTL, max 28 days), replace key (FCM collapse key and notification tag), priority
  (high/normal), campaign label. Every send gets an FCM `analytics_label` (default `push_YYYYMMDD`), stored on the row.

**Audiences without a device table**
- Devices subscribe to topics: `all`, `v_<versionCode>`, `country_<ISO>`, `tz_<Zone_Name>`, `utc_<p|m>HHMM`
  (no language topic). The Audience tab saves them per app; the composer builds an FCM condition with AND/OR
  (at most 5 topics per condition). The Android helper `PushTopics.sync(context)` keeps subscriptions in step and
  unsubscribes the previous version/country/time-zone/offset topic.

**Device-local-time sends**
- One scheduled child row per UTC offset (about 38) plus a parent row shown in History (`kind`: single, local_parent,
  local_child; `parent_id`; a trigger keeps the parent status in step). The scheduler must never claim a parent.
  If the local time already passed in a zone: skip it or send the next day. Targets: All users, Audience or custom topic.

**Settings**
- Export/import apps JSON, theme, sign out, and an **Android integration guide**: a complete copy-paste brief for an
  AI coding agent to add compatible push notifications to any other Android app (kept in `web/src/android-guide.md`).

**Lessons learned (avoid these mistakes)**
- Postgres regexes reject `[0-9-_]` ranges (put `-` last) and repetition counts above 255.
- Use Supabase Auth PKCE with hash routing so the OAuth redirect does not clash with the `#` router.
- Keep `verify_jwt` on; the cron job sends the legacy anon JWT plus an `x-cron-secret` header. Create the cron job from a
  git-ignored `cron.local.sql`; secrets live in Supabase Vault and function secrets only.
- The scheduler cron condition must exclude parent rows, or it calls the function every minute for nothing.
- A free GitHub Pages site needs a public repo, so nothing secret may ever be committed; rotate anything that was pasted in a chat.
- FCM delivery-stats API (`fcmdata.googleapis.com`) needs its own API enabled and a role containing
  `fcmdata.deliverydata.list`; data arrives several days late with a 7-day window.
