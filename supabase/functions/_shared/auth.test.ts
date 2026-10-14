import { assertEquals } from "jsr:@std/assert@1";
import { bearerToken, isAllowedAdmin, isValidCronSecret, safeEqual } from "./auth.ts";

const admins = ["Boss@Example.com"];

Deno.test("admin must be verified and listed (case-insensitive)", () => {
  assertEquals(isAllowedAdmin({ email: "boss@example.com", user_metadata: { email_verified: true } }, admins), true);
  assertEquals(isAllowedAdmin({ email: "boss@example.com", user_metadata: { email_verified: false } }, admins), false);
  assertEquals(isAllowedAdmin({ email: "boss@example.com", user_metadata: {} }, admins), false);
  assertEquals(isAllowedAdmin({ email: "other@example.com", user_metadata: { email_verified: true } }, admins), false);
  assertEquals(isAllowedAdmin(null, admins), false);
  assertEquals(isAllowedAdmin({ user_metadata: { email_verified: true } }, admins), false);
});

Deno.test("bearerToken parsing", () => {
  assertEquals(bearerToken("Bearer abc.def"), "abc.def");
  assertEquals(bearerToken("bearer abc"), "abc");
  assertEquals(bearerToken("Basic abc"), null);
  assertEquals(bearerToken(null), null);
});

Deno.test("cron secret comparison", () => {
  const secret = "x".repeat(32);
  assertEquals(isValidCronSecret(secret, secret), true);
  assertEquals(isValidCronSecret("y".repeat(32), secret), false);
  assertEquals(isValidCronSecret(null, secret), false);
  assertEquals(isValidCronSecret("short", "short"), false); // too-short secrets are refused
  assertEquals(isValidCronSecret(secret, undefined), false);
  assertEquals(safeEqual("a", "ab"), false);
});
