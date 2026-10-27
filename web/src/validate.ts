// Client-side validation. Mirrors supabase/functions/_shared/validate.ts (the server re-validates
// everything; this copy only gives instant feedback). Keep both in sync.

export const LIMITS = { title: 65, body: 240, url: 2048 } as const;

export type TargetType = "topic" | "condition" | "token";

export interface NotificationInput {
  title: string;
  body: string;
  url?: string | null;
  image_url?: string | null;
  target_type: TargetType;
  target_value: string;
}

const HTTP_RE = /^https?:\/\//i;
const HTTPS_RE = /^https:\/\//i;
// eslint-disable-next-line no-control-regex
const BAD_CHARS_RE = /[\u0000- \u007f]/;
const TOPIC_RE = /^[a-zA-Z0-9_.~%-]{1,255}$/;
const CONDITION_RE = /^[a-zA-Z0-9\-_.~%'"&|()! ]{1,1000}$/;
const TOKEN_RE = /^[A-Za-z0-9\-_:]{20,4096}$/;
export const SECRET_NAME_RE = /^FCM_SERVICE_ACCOUNT_[A-Z0-9_]{1,60}$/;
export const FCM_PROJECT_RE = /^[a-z][a-z0-9-]{4,29}$/;

export function isValidTopic(value: string): boolean {
  return TOPIC_RE.test(value.trim());
}

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

export function parseDomainList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map(normalizeDomain).filter(Boolean))];
}

export function hostAllowed(host: string, allowlist: readonly string[] | null | undefined): boolean {
  const domains = (allowlist ?? []).map(normalizeDomain).filter(Boolean);
  if (domains.length === 0) return true;
  const h = host.toLowerCase();
  return domains.some((d) => h === d || h.endsWith("." + d));
}

/** Returns an error message, or null when the link is acceptable (empty is acceptable). */
export function validateLink(raw: string | null | undefined, allowlist?: readonly string[] | null): string | null {
  if (raw == null || raw.trim() === "") return null;
  const url = parseHttpUrl(raw);
  if (!url) return "Link must be a valid http:// or https:// URL with a host.";
  if (!hostAllowed(url.hostname, allowlist)) {
    return `Link host "${url.hostname}" is not in this app's allowed domains.`;
  }
  return null;
}

/** Play Store page derived from the package name (used when no App URL is set). */
export function playStoreUrl(packageName: string): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName.trim())}`;
}

/** The App URL if set and valid, otherwise the auto-detected Play Store link. */
export function effectiveAppUrl(app: { app_url: string | null; package_name: string }): string {
  const custom = app.app_url?.trim();
  return custom && parseHttpUrl(custom) ? custom : playStoreUrl(app.package_name);
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

export interface FieldErrors {
  title?: string;
  body?: string;
  url?: string;
  image_url?: string;
  target_value?: string;
}

export function validateFields(input: NotificationInput, allowlist?: readonly string[] | null): FieldErrors {
  const errors: FieldErrors = {};
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) errors.title = "Title is required.";
  else if (title.length > LIMITS.title) errors.title = `Title must be at most ${LIMITS.title} characters.`;
  if (!body) errors.body = "Message is required.";
  else if (body.length > LIMITS.body) errors.body = `Message must be at most ${LIMITS.body} characters.`;
  const link = validateLink(input.url, allowlist);
  if (link) errors.url = link;
  const image = validateImage(input.image_url);
  if (image) errors.image_url = image;
  const target = validateTarget(input.target_type, input.target_value);
  if (target) errors.target_value = target;
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** Schedule must be in the future and at most one year ahead. */
export function validateSchedule(when: Date | null, now: Date = new Date()): string | null {
  if (!when || Number.isNaN(when.getTime())) return "Pick a date and time.";
  if (when.getTime() < now.getTime() + 60_000) return "Scheduled time must be at least a minute in the future.";
  if (when.getTime() > now.getTime() + 366 * 24 * 3600 * 1000) return "Scheduled time must be within one year.";
  return null;
}

// ---------------------------------------------------------------- delivery options
export const MAX_TTL_SECONDS = 2_419_200; // 28 days, the FCM maximum
const KEY_RE = /^[a-zA-Z0-9_.~%-]{1,64}$/;
const LABEL_RE = /^[a-zA-Z0-9_.~%-]{1,50}$/;

export type Priority = "high" | "normal";

export interface DeliveryOptions {
  ttl_seconds: number | null;
  collapse_key: string | null;
  priority: Priority;
  analytics_label: string | null;
}

export const DEFAULT_DELIVERY: DeliveryOptions = { ttl_seconds: 259_200, collapse_key: null, priority: "high", analytics_label: null };

/** Expiry choices shown in the composer (null = FCM default, 4 weeks). */
export const TTL_PRESETS: { label: string; value: number | null }[] = [
  { label: "4 weeks (FCM default)", value: null },
  { label: "Only if online right now", value: 0 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21_600 },
  { label: "1 day", value: 86_400 },
  { label: "3 days", value: 259_200 },
  { label: "1 week", value: 604_800 },
];

export interface DeliveryErrors {
  collapse_key?: string;
  analytics_label?: string;
  ttl_seconds?: string;
}

export function validateDelivery(o: DeliveryOptions): DeliveryErrors {
  const e: DeliveryErrors = {};
  const t = o.ttl_seconds;
  if (t != null && (!Number.isInteger(t) || t < 0 || t > MAX_TTL_SECONDS)) e.ttl_seconds = "Expiry must be between 0 seconds and 28 days.";
  if (o.collapse_key && !KEY_RE.test(o.collapse_key)) e.collapse_key = "Letters, numbers and -_.~% only (max 64).";
  if (o.analytics_label && !LABEL_RE.test(o.analytics_label)) e.analytics_label = "Letters, numbers and -_.~% only (max 50).";
  return e;
}

/** Short human text like "expires in 1 hour · replace key score · normal priority". */
export function describeDelivery(o: Partial<DeliveryOptions>): string {
  const parts: string[] = [];
  if (o.ttl_seconds != null) {
    const p = TTL_PRESETS.find((x) => x.value === o.ttl_seconds);
    parts.push(o.ttl_seconds === 0 ? "only if online now" : `expires ${p ? `in ${p.label}` : `after ${o.ttl_seconds}s`}`);
  }
  if (o.collapse_key) parts.push(`replace key ${o.collapse_key}`);
  if (o.priority === "normal") parts.push("normal priority");
  if (o.analytics_label) parts.push(`label ${o.analytics_label}`);
  return parts.join(" · ");
}
