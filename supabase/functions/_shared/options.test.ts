import { assertEquals } from "jsr:@std/assert@1";
import { buildMessage } from "./fcm.ts";
import { defaultAnalyticsLabel, validateDelivery, validateNotification } from "./validate.ts";

const base = { title: "T", body: "B", target_type: "topic" as const, target_value: "all", channel_id: "c" };

Deno.test("buildMessage maps expiry, replace key, priority and analytics label", () => {
  const m = buildMessage({ ...base, ttl_seconds: 3600, collapse_key: "score", priority: "normal", analytics_label: "push_20261014" });
  assertEquals(m.message.android, {
    priority: "NORMAL",
    ttl: "3600s",
    collapse_key: "score",
    notification: { channel_id: "c", tag: "score" },
  });
  assertEquals(m.message.fcm_options, { analytics_label: "push_20261014" });
});

Deno.test("buildMessage defaults: high priority, no ttl, no collapse key, no label", () => {
  const m = buildMessage(base);
  assertEquals(m.message.android, { priority: "HIGH", notification: { channel_id: "c" } });
  assertEquals("fcm_options" in m.message, false);
});

Deno.test("a ttl of 0 is kept (deliver now or never)", () => {
  assertEquals(buildMessage({ ...base, ttl_seconds: 0 }).message.android.ttl, "0s");
});

Deno.test("validateDelivery", () => {
  assertEquals(validateDelivery({}), []);
  assertEquals(validateDelivery({ ttl_seconds: 0, collapse_key: "a_b-1", priority: "normal", analytics_label: "x" }), []);
  assertEquals(validateDelivery({ ttl_seconds: -1 }).length, 1);
  assertEquals(validateDelivery({ ttl_seconds: 2_419_201 }).length, 1);
  assertEquals(validateDelivery({ ttl_seconds: 1.5 }).length, 1);
  assertEquals(validateDelivery({ collapse_key: "has space" }).length, 1);
  assertEquals(validateDelivery({ analytics_label: "x".repeat(51) }).length, 1);
});

Deno.test("validateNotification includes delivery options", () => {
  const ok = { title: "T", body: "B", target_type: "topic" as const, target_value: "all" };
  assertEquals(validateNotification(ok), []);
  assertEquals(validateNotification({ ...ok, collapse_key: "bad key" }).length, 1);
});

Deno.test("default analytics label is one per UTC day", () => {
  assertEquals(defaultAnalyticsLabel(new Date("2026-10-14T23:59:00Z")), "push_20261014");
});
