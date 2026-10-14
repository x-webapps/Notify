import { describe, expect, it } from "vitest";
import {
  effectiveAppUrl,
  hasErrors,
  playStoreUrl,
  hostAllowed,
  parseDomainList,
  validateFields,
  validateImage,
  validateLink,
  validateSchedule,
  validateTarget,
} from "./validate";

describe("validateLink", () => {
  it("accepts http(s) and empty", () => {
    expect(validateLink("")).toBeNull();
    expect(validateLink(null)).toBeNull();
    expect(validateLink("https://example.com/path?x=1")).toBeNull();
    expect(validateLink("http://example.com")).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "file:///etc/passwd",
    "intent://x#Intent;scheme=https;end",
    "market://details?id=a.b",
    "ftp://example.com",
    "https:example.com",
    "https://",
    "https://user:pw@example.com",
    "https://exa mple.com",
    "//example.com",
    "example.com",
  ])("rejects %s", (bad) => {
    expect(validateLink(bad)).not.toBeNull();
  });

  it("enforces the allow-list on host and subdomains only", () => {
    expect(hostAllowed("example.com", ["example.com"])).toBe(true);
    expect(hostAllowed("www.example.com", ["Example.com"])).toBe(true);
    expect(hostAllowed("evilexample.com", ["example.com"])).toBe(false);
    expect(hostAllowed("example.com.evil.io", ["example.com"])).toBe(false);
    expect(hostAllowed("any.io", [])).toBe(true);
    expect(validateLink("https://other.io", ["example.com"])).toMatch(/allowed domains/);
  });
});

describe("images, targets, domains", () => {
  it("image must be https", () => {
    expect(validateImage("https://cdn.example.com/a.png")).toBeNull();
    expect(validateImage("http://cdn.example.com/a.png")).not.toBeNull();
    expect(validateImage("")).toBeNull();
  });

  it("targets", () => {
    expect(validateTarget("topic", "all")).toBeNull();
    expect(validateTarget("topic", "a b")).not.toBeNull();
    expect(validateTarget("condition", "'news' in topics && 'pro' in topics")).toBeNull();
    expect(validateTarget("condition", "hello")).not.toBeNull();
    expect(validateTarget("token", "short")).not.toBeNull();
    expect(validateTarget("token", "a".repeat(60) + ":APA91b-_x")).toBeNull();
  });

  it("parses domain lists", () => {
    expect(parseDomainList("Example.com, *.foo.io\nexample.com/x")).toEqual(["example.com", "foo.io"]);
  });
});

describe("validateFields", () => {
  const ok = { title: "Hi", body: "Body", target_type: "topic" as const, target_value: "all" };

  it("passes a valid notification", () => {
    expect(hasErrors(validateFields(ok))).toBe(false);
  });

  it("enforces limits", () => {
    expect(validateFields({ ...ok, title: "x".repeat(66) }).title).toBeDefined();
    expect(validateFields({ ...ok, body: "x".repeat(241) }).body).toBeDefined();
    expect(validateFields({ ...ok, title: "  " }).title).toBeDefined();
    expect(validateFields({ ...ok, url: "javascript:alert(1)" }).url).toBeDefined();
  });
});

describe("validateSchedule", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  it("requires a future time within a year", () => {
    expect(validateSchedule(null, now)).not.toBeNull();
    expect(validateSchedule(new Date("2026-01-01T12:00:10Z"), now)).not.toBeNull();
    expect(validateSchedule(new Date("2026-01-01T13:00:00Z"), now)).toBeNull();
    expect(validateSchedule(new Date("2028-01-01T13:00:00Z"), now)).not.toBeNull();
  });
});

describe("app url auto-detect", () => {
  it("builds the Play Store link from the package name", () => {
    expect(playStoreUrl("com.jndapp.glass.widgets")).toBe("https://play.google.com/store/apps/details?id=com.jndapp.glass.widgets");
  });

  it("prefers a valid custom URL, otherwise falls back", () => {
    const base = { package_name: "com.a.b" };
    expect(effectiveAppUrl({ ...base, app_url: "https://example.com/app" })).toBe("https://example.com/app");
    expect(effectiveAppUrl({ ...base, app_url: null })).toContain("id=com.a.b");
    expect(effectiveAppUrl({ ...base, app_url: "javascript:alert(1)" })).toContain("play.google.com");
  });
});

describe("delivery options", () => {
  it("accepts defaults and presets", async () => {
    const { DEFAULT_DELIVERY, TTL_PRESETS, validateDelivery } = await import("./validate");
    expect(validateDelivery(DEFAULT_DELIVERY)).toEqual({});
    for (const p of TTL_PRESETS) expect(validateDelivery({ ...DEFAULT_DELIVERY, ttl_seconds: p.value })).toEqual({});
  });

  it("rejects bad values and describes the options", async () => {
    const { DEFAULT_DELIVERY, validateDelivery, describeDelivery } = await import("./validate");
    expect(validateDelivery({ ...DEFAULT_DELIVERY, ttl_seconds: -5 }).ttl_seconds).toBeDefined();
    expect(validateDelivery({ ...DEFAULT_DELIVERY, ttl_seconds: 3_000_000 }).ttl_seconds).toBeDefined();
    expect(validateDelivery({ ...DEFAULT_DELIVERY, collapse_key: "no spaces" }).collapse_key).toBeDefined();
    expect(validateDelivery({ ...DEFAULT_DELIVERY, analytics_label: "x".repeat(51) }).analytics_label).toBeDefined();
    expect(describeDelivery(DEFAULT_DELIVERY)).toBe("");
    expect(describeDelivery({ ttl_seconds: 3600, collapse_key: "score", priority: "normal" })).toBe("expires in 1 hour · replace key score · normal priority");
  });
});
