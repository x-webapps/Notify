// Device-local-time sends: one scheduled send per UTC offset, each at the same wall-clock time.
// Devices subscribe to a topic for their current offset (see PushTopics.kt), e.g. utc_p0530.

/** Every UTC offset in use today, in minutes. */
export const OFFSETS_MIN: readonly number[] = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60,
  0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840,
];

/** Topic a device subscribes to for its offset: 330 -> utc_p0530, -210 -> utc_m0330. */
export function offsetTopic(min: number): string {
  const sign = min < 0 ? "m" : "p";
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `utc_${sign}${hh}${mm}`;
}

/** "UTC+05:30" */
export function offsetLabel(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** The real instant when the wall clock at `offsetMin` shows `date` `time`. */
export function instantFor(date: string, time: string, offsetMin: number): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if (!y || !mo || !d || h === undefined || mi === undefined) return new Date(NaN);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - offsetMin * 60_000);
}

function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (mo ?? 1) - 1, (d ?? 1) + days));
  return t.toISOString().slice(0, 10);
}

export type PastPolicy = "skip" | "next_day";

export interface PlannedSend {
  offsetMin: number;
  topic: string;
  at: Date;
  /** True when the time had already passed here and was moved to the next day. */
  rolled: boolean;
}

export interface LocalPlan {
  sends: PlannedSend[];
  skipped: number[];
}

const MIN_LEAD_MS = 60_000;
const MAX_AHEAD_MS = 366 * 24 * 3600 * 1000;

/** Works out one send per offset. Offsets whose local time already passed are skipped or moved a day. */
export function planLocalSends(
  date: string,
  time: string,
  policy: PastPolicy,
  now: Date = new Date(),
  offsets: readonly number[] = OFFSETS_MIN,
): LocalPlan {
  const sends: PlannedSend[] = [];
  const skipped: number[] = [];
  for (const offsetMin of offsets) {
    let at = instantFor(date, time, offsetMin);
    let rolled = false;
    if (Number.isNaN(at.getTime())) continue;
    if (at.getTime() < now.getTime() + MIN_LEAD_MS) {
      if (policy === "skip") {
        skipped.push(offsetMin);
        continue;
      }
      at = instantFor(addDays(date, 1), time, offsetMin);
      rolled = true;
      if (at.getTime() < now.getTime() + MIN_LEAD_MS) {
        skipped.push(offsetMin);
        continue;
      }
    }
    if (at.getTime() > now.getTime() + MAX_AHEAD_MS) {
      skipped.push(offsetMin);
      continue;
    }
    sends.push({ offsetMin, topic: offsetTopic(offsetMin), at, rolled });
  }
  sends.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { sends, skipped };
}

export function countTopics(condition: string): number {
  return (condition.match(/in topics/g) ?? []).length;
}

/** FCM allows at most five topics in one condition. */
export const MAX_TOPICS = 5;

export interface BaseTarget {
  type: "topic" | "condition";
  value: string;
  /** True for the app's default (everyone) topic: the offset topic alone is then enough. */
  isDefault: boolean;
}

/** Narrows the admin's chosen audience to one UTC offset. Returns null when it would exceed FCM's limits. */
export function targetForOffset(base: BaseTarget, offsetMin: number): { type: "topic" | "condition"; value: string } | null {
  const off = offsetTopic(offsetMin);
  if (base.isDefault) return { type: "topic", value: off };
  const baseCount = base.type === "topic" ? 1 : countTopics(base.value);
  if (baseCount + 1 > MAX_TOPICS) return null;
  const left = base.type === "topic" ? `'${base.value}' in topics` : `(${base.value})`;
  return { type: "condition", value: `${left} && '${off}' in topics` };
}
