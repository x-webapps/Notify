// Per-app service-account keys uploaded from the panel: validate, encrypt, store, load.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { decryptText, encryptText } from "./crypto.ts";
import { buildMessage, getAccessToken, sendFcm } from "./fcm.ts";

const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,29}$/;
const EMAIL_RE = /^[^@\s]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/i;
export const MAX_KEY_BYTES = 20_000;

export interface UploadedKey {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Validates a downloaded Firebase/Google service-account file. Throws a readable message. */
export function parseUploadedKey(text: string): UploadedKey {
  if (text.length > MAX_KEY_BYTES) throw new Error("That file is too large to be a service account key.");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (data === null || typeof data !== "object" || data.type !== "service_account") {
    throw new Error("This is not a service account key. In Firebase: Project settings → Service accounts → Generate new private key.");
  }
  const { project_id, client_email, private_key } = data;
  if (typeof project_id !== "string" || !PROJECT_ID_RE.test(project_id)) {
    throw new Error("The key has no usable project_id.");
  }
  if (typeof client_email !== "string" || !EMAIL_RE.test(client_email)) {
    throw new Error("The key's client_email is not a Google service account address.");
  }
  if (typeof private_key !== "string" || !/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(private_key)) {
    throw new Error("The key has no private_key.");
  }
  return { project_id, client_email, private_key };
}

export interface SaveOutcome {
  ok: boolean;
  project_id?: string;
  service_account_email?: string;
  error?: string;
  hint?: string;
}

type EnvGetter = (name: string) => string | undefined;

/** Proves the key works against FCM (nothing is delivered), then stores it encrypted. */
export async function saveAppCredential(
  db: SupabaseClient,
  appId: string,
  text: string,
  env: EnvGetter = (n) => Deno.env.get(n),
): Promise<SaveOutcome> {
  const key = parseUploadedKey(text);
  const base = { project_id: key.project_id, service_account_email: key.client_email };

  const { data: app } = await db.from("apps").select("id,default_topic,channel_id").eq("id", appId)
    .maybeSingle<{ id: string; default_topic: string; channel_id: string }>();
  if (!app) return { ok: false, error: "App not found." };

  try {
    const token = await getAccessToken({ client_email: key.client_email, private_key: key.private_key });
    const payload = buildMessage({
      title: "Connection check",
      body: "Connection check",
      target_type: "topic",
      target_value: app.default_topic || "all",
      channel_id: app.channel_id,
    });
    const outcome = await sendFcm(key.project_id, token, payload, true);
    if (!outcome.ok) return { ok: false, ...base, error: outcome.error, hint: outcome.hint };
  } catch (e) {
    return { ok: false, ...base, error: (e instanceof Error ? e.message : "Unexpected error").slice(0, 500) };
  }

  // Store only what sending needs, not the rest of the downloaded file.
  const minimal = JSON.stringify({ type: "service_account", ...key });
  const ciphertext = await encryptText(minimal, env("CREDENTIAL_ENCRYPTION_KEY"), appId);

  const { error: saveError } = await db.from("app_credentials").upsert({
    app_id: appId,
    ciphertext,
    project_id: key.project_id,
    client_email: key.client_email,
    updated_at: new Date().toISOString(),
  });
  if (saveError) return { ok: false, ...base, error: "Could not save the key." };

  const { error: appError } = await db.from("apps").update({
    fcm_project_id: key.project_id,
    has_credential: true,
    credential_email: key.client_email,
  }).eq("id", appId);
  if (appError) return { ok: false, ...base, error: "The key was saved but the app could not be updated. Try again." };
  return { ok: true, ...base };
}

export async function removeAppCredential(db: SupabaseClient, appId: string): Promise<void> {
  await db.from("app_credentials").delete().eq("app_id", appId);
  await db.from("apps").update({ has_credential: false, credential_email: null }).eq("id", appId);
}

/** The decrypted key JSON for an app, or null if it has no uploaded key. */
export async function loadAppCredential(
  db: SupabaseClient,
  appId: string,
  env: EnvGetter = (n) => Deno.env.get(n),
): Promise<string | null> {
  const { data } = await db.from("app_credentials").select("ciphertext").eq("app_id", appId)
    .maybeSingle<{ ciphertext: string }>();
  if (!data) return null;
  return await decryptText(data.ciphertext, env("CREDENTIAL_ENCRYPTION_KEY"), appId);
}
