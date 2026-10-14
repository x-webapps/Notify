// Validation shared by send-notification and process-scheduled.
// NOTE: web/src/validate.ts mirrors this logic for client-side checks. Keep both in sync.

export const LIMITS = { title: 65, body: 240, url: 2048 } as const;

export type TargetType = "topic" | "condition" | "token";

export interface NotificationInput {
  title: string;
  body: string;
  url?: string | null;
  image_url?: string | null;
  target_type: TargetType;
  target_value: string;
  /** Drop the message if the device is offline longer than this (null = FCM default, 4 weeks). */
  ttl_seconds?: number | null;
  /** Newer messages with the same key replace older ones. */
  collapse_key?: string | null;
  priority?: "high" | "normal";
  analytics_label?: string | null;
}

export const MAX_TTL_SECONDS = 2_419_200; // 28 days, the FCM maximum

const KEY_RE = /^[a-zA-Z0-9_.~%-]{1,64}$/;
const LABEL_RE = /^[a-zA-Z0-9_.~%-]{1,50}$/;

const HTTP_RE = /^https?:\/\//i;
const HTTPS_RE = /^https:\/\//i;
// deno-lint-ignore no-control-regex
const BAD_CHARS_RE = /[\u0000- \u007f]/;
const TOPIC_RE = /^[a-zA-Z0-9_.~%-]{1,255}$/;
const CONDITION_RE = /^[a-zA-Z0-9\-_.~%'"&|()! ]{1,1000}$/;
const TOKEN_RE = /^[A-Za-z0-9\-_:]{20,4096}$/;
const SECRET_NAME_RE = /^FCM_SERVICE_ACCOUNT_[A-Z0-9_]{1,60}$/;

/** Returns the parsed URL only for plain http(s) URLs that have a host and no credentials. */
export function parseHttpUrl(raw: string): URL | null {
  const value = raw.trim();
  if (!value || value.length > LIMITS.url) return null;
  if (!HTTP_RE.test(value) || BAD_CHARS_RE.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;
  return url;
}

export function normalizeDomain(entry: string): string {
  return entry.trim().toLowerCase().replace(/^\*?\./, "").replace(/\/.*$/, "");
}

export function hostAllowed(host: string, allowlist: readonly string[] | null | undefined): boolean {
  const domains = (allowlist ?? []).map(normalizeDomain).filter(Boolean);
  if (domains.length === 0) return true;
  const h = host.toLowerCase();
  return domains.some((d) => h === d || h.endsWith("." + d));
}

/** Returns an error message, or null when the link is acceptable (empty is acceptable). */
export function validateLink(
  raw: string | null | undefined,
  allowlist?: readonly string[] | null,
): string | null {
  if (raw == null || raw.trim() === "") return null;
  const url = parseHttpUrl(raw);
  if (!url) return "Link must be a valid http:// or https:// URL with a host.";
  if (!hostAllowed(url.hostname, allowlist)) {
    return `Link host "${url.hostname}" is not in this app's allowed domains.`;
  }
  return null;
}

export function validateImage(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === "") return null;
  const value = raw.trim();
  if (!HTTPS_RE.test(value) || !parseHttpUrl(value)) return "Image must be a valid https:// URL.";
  return null;
}

export function validateTarget(type: string, value: string): string | null {
  const v = value.trim();
  if (type === "topic") return TOPIC_RE.test(v) ? null : "Topic may only contain letters, numbers and -_.~%";
  if (type === "condition") {
    if (!CONDITION_RE.test(v) || !/in\s+topics/.test(v)) {
      return "Condition must look like 'news' in topics && 'pro' in topics";
    }
    return null;
  }
  if (type === "token") return TOKEN_RE.test(v) ? null : "Device token looks invalid.";
  return "Unknown target type.";
}

export function validateNotification(
  input: NotificationInput,
  allowlist?: readonly string[] | null,
): string[] {
  const errors: string[] = [];
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (!title) errors.push("Title is required.");
  if (title.length > LIMITS.title) errors.push(`Title must be at most ${LIMITS.title} characters.`);
  if (!body) errors.push("Message is required.");
  if (body.length > LIMITS.body) errors.push(`Message must be at most ${LIMITS.body} characters.`);
  const link = validateLink(input.url, allowlist);
  if (link) errors.push(link);
  const image = validateImage(input.image_url);
  if (image) errors.push(image);
  const target = validateTarget(input.target_type, input.target_value ?? "");
  if (target) errors.push(target);
  errors.push(...validateDelivery(input));
  return errors;
}

export function validateDelivery(
  o: Pick<NotificationInput, "ttl_seconds" | "collapse_key" | "priority" | "analytics_label">,
): string[] {
  const errors: string[] = [];
  const ttl = o.ttl_seconds;
  if (ttl != null && (!Number.isInteger(ttl) || ttl < 0 || ttl > MAX_TTL_SECONDS)) {
    errors.push("Expiry must be between 0 seconds and 28 days.");
  }
  if (o.collapse_key && !KEY_RE.test(o.collapse_key)) {
    errors.push("Replace key may only contain letters, numbers and -_.~% (max 64).");
  }
  if (o.priority != null && o.priority !== "high" && o.priority !== "normal") errors.push("Priority must be high or normal.");
  if (o.analytics_label && !LABEL_RE.test(o.analytics_label)) {
    errors.push("Campaign label may only contain letters, numbers and -_.~% (max 50).");
  }
  return errors;
}

/** Default FCM analytics label when none is set: one label per day, e.g. push_20261014. */
export function defaultAnalyticsLabel(now: Date): string {
  return `push_${now.toISOString().slice(0, 10).replaceAll("-", "")}`;
}

/** Per-app secret names must be FCM_SERVICE_ACCOUNT_*, so apps can never read other env vars. */
export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name);
}
