// Called every minute by pg_cron (via pg_net) with the internal x-cron-secret header.
import { isValidCronSecret } from "../_shared/auth.ts";
import { deliver } from "../_shared/deliver.ts";
import { json, serviceClient } from "../_shared/http.ts";
import { runDueRecurring } from "../_shared/recurring.ts";
import type { NotificationRow } from "../_shared/types.ts";

const BATCH_SIZE = 20;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  if (!isValidCronSecret(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
    return json(req, { error: "Forbidden." }, 403);
  }

  try {
    const db = serviceClient();
    // Atomic: due rows flip to 'sending' inside one SQL statement (FOR UPDATE SKIP LOCKED),
    // so overlapping runs can never send the same notification twice.
    const { data, error } = await db.rpc("claim_due_notifications", { p_limit: BATCH_SIZE });
    if (error) return json(req, { error: "Could not claim due notifications." }, 500);

    const rows = (data ?? []) as NotificationRow[];
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const result = await deliver(db, row);
      if (result.ok) sent++;
      else failed++;
    }
    // Recurring schedules that are due become normal notifications and are sent right away.
    const recurring = await runDueRecurring(db);
    return json(req, { claimed: rows.length, sent, failed, recurring });
  } catch (_e) {
    return json(req, { error: "Unexpected server error." }, 500);
  }
});
