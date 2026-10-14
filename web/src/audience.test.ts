import { describe, expect, it } from "vitest";
import { buildAudienceTarget, decodeAudience, encodeAudience, topicName } from "./audience";
import { bucketByDay, lastDays, successRate } from "./stats";
import { validateTarget } from "./validate";

describe("topicName", () => {
  it("builds the names the Android app subscribes to", () => {
    expect(topicName("version", "42")).toBe("v_42");
    expect(topicName("country", "in")).toBe("country_IN");
    expect(topicName("timezone", "Asia/Kolkata")).toBe("tz_Asia_Kolkata");
    expect(topicName("custom", "beta users")).toBe("beta_users");
    expect(topicName("custom", "  ")).toBe("");
  });
});

describe("buildAudienceTarget", () => {
  it("returns null for nothing, a topic for one, a condition for many", () => {
    expect(buildAudienceTarget([], "all")).toBeNull();
    expect(buildAudienceTarget(["a"], "all")).toEqual({ type: "topic", value: "a" });
    const and = buildAudienceTarget(["a", "b"], "all");
    expect(and).toEqual({ type: "condition", value: "'a' in topics && 'b' in topics" });
    expect(buildAudienceTarget(["a", "b", "a"], "any")?.value).toBe("'a' in topics || 'b' in topics");
  });

  it("produces conditions the validator accepts", () => {
    const t = buildAudienceTarget(["country_IN", "v_42"], "all");
    expect(t && validateTarget(t.type, t.value)).toBeNull();
  });

  it("round-trips the draft encoding", () => {
    expect(decodeAudience(encodeAudience(["a", "b"], "any"))).toEqual({ names: ["a", "b"], mode: "any" });
    expect(decodeAudience("")).toEqual({ names: [], mode: "all" });
  });
});

describe("stats", () => {
  it("buckets by local day and computes success rate", () => {
    const today = new Date(2026, 9, 14, 12);
    const days = lastDays(7, today);
    expect(days).toHaveLength(7);
    expect(days[6]?.key).toBe("2026-10-14");
    const rows = [
      { status: "sent", created_at: new Date(2026, 9, 14, 9).toISOString() },
      { status: "failed", created_at: new Date(2026, 9, 14, 10).toISOString() },
      { status: "sent", created_at: new Date(2026, 9, 12, 10).toISOString() },
      { status: "sent", created_at: new Date(2026, 8, 1).toISOString() },
    ];
    const out = bucketByDay(rows, days);
    expect(out[6]).toMatchObject({ sent: 1, failed: 1 });
    expect(out[4]).toMatchObject({ sent: 1, failed: 0 });
    expect(successRate(3, 1)).toBe(75);
    expect(successRate(0, 0)).toBeNull();
  });
});
