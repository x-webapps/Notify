// POST { app_id, action: "save", service_account: "<key file text>" } -> validate against FCM, store encrypted
// POST { app_id, action: "remove" }                                    -> delete the stored key
// Signed-in admins only. The key is never returned or logged.
import { bearerToken, isAllowedAdmin } from "../_shared/auth.ts";
import { removeAppCredential, saveAppCredential } from "../_shared/credentials.ts";
import { corsHeaders, json, serviceClient } from "../_shared/http.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) return json(req, { error: "Not signed in." }, 401);
    const { data, error } = await db.auth.getUser(jwt);
    if (error || !data.user) return json(req, { error: "Invalid session." }, 401);
    const { data: admins, error: adminsError } = await db.from("admins").select("email");
    if (adminsError) return json(req, { error: "Could not check admin list." }, 500);
    if (!isAllowedAdmin(data.user, (admins ?? []).map((a: { email: string }) => a.email))) {
      return json(req, { error: "Not authorized." }, 403);
    }

    let payload: { app_id?: string; action?: string; service_account?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Body must be JSON." }, 400);
    }
    if (!payload.app_id || !UUID_RE.test(payload.app_id)) return json(req, { error: "app_id is required." }, 400);

    if (payload.action === "remove") {
      await removeAppCredential(db, payload.app_id);
      return json(req, { ok: true });
    }
    if (payload.action === "save") {
      if (typeof payload.service_account !== "string") return json(req, { error: "service_account is required." }, 400);
      try {
        return json(req, await saveAppCredential(db, payload.app_id, payload.service_account));
      } catch (e) {
        // parseUploadedKey / encryption errors are our own readable messages and never contain the key.
        return json(req, { error: e instanceof Error ? e.message : "Invalid key." }, 400);
      }
    }
    return json(req, { error: "Unknown action." }, 400);
  } catch (_e) {
    return json(req, { error: "Unexpected server error." }, 500);
  }
});
