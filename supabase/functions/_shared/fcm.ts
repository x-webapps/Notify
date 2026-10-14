// FCM HTTP v1 helpers: service-account OAuth (Web Crypto), message building, sending, error hints.
// Never log service accounts or access tokens.

import type { TargetType } from "./validate.ts";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token"; // fixed on purpose, never taken from the JSON
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export function parseServiceAccount(json: string): ServiceAccount {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("The service account secret is not valid JSON.");
  }
  const { client_email, private_key } = data;
  if (typeof client_email !== "string" || typeof private_key !== "string") {
    throw new Error("The service account JSON is missing client_email or private_key.");
  }
  return { client_email, private_key };
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function signJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(sig)}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const cached = tokenCache.get(sa.client_email);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;

  const assertion = await signJwt(sa, Math.floor(Date.now() / 1000));
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) {
    let reason = "";
    try {
      const err = await res.json();
      reason = String(err.error_description ?? err.error ?? "");
    } catch { /* ignore */ }
    throw new Error(`Google OAuth token request failed (${res.status}). ${reason}`.trim());
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache.set(sa.client_email, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

export interface MessageInput {
  title: string;
  body: string;
  url?: string | null;
  image_url?: string | null;
  target_type: TargetType;
  target_value: string;
  channel_id: string;
  ttl_seconds?: number | null;
  collapse_key?: string | null;
  priority?: "high" | "normal";
  analytics_label?: string | null;
}

export interface FcmMessage {
  message: {
    topic?: string;
    condition?: string;
    token?: string;
    notification: { title: string; body: string; image?: string };
    data?: Record<string, string>;
    android: {
      priority: "HIGH" | "NORMAL";
      ttl?: string;
      collapse_key?: string;
      notification: { channel_id: string; tag?: string };
    };
    fcm_options?: { analytics_label: string };
  };
}

export function buildMessage(input: MessageInput): FcmMessage {
  const notification: FcmMessage["message"]["notification"] = {
    title: input.title.trim(),
    body: input.body.trim(),
  };
  const image = input.image_url?.trim();
  if (image) notification.image = image;

  const message: FcmMessage["message"] = {
    notification,
    android: {
      priority: input.priority === "normal" ? "NORMAL" : "HIGH",
      notification: { channel_id: input.channel_id },
    },
  };
  if (input.ttl_seconds != null) message.android.ttl = `${input.ttl_seconds}s`;
  const key = input.collapse_key?.trim();
  if (key) {
    message.android.collapse_key = key; // replaces a queued message while the device is offline
    message.android.notification.tag = key; // replaces the one already shown in the tray
  }
  const label = input.analytics_label?.trim();
  if (label) message.fcm_options = { analytics_label: label };
  const target = input.target_value.trim();
  if (input.target_type === "topic") message.topic = target;
  else if (input.target_type === "condition") message.condition = target;
  else message.token = target;

  const url = input.url?.trim();
  if (url) message.data = { url };
  return { message };
}

export interface SendOutcome {
  ok: boolean;
  messageId?: string;
  error?: string;
  hint?: string;
}

export function mapFcmError(status: number, body: unknown): { error: string; hint: string } {
  const err = (body as { error?: { message?: string; status?: string; details?: { errorCode?: string }[] } } | null)
    ?.error;
  const code = err?.details?.find((d) => d.errorCode)?.errorCode ?? err?.status ?? String(status);
  const detail = err?.message ?? "Unknown FCM error";
  let hint: string;
  if (code === "UNREGISTERED" || status === 404) {
    hint = "The device token is no longer registered (app uninstalled or token expired), or the FCM project ID is wrong.";
  } else if (code === "SENDER_ID_MISMATCH") {
    hint = "The token belongs to a different Firebase project than the FCM project ID configured for this app.";
  } else if (code === "INVALID_ARGUMENT" || status === 400) {
    hint = "FCM rejected the message. Check the topic/condition/token and that image and link are valid.";
  } else if (code === "PERMISSION_DENIED" || status === 403) {
    hint =
      "Access denied. The service account needs the 'Firebase Cloud Messaging Admin' role in this app's Firebase project, and 'Firebase Cloud Messaging API (V1)' must be enabled there.";
  } else if (code === "QUOTA_EXCEEDED" || status === 429) {
    hint = "FCM rate limit reached. Wait a moment and try again.";
  } else if (code === "UNAVAILABLE" || code === "INTERNAL" || status >= 500) {
    hint = "FCM is temporarily unavailable. Try again shortly.";
  } else if (status === 401) {
    hint = "FCM rejected the credentials. Check the service account secret.";
  } else {
    hint = "See the error detail from FCM.";
  }
  return { error: `${code}: ${detail}`.slice(0, 600), hint };
}

export async function sendFcm(projectId: string, accessToken: string, payload: FcmMessage): Promise<SendOutcome> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch { /* non-JSON error body */ }
  if (res.ok) return { ok: true, messageId: (body as { name?: string } | null)?.name ?? "" };
  return { ok: false, ...mapFcmError(res.status, body) };
}
