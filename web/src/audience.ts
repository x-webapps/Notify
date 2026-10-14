import type { AudienceKind } from "./types";

/** Max topics FCM accepts in one condition. */
export const MAX_TOPICS_IN_CONDITION = 5;

const clean = (s: string): string => s.trim().replace(/[^a-zA-Z0-9_.~%-]+/g, "_").replace(/^_+|_+$/g, "");

/** The topic name the Android app must subscribe to for a given audience. */
export function topicName(kind: AudienceKind, value: string): string {
  const v = clean(value);
  if (!v) return "";
  switch (kind) {
    case "version": return `v_${v}`;
    case "country": return `country_${v.toUpperCase()}`;
    case "language": return `lang_${v.toLowerCase()}`;
    case "timezone": return `tz_${clean(value.replace(/\//g, "_"))}`;
    default: return v;
  }
}

export interface BuiltTarget {
  type: "topic" | "condition";
  value: string;
}

/** AND ("all") or OR ("any") of saved topics, as an FCM target. */
export function buildAudienceTarget(names: string[], mode: "all" | "any"): BuiltTarget | null {
  const unique = [...new Set(names)];
  if (unique.length === 0) return null;
  const only = unique[0];
  if (unique.length === 1 && only) return { type: "topic", value: only };
  const op = mode === "all" ? " && " : " || ";
  return { type: "condition", value: unique.map((n) => `'${n}' in topics`).join(op) };
}

/** Draft storage format for the audience builder: "all:a,b" or "any:a,b". */
export function encodeAudience(names: string[], mode: "all" | "any"): string {
  return `${mode}:${names.join(",")}`;
}

export function decodeAudience(value: string): { names: string[]; mode: "all" | "any" } {
  const [m = "all", rest = ""] = value.split(":", 2);
  return { mode: m === "any" ? "any" : "all", names: rest.split(",").filter(Boolean) };
}

export const KOTLIN_SNIPPET = `// Call once on launch (e.g. in Application.onCreate), after FirebaseApp is ready.
val fcm = FirebaseMessaging.getInstance()
fun topic(s: String) = s.replace(Regex("[^a-zA-Z0-9_.~%-]"), "_")

fcm.subscribeToTopic("all")
fcm.subscribeToTopic("v_" + BuildConfig.VERSION_CODE)
fcm.subscribeToTopic("country_" + java.util.Locale.getDefault().country.uppercase())
fcm.subscribeToTopic("lang_" + java.util.Locale.getDefault().language.lowercase())
fcm.subscribeToTopic("tz_" + topic(java.util.TimeZone.getDefault().id))`;
