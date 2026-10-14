import type { DayStat } from "./types";

function dayKey(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Empty buckets for the last `days` local days, oldest first, ending today. */
export function lastDays(days: number, today: Date = new Date()): DayStat[] {
  const out: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push({ key: dayKey(d), label: d.toLocaleDateString([], { weekday: "short" }), sent: 0, failed: 0 });
  }
  return out;
}

export function bucketByDay(
  rows: { status: string; created_at: string }[],
  days: DayStat[],
): DayStat[] {
  const byKey = new Map(days.map((d) => [d.key, { ...d }]));
  for (const r of rows) {
    const b = byKey.get(dayKey(new Date(r.created_at)));
    if (!b) continue;
    if (r.status === "sent") b.sent++;
    else if (r.status === "failed") b.failed++;
  }
  return days.map((d) => byKey.get(d.key) ?? d);
}

export function successRate(sent: number, failed: number): number | null {
  const total = sent + failed;
  return total === 0 ? null : Math.round((sent / total) * 100);
}
