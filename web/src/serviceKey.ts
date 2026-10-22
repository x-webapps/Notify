// Reads a downloaded Firebase service-account file in the browser, only to give instant feedback and
// to fill in the project ID. The server validates again and is the only place the key is stored.

import { FCM_PROJECT_RE } from "./validate";

export const KEY_MAX_BYTES = 20_000;

export interface KeyInfo {
  projectId: string;
  email: string;
}

/** Returns the non-secret details of a service-account file. Throws a readable message if it is not one. */
export function readServiceKey(text: string): KeyInfo {
  if (text.length > KEY_MAX_BYTES) throw new Error("That file is too large to be a service account key.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const o = (data ?? {}) as Record<string, unknown>;
  if (o.type !== "service_account") {
    throw new Error("This is not a service account key. In Firebase: Project settings → Service accounts → Generate new private key.");
  }
  if (typeof o.project_id !== "string" || !FCM_PROJECT_RE.test(o.project_id)) throw new Error("The key has no usable project_id.");
  if (typeof o.client_email !== "string" || !o.client_email.includes("@")) throw new Error("The key has no client_email.");
  if (typeof o.private_key !== "string" || !o.private_key.includes("BEGIN PRIVATE KEY")) throw new Error("The key has no private_key.");
  return { projectId: o.project_id, email: o.client_email };
}
