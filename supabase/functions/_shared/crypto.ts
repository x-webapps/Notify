// AES-256-GCM encryption for stored service-account keys. Never log plaintext or the key.
// The master key lives only in the CREDENTIAL_ENCRYPTION_KEY Edge Function secret (base64, 32 bytes).

const enc = new TextEncoder();
const dec = new TextDecoder();

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function importKey(masterKeyB64: string | undefined): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromB64((masterKeyB64 ?? "").trim());
  } catch {
    raw = new Uint8Array();
  }
  if (raw.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is missing or not a base64-encoded 32-byte key.");
  }
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `aad` (the app id) is authenticated, so a ciphertext copied to another app's row will not decrypt. */
export async function encryptText(plain: string, masterKeyB64: string | undefined, aad: string): Promise<string> {
  const key = await importKey(masterKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function decryptText(blob: string, masterKeyB64: string | undefined, aad: string): Promise<string> {
  const key = await importKey(masterKeyB64);
  const bytes = fromB64(blob);
  if (bytes.length < 13) throw new Error("Stored key is corrupt.");
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, ct));
  } catch {
    throw new Error("Could not decrypt the stored key. Was CREDENTIAL_ENCRYPTION_KEY changed? Upload the key again.");
  }
}
