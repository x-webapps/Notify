// Recurring sends: validation and wording. The server (SQL) owns the actual "next run" calculation.

export type Frequency = "daily" | "weekly" | "monthly";

export interface Schedule {
  frequency: Frequency;
  time_of_day: string; // HH:MM
  tz: string;
  weekdays: number[]; // 0 = Sunday .. 6 = Saturday (weekly)
  day_of_month: number | null; // monthly
  ends_on: string | null; // YYYY-MM-DD
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** Monday first in the picker. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ScheduleErrors {
  time_of_day?: string;
  weekdays?: string;
  day_of_month?: string;
  ends_on?: string;
}

/** `today` is the local date as YYYY-MM-DD (injectable for tests). */
export function validateSchedule(s: Schedule, today: string): ScheduleErrors {
  const e: ScheduleErrors = {};
  if (!TIME_RE.test(s.time_of_day)) e.time_of_day = "Pick a time.";
  if (s.frequency === "weekly") {
    const ok = s.weekdays.length >= 1 && s.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!ok) e.weekdays = "Pick at least one day.";
  }
  if (s.frequency === "monthly") {
    const d = s.day_of_month;
    if (d === null || !Number.isInteger(d) || d < 1 || d > 31) e.day_of_month = "Pick a day between 1 and 31.";
  }
  if (s.ends_on) {
    if (!DATE_RE.test(s.ends_on)) e.ends_on = "Use a valid date.";
    else if (s.ends_on < today) e.ends_on = "The end date is in the past.";
  }
  return e;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** "Every day at 09:00 (Asia/Kolkata)", "Every Mon, Wed at 18:30 (UTC)", "On the 15th of every month at 09:00 (…)". */
export function describeSchedule(s: Schedule): string {
  let when: string;
  if (s.frequency === "daily") when = "Every day";
  else if (s.frequency === "weekly") {
    const days = WEEKDAY_ORDER.filter((d) => s.weekdays.includes(d)).map((d) => WEEKDAY_LABELS[d]);
    when = days.length === 7 ? "Every day" : `Every ${days.join(", ")}`;
  } else {
    const d = s.day_of_month ?? 1;
    when = `On the ${ordinal(d)} of every month${d > 28 ? " (shorter months: last day)" : ""}`;
  }
  return `${when} at ${s.time_of_day} (${s.tz})${s.ends_on ? ` · until ${s.ends_on}` : ""}`;
}
