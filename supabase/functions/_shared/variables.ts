// Template variables, resolved at send time so scheduled/recurring sends get the right date.
// NOTE: web/src/variables.ts mirrors this file. Keep both in sync.

export const VARIABLES = ["{app_name}", "{date}", "{time}", "{day}"] as const;

export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function renderVariables(text: string, ctx: { appName: string; now: Date; tz?: string | null }): string {
  const timeZone = safeTimeZone(ctx.tz);
  const fmt = (opts: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(ctx.now);
  const values: Record<string, string> = {
    app_name: ctx.appName,
    date: fmt({ day: "numeric", month: "short", year: "numeric" }),
    time: fmt({ hour: "numeric", minute: "2-digit" }),
    day: fmt({ weekday: "long" }),
  };
  // Unknown placeholders are left untouched.
  return text.replace(/\{(app_name|date|time|day)\}/g, (_, key: string) => values[key] ?? "");
}
