import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { decryptText, encryptText } from "./crypto.ts";
import { parseUploadedKey } from "./credentials.ts";

const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));

const good = {
  type: "service_account",
  project_id: "my-app-12345",
  client_email: "firebase-adminsdk-abc@my-app-12345.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
};

Deno.test("parseUploadedKey accepts a Firebase key file", () => {
  const k = parseUploadedKey(JSON.stringify({ ...good, extra: "ignored" }));
  assertEquals(k.project_id, "my-app-12345");
  assertEquals(k.client_email, good.client_email);
  assertEquals("extra" in k, false);
});

Deno.test("parseUploadedKey rejects bad files", () => {
  const bad = [
    "nope",
    "null",
    JSON.stringify({ ...good, type: "authorized_user" }),
    JSON.stringify({ ...good, project_id: "Bad_ID" }),
    JSON.stringify({ ...good, client_email: "a@example.com" }),
    JSON.stringify({ ...good, private_key: "secret" }),
    JSON.stringify({ ...good, padding: "x".repeat(21_000) }),
  ];
  for (const text of bad) assertThrows(() => parseUploadedKey(text));
});

Deno.test("encryptText round-trips and is bound to the app id", async () => {
  const blob = await encryptText("hello", KEY_B64, "app-1");
  assertEquals(await decryptText(blob, KEY_B64, "app-1"), "hello");
  await assertRejects(() => decryptText(blob, KEY_B64, "app-2"));
  assertEquals(blob === (await encryptText("hello", KEY_B64, "app-1")), false); // fresh IV each time
});

Deno.test("encryptText refuses a missing or short master key", async () => {
  await assertRejects(() => encryptText("x", undefined, "a"));
  await assertRejects(() => encryptText("x", btoa("short"), "a"));
});
