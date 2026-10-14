# Setup Guide: Push Notification Admin Panel (Beginner, Windows)

Stack: **GitHub Pages** (site) + **Supabase** (login, database, functions, secrets) + **Firebase FCM** (delivery to apps).
Use this together with `Prompt_AdminPanel.md`.

Tip: work in **small stages**, commit after each stage, and show any error or screenshot to Claude.

---

## Stage 0: Install and accounts (before Claude)
1. Install **Node.js LTS** (nodejs.org) and **Git** (git-scm.com).
2. Open a new terminal and check:
```bash
node -v
git -v
```
3. Create accounts: **GitHub**, **Supabase** (use "Continue with GitHub"), and your existing Google/Firebase account.
4. Turn on **2FA** on GitHub.
5. Create an empty folder, e.g. `A:\Projects\push-admin`.

## Stage 1: Open the project in Claude Code
1. Claude desktop app -> **Code** tab -> select the `push-admin` folder.
2. Paste everything below the `---` line from `Prompt_AdminPanel.md`.
3. Claude will first confirm a plan. Read it, ask if unclear, then say "go ahead".

If it is too much at once, say: "First create only `supabase/` (migrations and functions). Frontend and workflows later."
Suggested order: (1) supabase/, (2) web/, (3) GitHub workflows, (4) README and ANDROID_SETUP.md.

## Stage 2: Things you must do yourself (dashboards, logins)
1. **Supabase project**: create it, then copy the **Project URL** and **anon key** (Settings -> API).
2. **Google login**:
   - Google Cloud Console -> APIs & Services -> Credentials -> create **OAuth client ID (Web application)**.
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Supabase -> Authentication -> Providers -> Google: paste Client ID and Secret, enable it.
3. **Service account key**:
   - Firebase Console -> Project settings -> Service accounts -> **Generate new private key**.
   - Save the JSON **outside the project folder** (e.g. `Documents`).
4. **IAM role in every app's Firebase project**:
   - Google Cloud Console -> IAM -> Grant access -> the service account email -> role **Firebase Cloud Messaging Admin**.
   - Make sure **Firebase Cloud Messaging API (V1)** is enabled in that project.

## Stage 3: Deploy Supabase (terminal)
Claude can run these; you approve the login in the browser.
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
npx supabase functions deploy send-notification
npx supabase functions deploy process-scheduled
```
Set the secret **yourself** in the terminal (do NOT paste the JSON into chat):
```bash
npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat C:/Users/<your-name>/Documents/key.json)"
```
Then in Supabase **SQL Editor**, insert your email into the `admins` table (Claude gives the seed snippet).
Enable `pg_cron` and `pg_net` and create the scheduler job (also provided by Claude).

## Stage 4: Put it on GitHub Pages
1. Create a **public** GitHub repo (Pages free plan needs public).
2. Before committing, run `git status` and make sure **no** `.json` key or `.env` file is listed.
3. Push:
```bash
git add .
git commit -m "Initial admin panel"
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```
4. Repo -> Settings -> **Pages -> Source: GitHub Actions**.
5. Repo -> Settings -> Secrets and variables -> Actions -> **Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Supabase -> Authentication -> URL Configuration:
   - Site URL: `https://<user>.github.io/<repo>/`
   - Redirect URLs: the same URL (and `http://localhost:5173` for local dev).
7. Push triggers the deploy; watch the repo **Actions** tab. Then open the site.

## Stage 5: Android apps
Each app needs (see `ANDROID_SETUP.md` and `Guideline_Notification.md`):
- `firebase-messaging` dependency and its own `google-services.json`.
- `FirebaseMessaging.getInstance().subscribeToTopic("all")` on first launch. Without it, topic notifications will not arrive.
- Channel `app_updates_channel`, `POST_NOTIFICATIONS` permission, and handling of the `url` key on tap.

## Stage 6: Test
1. Open the site and sign in with Google (must be your email in `admins`).
2. Add an app (name, package, **FCM project ID**).
3. **Send test to a token** first (get the token from Logcat).
4. Then send to topic `all`.
5. Check: foreground, background, killed; tap opens the link.
6. Try an invalid URL (`javascript:alert(1)`): it must be rejected.

## Safety rules
- Never paste or commit: **service account JSON**, **service role key**, **Google client secret**. The repo is public.
- Only the **anon key** and Supabase URL may be in the frontend (they are public by design).
- Check `git status` before every commit.
- Keep GitHub and Google accounts protected with 2FA.

## Troubleshooting
| Problem | What to check |
|---|---|
| Login redirects wrongly / fails | Supabase Site URL and Redirect URLs; Google OAuth redirect URI |
| "Not authorized" after login | Your email is missing in `admins` (check spelling) |
| Blank page on GitHub Pages | Vite `base` must be `/<repo>/`; check the Actions build log |
| Send fails with 403 | Service account lacks **FCM Admin** role in that app's project, or FCM V1 API not enabled |
| Send OK but nothing arrives | App not subscribed to the topic; notification permission off; wrong FCM project ID |
| Scheduled notification not sent | `pg_cron`/`pg_net` not enabled or cron job missing; check `notifications.status` |
| Supabase project paused | Dashboard -> Restore project; keep the cron/keepalive workflow running |
| Can't create service account key | Org policy `iam.disableServiceAccountKeyCreation` is blocking it |

## If you get stuck
Copy the error or take a screenshot and show it to Claude: "I got this error at Stage X, what should I do?"
