import type { AppInput, AppRec } from "./types";
import { FCM_PROJECT_RE, isValidTopic, normalizeDomain, parseHttpUrl, SECRET_NAME_RE, validateImage } from "./validate";

export interface AppsExport {
  version: 1;
  apps: AppInput[];
}

/** Exports app definitions only. secret_key is just the NAME of a function secret, never a key. */
export function exportApps(apps: AppRec[]): AppsExport {
  return {
    version: 1,
    apps: apps.map((a) => ({
      name: a.name,
      package_name: a.package_name,
      fcm_project_id: a.fcm_project_id,
      default_topic: a.default_topic,
      channel_id: a.channel_id,
      secret_key: a.secret_key,
      url_allowlist: a.url_allowlist,
      icon_url: a.icon_url,
      app_url: a.app_url,
    })),
  };
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;
}

/** Validates an imported file. Throws with a readable message on the first problem. */
export function parseAppsImport(text: string): AppInput[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const list = (data as { apps?: unknown } | null)?.apps;
  if (!Array.isArray(list) || list.length === 0) throw new Error("No apps found in the file.");
  if (list.length > 100) throw new Error("Too many apps (max 100).");

  return list.map((item, i): AppInput => {
    const o = (item ?? {}) as Record<string, unknown>;
    const where = `App #${i + 1}`;
    const name = str(o.name, 80);
    const pkg = str(o.package_name, 200);
    const project = str(o.fcm_project_id, 30);
    if (!name) throw new Error(`${where}: name is missing.`);
    if (!pkg) throw new Error(`${where}: package_name is missing.`);
    if (!project || !FCM_PROJECT_RE.test(project)) throw new Error(`${where}: fcm_project_id is invalid.`);
    const topic = str(o.default_topic, 255) ?? "all";
    if (!isValidTopic(topic)) throw new Error(`${where}: default_topic is invalid.`);
    const secret = o.secret_key == null || o.secret_key === "" ? null : String(o.secret_key);
    if (secret && !SECRET_NAME_RE.test(secret)) throw new Error(`${where}: secret_key must look like FCM_SERVICE_ACCOUNT_NAME.`);
    const allow = Array.isArray(o.url_allowlist) ? o.url_allowlist.filter((x): x is string => typeof x === "string") : [];
    const iconUrl = typeof o.icon_url === "string" && o.icon_url.trim() ? o.icon_url.trim() : null;
    if (iconUrl && validateImage(iconUrl)) throw new Error(`${where}: icon_url must be an https URL.`);
    const appUrl = typeof o.app_url === "string" && o.app_url.trim() ? o.app_url.trim() : null;
    if (appUrl && !parseHttpUrl(appUrl)) throw new Error(`${where}: app_url must be an http(s) URL.`);
    return {
      name,
      package_name: pkg,
      fcm_project_id: project,
      default_topic: topic,
      channel_id: str(o.channel_id, 100) ?? "app_updates_channel",
      secret_key: secret,
      url_allowlist: [...new Set(allow.map(normalizeDomain).filter(Boolean))],
      icon_url: iconUrl,
      app_url: appUrl,
    };
  });
}
