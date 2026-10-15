import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildMessage, mapFcmError, parseServiceAccount, signJwt } from "./fcm.ts";
import { resolveServiceAccountJson } from "./deliver.ts";

Deno.test("buildMessage for topic with url and image", () => {
  const m = buildMessage({
    title: " T ",
    body: "B",
    url: "https://example.com",
    image_url: "https://cdn.example.com/i.png",
    target_type: "topic",
    target_value: "all",
    channel_id: "app_updates_channel",
  });
  assertEquals(m, {
    message: {
      topic: "all",
      notification: { title: "T", body: "B", image: "https://cdn.example.com/i.png" },
      data: { url: "https://example.com" },
      android: { priority: "HIGH", notification: { channel_id: "app_updates_channel" } },
    },
  });
});

Deno.test("buildMessage omits optional fields and maps targets", () => {
  const base = { title: "T", body: "B", channel_id: "c" };
  const c = buildMessage({ ...base, target_type: "condition", target_value: "'a' in topics" });
  assertEquals(c.message.condition, "'a' in topics");
  assertEquals("data" in c.message, false);
  assertEquals("image" in c.message.notification, false);
  const t = buildMessage({ ...base, target_type: "token", target_value: "tok" });
  assertEquals(t.message.token, "tok");
});

Deno.test("mapFcmError gives readable hints", () => {
  assertStringIncludes(mapFcmError(403, { error: { status: "PERMISSION_DENIED", message: "x" } }).hint, "Cloud Messaging API Admin");
  assertStringIncludes(
    mapFcmError(404, { error: { status: "NOT_FOUND", message: "x", details: [{ errorCode: "UNREGISTERED" }] } }).error,
    "UNREGISTERED",
  );
  assertStringIncludes(
    mapFcmError(403, { error: { message: "x", details: [{ errorCode: "SENDER_ID_MISMATCH" }] } }).hint,
    "different Firebase project",
  );
  assertStringIncludes(mapFcmError(400, { error: { status: "INVALID_ARGUMENT", message: "x" } }).hint, "rejected");
});

Deno.test("parseServiceAccount validates shape", () => {
  assertEquals(parseServiceAccount('{"client_email":"a@b","private_key":"k"}').client_email, "a@b");
  for (const bad of ["nope", "{}", '{"client_email":"a"}']) {
    let threw = false;
    try {
      parseServiceAccount(bad);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  }
});

Deno.test("signJwt produces a verifiable RS256 token", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----\n`;
  const jwt = await signJwt({ client_email: "sa@x.iam", private_key: pem }, 1000);
  const [h, c, s] = jwt.split(".");
  const claims = JSON.parse(atob(c.replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(claims.iss, "sa@x.iam");
  assertEquals(claims.exp, 4600);
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, sig, new TextEncoder().encode(`${h}.${c}`));
  assertEquals(ok, true);
});

Deno.test("resolveServiceAccountJson prefers valid override, else central", () => {
  const env = (n: string) => ({ FCM_SERVICE_ACCOUNT: "central", FCM_SERVICE_ACCOUNT_APP1: "own", SECRET: "x" } as Record<string, string>)[n];
  assertEquals(resolveServiceAccountJson("FCM_SERVICE_ACCOUNT_APP1", env), "own");
  assertEquals(resolveServiceAccountJson("FCM_SERVICE_ACCOUNT_MISSING", env), "central");
  assertEquals(resolveServiceAccountJson(null, env), "central");
  assertEquals(resolveServiceAccountJson("SECRET", env), "central"); // not an FCM_SERVICE_ACCOUNT_* name
});
