// POST { notification_id }                      -> send an existing scheduled/failed row now
// POST { app_id, title, body, url?, image_url?, target_type, target_value } -> create + send now
import { bearerToken, isAllowedAdmin, isValidCronSecret } from "../_shared/auth.ts";
import { deliver } from "../_shared/deliver.ts";
import { corsHeaders, json, serviceClient } from "../_shared/http.ts";
import type { AppRow, NotificationRow } from "../_shared/types.ts";
import { safeTimeZone } from "../_shared/variables.ts";
import { type NotificationInput, type TargetType, validateNotification } from "../_shared/validate.ts";

interface SendPayload extends Partial<NotificationInput> {
  notification_id?: string;
  tz?: string;
  app_id?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // Caller is either the scheduler (internal secret) or a signed-in admin.
    const viaCron = isValidCronSecret(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"));
    let adminEmail = "scheduler";
    if (!viaCron) {
      const jwt = bearerToken(req.headers.get("Authorization"));
      if (!jwt) return json(req, { error: "Not signed in." }, 401);
      const { data, error } = await db.auth.getUser(jwt);
      if (error || !data.user) return json(req, { error: "Invalid session." }, 401);
      const { data: admins, error: adminsError } = await db.from("admins").select("email");
      if (adminsError) return json(req, { error: "Could not check admin list." }, 500);
      if (!isAllowedAdmin(data.user, (admins ?? []).map((a: { email: string }) => a.email))) {
        return json(req, { error: "Not authorized." }, 403);
      }
      adminEmail = data.user.email ?? "unknown";
    }

    let payload: SendPayload;
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Body must be JSON." }, 400);
    }

    let row: NotificationRow;
    if (payload.notification_id) {
      if (!UUID_RE.test(payload.notification_id)) return json(req, { error: "Invalid notification_id." }, 400);
      const { data, error } = await db.rpc("claim_notification", { p_id: payload.notification_id });
      const claimed = (data as NotificationRow[] | null)?.[0];
      if (error || !claimed) {
        return json(req, { error: "Notification not found or not in a sendable state (scheduled/failed)." }, 409);
      }
      row = claimed;
    } else {
      if (viaCron) return json(req, { error: "Scheduler may only send existing notifications." }, 400);
      if (!payload.app_id || !UUID_RE.test(payload.app_id)) return json(req, { error: "app_id is required." }, 400);
      const { data: app } = await db.from("apps").select("id,url_allowlist").eq("id", payload.app_id)
        .maybeSingle<Pick<AppRow, "id" | "url_allowlist">>();
      if (!app) return json(req, { error: "App not found." }, 404);

      const input: NotificationInput = {
        title: String(payload.title ?? ""),
        body: String(payload.body ?? ""),
        url: payload.url ? String(payload.url) : null,
        image_url: payload.image_url ? String(payload.image_url) : null,
        target_type: payload.target_type as TargetType,
        target_value: String(payload.target_value ?? ""),
        ttl_seconds: payload.ttl_seconds == null ? null : Number(payload.ttl_seconds),
        collapse_key: payload.collapse_key ? String(payload.collapse_key).trim() : null,
        priority: payload.priority === "normal" ? "normal" : "high",
        analytics_label: payload.analytics_label ? String(payload.analytics_label).trim() : null,
      };
      const problems = validateNotification(input, app.url_allowlist);
      if (problems.length > 0) return json(req, { error: problems.join(" "), problems }, 400);

      const { data: inserted, error: insertError } = await db.from("notifications").insert({
        app_id: app.id,
        title: input.title.trim(),
        body: input.body.trim(),
        url: input.url?.trim() || null,
        image_url: input.image_url?.trim() || null,
        target_type: input.target_type,
        target_value: input.target_value.trim(),
        tz: safeTimeZone(payload.tz),
        ttl_seconds: input.ttl_seconds,
        collapse_key: input.collapse_key,
        priority: input.priority,
        analytics_label: input.analytics_label,
        status: "sending",
        claimed_at: new Date().toISOString(),
        created_by: adminEmail,
      }).select().single<NotificationRow>();
      if (insertError || !inserted) return json(req, { error: "Could not create the notification." }, 500);
      row = inserted;
    }

    const result = await deliver(db, row);
    return json(req, result);
  } catch (_e) {
    // Deliberately generic: never echo internals or secrets.
    return json(req, { error: "Unexpected server error." }, 500);
  }
});
