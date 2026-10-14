import { assertEquals } from "jsr:@std/assert@1";
import { renderVariables, safeTimeZone } from "./variables.ts";

const now = new Date("2026-10-14T20:30:00Z"); // 02:00 next day in Asia/Kolkata

Deno.test("variables resolve in the given time zone", () => {
  assertEquals(renderVariables("{app_name} on {date}", { appName: "Glass", now, tz: "UTC" }), "Glass on Oct 14, 2026");
  assertEquals(renderVariables("{day} {time}", { appName: "x", now, tz: "Asia/Kolkata" }), "Thursday 2:00 AM");
});

Deno.test("unknown placeholders stay and bad time zones fall back to UTC", () => {
  assertEquals(renderVariables("{nope} {app_name}", { appName: "A", now }), "{nope} A");
  assertEquals(safeTimeZone("Not/AZone"), "UTC");
  assertEquals(safeTimeZone(null), "UTC");
});
