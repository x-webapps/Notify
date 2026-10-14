import { describe, expect, it } from "vitest";
import {
  instantFor,
  offsetLabel,
  offsetTopic,
  OFFSETS_MIN,
  planLocalSends,
  targetForOffset,
} from "./localtime";
import { validateTarget } from "./validate";

describe("offset topics", () => {
  it("names topics the Android app can compute", () => {
    expect(offsetTopic(330)).toBe("utc_p0530");
    expect(offsetTopic(-210)).toBe("utc_m0330");
    expect(offsetTopic(0)).toBe("utc_p0000");
    expect(offsetTopic(765)).toBe("utc_p1245");
    expect(offsetLabel(330)).toBe("UTC+05:30");
    expect(offsetLabel(-480)).toBe("UTC-08:00");
  });

  it("produces valid FCM topic names", () => {
    for (const m of OFFSETS_MIN) expect(validateTarget("topic", offsetTopic(m))).toBeNull();
  });
});

describe("instantFor", () => {
  it("converts local wall time to the real instant", () => {
    expect(instantFor("2026-10-20", "09:00", 330).toISOString()).toBe("2026-10-20T03:30:00.000Z");
    expect(instantFor("2026-10-20", "09:00", -480).toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(instantFor("2026-10-20", "00:30", 600).toISOString()).toBe("2026-10-19T14:30:00.000Z");
  });
});

describe("planLocalSends", () => {
  // 2026-10-20 06:00 UTC: 09:00 has already passed east of about UTC-3, and not yet west of it.
  const now = new Date("2026-10-20T06:00:00Z");

  it("skips offsets whose local time has passed", () => {
    const { sends, skipped } = planLocalSends("2026-10-20", "09:00", "skip", now);
    expect(sends.length + skipped.length).toBe(OFFSETS_MIN.length);
    expect(skipped).toContain(330); // 03:30 UTC is before 06:00
    expect(sends.map((s) => s.offsetMin)).toContain(-480);
    expect(sends.every((s) => s.at.getTime() > now.getTime())).toBe(true);
  });

  it("can roll those offsets to the next day instead", () => {
    const { sends, skipped } = planLocalSends("2026-10-20", "09:00", "next_day", now);
    expect(skipped).toHaveLength(0);
    const india = sends.find((s) => s.offsetMin === 330);
    expect(india?.rolled).toBe(true);
    expect(india?.at.toISOString()).toBe("2026-10-21T03:30:00.000Z");
  });

  it("sorts by send time and rejects dates more than a year away", () => {
    const { sends } = planLocalSends("2026-10-21", "09:00", "skip", now);
    const times = sends.map((s) => s.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(planLocalSends("2030-01-01", "09:00", "skip", now).sends).toHaveLength(0);
  });
});

describe("targetForOffset", () => {
  it("uses just the offset topic for the default audience", () => {
    expect(targetForOffset({ type: "topic", value: "all", isDefault: true }, 330)).toEqual({ type: "topic", value: "utc_p0530" });
  });

  it("narrows a custom topic or an audience condition", () => {
    expect(targetForOffset({ type: "topic", value: "beta", isDefault: false }, 330)?.value).toBe("'beta' in topics && 'utc_p0530' in topics");
    const t = targetForOffset({ type: "condition", value: "'a' in topics || 'b' in topics", isDefault: false }, -60);
    expect(t?.value).toBe("('a' in topics || 'b' in topics) && 'utc_m0100' in topics");
    expect(t && validateTarget(t.type, t.value)).toBeNull();
  });

  it("refuses combinations over FCM's 5-topic limit", () => {
    const four = "'a' in topics && 'b' in topics && 'c' in topics && 'd' in topics";
    expect(targetForOffset({ type: "condition", value: four, isDefault: false }, 0)).not.toBeNull();
    expect(targetForOffset({ type: "condition", value: `${four} && 'e' in topics`, isDefault: false }, 0)).toBeNull();
  });
});
