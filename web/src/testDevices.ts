// A short, named list of test devices per app. Kept in this browser only (localStorage), never on the server.

import { validateTarget } from "./validate";

export interface TestDevice {
  name: string;
  token: string;
}

export interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const MAX_DEVICES = 10;
const NAME_MAX = 30;
const listKey = (appId: string): string => `testDevices:${appId}`;
const legacyKey = (appId: string): string => `testToken:${appId}`; // the single token field used before this list

function clean(raw: unknown): TestDevice[] {
  if (!Array.isArray(raw)) return [];
  const out: TestDevice[] = [];
  for (const d of raw) {
    const o = (d ?? {}) as Record<string, unknown>;
    if (typeof o.name === "string" && typeof o.token === "string" && o.name.trim() && o.token.trim()) {
      out.push({ name: o.name.trim().slice(0, NAME_MAX), token: o.token.trim() });
    }
  }
  return out.slice(0, MAX_DEVICES);
}

/** Never throws: storage can be blocked (private window), in which case the list is simply empty. */
export function loadDevices(store: StoreLike | undefined, appId: string): TestDevice[] {
  try {
    const raw = store?.getItem(listKey(appId));
    if (raw) return clean(JSON.parse(raw));
    const legacy = store?.getItem(legacyKey(appId))?.trim();
    return legacy ? [{ name: "My device", token: legacy }] : [];
  } catch {
    return [];
  }
}

export function saveDevices(store: StoreLike | undefined, appId: string, devices: TestDevice[]): void {
  try {
    if (devices.length === 0) store?.removeItem(listKey(appId));
    else store?.setItem(listKey(appId), JSON.stringify(devices));
    store?.removeItem(legacyKey(appId)); // migrated into the list
  } catch { /* storage unavailable: the list just is not remembered */ }
}

/** Adds a device, or replaces the one with the same name. */
export function upsertDevice(list: TestDevice[], name: string, token: string): { list: TestDevice[]; error?: string } {
  const n = name.trim();
  const t = token.trim();
  if (!n) return { list, error: "Give the device a name, for example “My phone”." };
  if (n.length > NAME_MAX) return { list, error: `The name can be at most ${NAME_MAX} characters.` };
  const tokenError = validateTarget("token", t);
  if (tokenError) return { list, error: tokenError };
  const i = list.findIndex((d) => d.name.toLowerCase() === n.toLowerCase());
  if (i === -1 && list.length >= MAX_DEVICES) return { list, error: `You can save up to ${MAX_DEVICES} devices. Remove one first.` };
  const next = [...list];
  if (i === -1) next.push({ name: n, token: t });
  else next[i] = { name: next[i]!.name, token: t };
  return { list: next };
}

export function removeDevice(list: TestDevice[], name: string): TestDevice[] {
  return list.filter((d) => d.name.toLowerCase() !== name.trim().toLowerCase());
}
