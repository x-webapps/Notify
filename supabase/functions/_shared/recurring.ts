// Turns due recurring schedules into normal notification rows and sends them.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { deliver } from "./deliver.ts";
import type { NotificationRow } from "./types.ts";

export interface RecurringRow {
  id: string;
  app_id: string;
  title: string;
  body: string;
  url: string | null;
  image_url: string | null;
  target_type: "topic" | "condition";
  target_value: string;
  tz: string;
  ttl_seconds: number | null;
  collapse_key: string | null;
  priority: "high" | "normal";
  analytics_label: string | null;
}

/** claim_due_recurring has already moved each schedule to its next run, so a crash here loses at most this run. */
export async function runDueRecurring(db: SupabaseClient, limit = 20): Promise<{ claimed: number; sent: number; failed: number }> {
  const { data, error } = await db.rpc("claim_due_recurring", { p_limit: limit });
  if (error) throw new Error("Could not claim due recurring sends.");
  const due = (data ?? []) as RecurringRow[];
  let sent = 0;
  let failed = 0;
  for (const r of due) {
    const { data: row, error: insertError } = await db.from("notifications").insert({
      app_id: r.app_id,
      title: r.title,
      body: r.body,
      url: r.url,
      image_url: r.image_url,
      target_type: r.target_type,
      target_value: r.target_value,
      tz: r.tz,
      ttl_seconds: r.ttl_seconds,
      collapse_key: r.collapse_key,
      priority: r.priority,
      analytics_label: r.analytics_label,
      status: "sending",
      claimed_at: new Date().toISOString(),
      created_by: "recurring",
      recurring_id: r.id,
    }).select().single<NotificationRow>();
    if (insertError || !row) {
      failed++;
      continue;
    }
    const result = await deliver(db, row);
    if (result.ok) sent++;
    else failed++;
  }
  return { claimed: due.length, sent, failed };
}
