import { describe, expect, it } from "vitest";
import { describeSchedule, validateSchedule, type Schedule } from "./recurring";

const base: Schedule = { frequency: "daily", time_of_day: "09:00", tz: "Asia/Kolkata", weekdays: [], day_of_month: null, ends_on: null };

describe("validateSchedule", () => {
  it("accepts a plain daily schedule", () => {
    expect(validateSchedule(base, "2026-10-22")).toEqual({});
  });

  it("needs days for weekly and a day for monthly", () => {
    expect(validateSchedule({ ...base, frequency: "weekly" }, "2026-10-22").weekdays).toBeTruthy();
    expect(validateSchedule({ ...base, frequency: "weekly", weekdays: [1, 3] }, "2026-10-22")).toEqual({});
    expect(validateSchedule({ ...base, frequency: "weekly", weekdays: [7] }, "2026-10-22").weekdays).toBeTruthy();
    expect(validateSchedule({ ...base, frequency: "monthly" }, "2026-10-22").day_of_month).toBeTruthy();
    expect(validateSchedule({ ...base, frequency: "monthly", day_of_month: 32 }, "2026-10-22").day_of_month).toBeTruthy();
    expect(validateSchedule({ ...base, frequency: "monthly", day_of_month: 31 }, "2026-10-22")).toEqual({});
  });

  it("checks the time and the end date", () => {
    expect(validateSchedule({ ...base, time_of_day: "" }, "2026-10-22").time_of_day).toBeTruthy();
    expect(validateSchedule({ ...base, time_of_day: "24:00" }, "2026-10-22").time_of_day).toBeTruthy();
    expect(validateSchedule({ ...base, ends_on: "2026-10-21" }, "2026-10-22").ends_on).toBeTruthy();
    expect(validateSchedule({ ...base, ends_on: "2026-10-22" }, "2026-10-22")).toEqual({});
  });
});

describe("describeSchedule", () => {
  it("reads naturally", () => {
    expect(describeSchedule(base)).toBe("Every day at 09:00 (Asia/Kolkata)");
    expect(describeSchedule({ ...base, frequency: "weekly", weekdays: [3, 1], time_of_day: "18:30", tz: "UTC" })).toBe("Every Mon, Wed at 18:30 (UTC)");
    expect(describeSchedule({ ...base, frequency: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe("Every day at 09:00 (Asia/Kolkata)");
    expect(describeSchedule({ ...base, frequency: "monthly", day_of_month: 22 })).toBe("On the 22nd of every month at 09:00 (Asia/Kolkata)");
    expect(describeSchedule({ ...base, frequency: "monthly", day_of_month: 31, ends_on: "2027-01-01" }))
      .toBe("On the 31st of every month (shorter months: last day) at 09:00 (Asia/Kolkata) · until 2027-01-01");
    expect(describeSchedule({ ...base, frequency: "monthly", day_of_month: 11 })).toContain("11th");
  });
});
