import { assertEquals } from "jsr:@std/assert@1";
import {
  hostAllowed,
  isValidSecretName,
  validateImage,
  validateLink,
  validateNotification,
  validateTarget,
} from "./validate.ts";

Deno.test("validateLink accepts http(s) and empty", () => {
  assertEquals(validateLink(""), null);
  assertEquals(validateLink(undefined), null);
  assertEquals(validateLink("https://example.com/a?b=1"), null);
  assertEquals(validateLink("http://example.com"), null);
});

Deno.test("validateLink rejects dangerous or malformed links", () => {
  for (
    const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "intent://x#Intent;scheme=https;end",
      "ftp://example.com",
      "https:example.com",
      "https://",
      "https://user:pw@example.com",
      "https://exa mple.com",
      "//example.com",
      "example.com",
    ]
  ) {
    assertEquals(validateLink(bad) !== null, true, bad);
  }
});

Deno.test("allow-list matches host and subdomains only", () => {
  assertEquals(hostAllowed("example.com", ["example.com"]), true);
  assertEquals(hostAllowed("www.example.com", ["example.com"]), true);
  assertEquals(hostAllowed("evilexample.com", ["example.com"]), false);
  assertEquals(hostAllowed("example.com.evil.io", ["example.com"]), false);
  assertEquals(hostAllowed("anything.io", []), true);
  assertEquals(validateLink("https://other.io", ["example.com"]) !== null, true);
});

Deno.test("image must be https", () => {
  assertEquals(validateImage("https://cdn.example.com/a.png"), null);
  assertEquals(validateImage("http://cdn.example.com/a.png") !== null, true);
  assertEquals(validateImage(""), null);
});

Deno.test("targets", () => {
  assertEquals(validateTarget("topic", "all"), null);
  assertEquals(validateTarget("topic", "a b") !== null, true);
  assertEquals(validateTarget("condition", "'news' in topics && 'pro' in topics"), null);
  assertEquals(validateTarget("condition", "just text") !== null, true);
  assertEquals(validateTarget("token", "short") !== null, true);
  assertEquals(validateTarget("token", "a".repeat(60) + ":APA91b-_x"), null);
});

Deno.test("validateNotification enforces limits", () => {
  const base = { title: "Hi", body: "There", target_type: "topic" as const, target_value: "all" };
  assertEquals(validateNotification(base), []);
  assertEquals(validateNotification({ ...base, title: "x".repeat(66) }).length, 1);
  assertEquals(validateNotification({ ...base, body: "x".repeat(241) }).length, 1);
  assertEquals(validateNotification({ ...base, title: " " }).length, 1);
});

Deno.test("secret names are restricted", () => {
  assertEquals(isValidSecretName("FCM_SERVICE_ACCOUNT_GLASSWIDGETS"), true);
  assertEquals(isValidSecretName("SUPABASE_SERVICE_ROLE_KEY"), false);
  assertEquals(isValidSecretName("FCM_SERVICE_ACCOUNT"), false);
});
