// Sends one already-claimed notification (status = 'sending') and records the outcome.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { loadAppCredential } from "./credentials.ts";
import { buildMessage, getAccessToken, parseServiceAccount, sendFcm } from "./fcm.ts";
import type { AppRow, DeliveryResult, NotificationRow } from "./types.ts";
import { defaultAnalyticsLabel, isValidSecretName, validateNotification } from "./validate.ts";
import { renderVariables } from "./variables.ts";

export type EnvGetter = (name: string) => string | undefined;

/** Per-app override first (only FCM_SERVICE_ACCOUNT_* names), then the central secret. */
export function resolveServiceAccountJson(secretKey: string | null, env: EnvGetter): string | null {
  if (secretKey && isValidSecretName(secretKey)) {
    const override = env(secretKey);
    if (override) return override;
  }
  return env("FCM_SERVICE_ACCOUNT") ?? null;
}

/** Key uploaded in the panel first, then the per-app secret, then the central secret. */
async function resolveAppKey(db: SupabaseClient, app: AppRow, env: EnvGetter): Promise<string | null> {
  return (await loadAppCredential(db, app.id, env)) ?? resolveServiceAccountJson(app.secret_key, env);
}

const NO_KEY_ERROR = "No service account key for this app.";
const NO_KEY_HINT = "Open the app's settings and upload its Firebase service account key (or set FCM_SERVICE_ACCOUNT on the server).";

async function finish(
  db: SupabaseClient,
  row: NotificationRow,
  result: { ok: boolean; messageId?: string; error?: string; hint?: string },
  analyticsLabel?: string,
): Promise<DeliveryResult> {
  const status = result.ok ? "sent" : "failed";
  const error = result.ok ? null : [result.error, result.hint].filter(Boolean).join(" | ").slice(0, 1000);
  await db.from("notifications").update({
    ...(analyticsLabel ? { analytics_label: analyticsLabel } : {}),
    status,
    sent_at: result.ok ? new Date().toISOString() : null,
    fcm_message_id: result.ok ? result.messageId ?? null : null,
    error,
  }).eq("id", row.id);
  return {
    notification_id: row.id,
    ok: result.ok,
    status,
    message_id: result.messageId,
    error: result.error,
    hint: result.hint,
  };
}

export interface ConnectionCheck {
  ok: boolean;
  project_id?: string;
  service_account_email?: string;
  error?: string;
  hint?: string;
}

/**
 * Dry run against FCM (validate_only): proves the service account is valid, the project ID exists,
 * the FCM V1 API is enabled and the account may send there. Nothing is delivered. It cannot tell
 * whether the Android app is installed or subscribed, because FCM does not expose that.
 */
export async function checkConnection(
  db: SupabaseClient,
  appId: string,
  env: EnvGetter = (n) => Deno.env.get(n),
): Promise<ConnectionCheck> {
  const { data: app } = await db.from("apps").select("id,fcm_project_id,default_topic,channel_id,secret_key")
    .eq("id", appId).maybeSingle<AppRow>();
  if (!app) return { ok: false, error: "App not found." };

  let json: string | null;
  try {
    json = await resolveAppKey(db, app, env);
  } catch (e) {
    return { ok: false, project_id: app.fcm_project_id, error: e instanceof Error ? e.message : "Could not load the key." };
  }
  if (!json) return { ok: false, project_id: app.fcm_project_id, error: NO_KEY_ERROR, hint: NO_KEY_HINT };

  let sa;
  try {
    sa = parseServiceAccount(json);
  } catch (e) {
    return { ok: false, project_id: app.fcm_project_id, error: e instanceof Error ? e.message : "Invalid service account." };
  }
  const base = { project_id: app.fcm_project_id, service_account_email: sa.client_email };

  try {
    const token = await getAccessToken(sa);
    const payload = buildMessage({
      title: "Connection check",
      body: "Connection check",
      target_type: "topic",
      target_value: app.default_topic || "all",
      channel_id: app.channel_id,
    });
    const outcome = await sendFcm(app.fcm_project_id, token, payload, true);
    if (outcome.ok) return { ok: true, ...base };
    // A topic send never hits "unregistered token", so 404 here means the project is not reachable.
    const notFound = /NOT_FOUND|UNREGISTERED|404/.test(outcome.error ?? "");
    return {
      ok: false,
      ...base,
      error: outcome.error,
      hint: notFound
        ? "Firebase project not found. Check the FCM project ID, and that FCM API (V1) is enabled in that project."
        : outcome.hint,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return { ok: false, ...base, error: message.slice(0, 500) };
  }
}

export async function deliver(
  db: SupabaseClient,
  row: NotificationRow,
  env: EnvGetter = (n) => Deno.env.get(n),
): Promise<DeliveryResult> {
  try {
    const { data: app, error: appError } = await db.from("apps").select(
      "id,name,package_name,fcm_project_id,default_topic,channel_id,secret_key,url_allowlist",
    ).eq("id", row.app_id).maybeSingle<AppRow>();
    if (appError || !app) return await finish(db, row, { ok: false, error: "App not found." });

    // Variables ({date} etc.) are filled in now, so scheduled sends get the send-time values.
    const vars = { appName: app.name, now: new Date(), tz: row.tz };
    // Every send is tagged for FCM delivery reports; the label used is stored on the row.
    const analyticsLabel = row.analytics_label || defaultAnalyticsLabel(vars.now);
    const content = {
      ...row,
      title: renderVariables(row.title, vars),
      body: renderVariables(row.body, vars),
      analytics_label: analyticsLabel,
    };

    const problems = validateNotification(content, app.url_allowlist);
    if (problems.length > 0) {
      return await finish(db, row, { ok: false, error: `Validation failed: ${problems.join(" ")}` }, analyticsLabel);
    }

    const json = await resolveAppKey(db, app, env);
    if (!json) return await finish(db, row, { ok: false, error: NO_KEY_ERROR, hint: NO_KEY_HINT });

    const accessToken = await getAccessToken(parseServiceAccount(json));
    const payload = buildMessage({ ...content, channel_id: app.channel_id });
    const outcome = await sendFcm(app.fcm_project_id, accessToken, payload);
    return await finish(db, row, outcome, analyticsLabel);
  } catch (e) {
    // Messages here never contain secrets (they come from our own error strings).
    const message = e instanceof Error ? e.message : "Unexpected error";
    return await finish(db, row, { ok: false, error: message.slice(0, 500) });
  }
}
