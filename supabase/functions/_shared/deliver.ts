// Sends one already-claimed notification (status = 'sending') and records the outcome.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { buildMessage, getAccessToken, parseServiceAccount, sendFcm } from "./fcm.ts";
import type { AppRow, DeliveryResult, NotificationRow } from "./types.ts";
import { isValidSecretName, validateNotification } from "./validate.ts";

export type EnvGetter = (name: string) => string | undefined;

/** Per-app override first (only FCM_SERVICE_ACCOUNT_* names), then the central secret. */
export function resolveServiceAccountJson(secretKey: string | null, env: EnvGetter): string | null {
  if (secretKey && isValidSecretName(secretKey)) {
    const override = env(secretKey);
    if (override) return override;
  }
  return env("FCM_SERVICE_ACCOUNT") ?? null;
}

async function finish(
  db: SupabaseClient,
  row: NotificationRow,
  result: { ok: boolean; messageId?: string; error?: string; hint?: string },
): Promise<DeliveryResult> {
  const status = result.ok ? "sent" : "failed";
  const error = result.ok ? null : [result.error, result.hint].filter(Boolean).join(" | ").slice(0, 1000);
  await db.from("notifications").update({
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

    const problems = validateNotification(row, app.url_allowlist);
    if (problems.length > 0) {
      return await finish(db, row, { ok: false, error: `Validation failed: ${problems.join(" ")}` });
    }

    const json = resolveServiceAccountJson(app.secret_key, env);
    if (!json) {
      return await finish(db, row, {
        ok: false,
        error: "No FCM service account secret configured.",
        hint: "Set FCM_SERVICE_ACCOUNT (or the app's own secret) with `supabase secrets set`.",
      });
    }

    const accessToken = await getAccessToken(parseServiceAccount(json));
    const payload = buildMessage({ ...row, channel_id: app.channel_id });
    const outcome = await sendFcm(app.fcm_project_id, accessToken, payload);
    return await finish(db, row, outcome);
  } catch (e) {
    // Messages here never contain secrets (they come from our own error strings).
    const message = e instanceof Error ? e.message : "Unexpected error";
    return await finish(db, row, { ok: false, error: message.slice(0, 500) });
  }
}
