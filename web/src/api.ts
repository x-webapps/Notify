import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { bucketByDay, lastDays } from "./stats";
import type {
  AppInput,
  AudienceKind,
  AudienceTopic,
  DashboardData,
  DraftInput,
  DraftRec,
  AppRec,
  NotificationRec,
  SendResult,
  TargetType,
  TemplateInput,
  TemplateRec,
} from "./types";

export const PAGE_SIZE = 20;

export class ApiError extends Error {}

function fail(error: { message: string } | null): never {
  throw new ApiError(error?.message ?? "Unknown error");
}

// ------------------------------------------------------------------ apps
export async function listApps(): Promise<AppRec[]> {
  const { data, error } = await supabase.from("apps").select("*").order("name");
  if (error) fail(error);
  return (data ?? []) as AppRec[];
}

export async function getApp(id: string): Promise<AppRec> {
  const { data, error } = await supabase.from("apps").select("*").eq("id", id).maybeSingle();
  if (error) fail(error);
  if (!data) throw new ApiError("App not found.");
  return data as AppRec;
}

export async function createApp(input: AppInput): Promise<AppRec> {
  const { data, error } = await supabase.from("apps").insert(input).select().single();
  if (error) fail(error);
  return data as AppRec;
}

export async function updateApp(id: string, input: AppInput): Promise<void> {
  const { error } = await supabase.from("apps").update(input).eq("id", id);
  if (error) fail(error);
}

export async function deleteApp(id: string): Promise<void> {
  const { error } = await supabase.from("apps").delete().eq("id", id);
  if (error) fail(error);
}

/** Upsert by package name (used by JSON import). Returns how many rows were written. */
export async function importApps(inputs: AppInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const { error } = await supabase.from("apps").upsert(inputs, { onConflict: "package_name" });
  if (error) fail(error);
  return inputs.length;
}

export async function lastNotification(appId: string): Promise<NotificationRec | null> {
  const { data, error } = await supabase.from("notifications").select("*").eq("app_id", appId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) fail(error);
  return (data as NotificationRec | null) ?? null;
}

// ------------------------------------------------------------------ notifications
export interface Page<T> {
  rows: T[];
  total: number;
}

export async function listNotifications(appId: string, page: number, search: string): Promise<Page<NotificationRec>> {
  const from = page * PAGE_SIZE;
  let q = supabase.from("notifications").select("*", { count: "exact" }).eq("app_id", appId);
  // Strip characters that have meaning inside a PostgREST filter expression.
  const term = search.replace(/[,()%*\\:]/g, " ").trim();
  if (term) q = q.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
  const { data, error, count } = await q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (error) fail(error);
  return { rows: (data ?? []) as NotificationRec[], total: count ?? 0 };
}

export async function getNotification(id: string): Promise<NotificationRec> {
  const { data, error } = await supabase.from("notifications").select("*").eq("id", id).maybeSingle();
  if (error) fail(error);
  if (!data) throw new ApiError("Notification not found.");
  return data as NotificationRec;
}

export interface ComposePayload {
  app_id: string;
  title: string;
  body: string;
  url: string | null;
  image_url: string | null;
  target_type: TargetType;
  target_value: string;
  tz: string;
  ttl_seconds: number | null;
  collapse_key: string | null;
  priority: "high" | "normal";
  analytics_label: string | null;
}

export async function scheduleNotification(p: ComposePayload, when: Date, createdBy: string): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    ...p,
    status: "scheduled",
    scheduled_at: when.toISOString(),
    created_by: createdBy,
  });
  if (error) fail(error);
}

export async function cancelNotification(id: string): Promise<void> {
  const { data, error } = await supabase.from("notifications").update({ status: "cancelled" })
    .eq("id", id).eq("status", "scheduled").select("id");
  if (error) fail(error);
  if (!data || data.length === 0) throw new ApiError("It was already sent or is being sent, so it can't be cancelled.");
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) fail(error);
}

// ------------------------------------------------------------------ sending (Edge Function)
const SEND_TIMEOUT_MS = 30_000;

export async function sendNow(payload: ComposePayload): Promise<SendResult> {
  const call = supabase.functions.invoke<SendResult>("send-notification", { body: payload });
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new ApiError("The request timed out. Check History before retrying.")), SEND_TIMEOUT_MS);
  });
  const { data, error } = await Promise.race([call, timeout]);
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let message = `Server returned an error (${error.context.status}).`;
      try {
        const body = (await error.context.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch { /* keep default */ }
      throw new ApiError(message);
    }
    throw new ApiError(error.message);
  }
  if (!data) throw new ApiError("Empty response from server.");
  return data;
}

// ------------------------------------------------------------------ templates
export async function listTemplates(appId: string): Promise<TemplateRec[]> {
  const { data, error } = await supabase.from("templates").select("*").eq("app_id", appId)
    .order("created_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as TemplateRec[];
}

export async function getTemplate(id: string): Promise<TemplateRec> {
  const { data, error } = await supabase.from("templates").select("*").eq("id", id).maybeSingle();
  if (error) fail(error);
  if (!data) throw new ApiError("Template not found.");
  return data as TemplateRec;
}

export async function createTemplate(input: TemplateInput): Promise<void> {
  const { error } = await supabase.from("templates").insert(input);
  if (error) fail(error);
}

export async function updateTemplate(id: string, input: Omit<TemplateInput, "app_id">): Promise<void> {
  const { error } = await supabase.from("templates").update(input).eq("id", id);
  if (error) fail(error);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) fail(error);
}

// ------------------------------------------------------------------ drafts
export async function listDrafts(appId: string): Promise<DraftRec[]> {
  const { data, error } = await supabase.from("drafts").select("*").eq("app_id", appId)
    .order("updated_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as DraftRec[];
}

export async function getDraft(id: string): Promise<DraftRec> {
  const { data, error } = await supabase.from("drafts").select("*").eq("id", id).maybeSingle();
  if (error) fail(error);
  if (!data) throw new ApiError("Draft not found.");
  return data as DraftRec;
}

/** Creates the draft, or updates it when an id is given. Returns the draft id. */
export async function saveDraft(id: string | null, input: DraftInput): Promise<string> {
  if (id) {
    const { error } = await supabase.from("drafts").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) fail(error);
    return id;
  }
  const { data, error } = await supabase.from("drafts").insert(input).select("id").single();
  if (error) fail(error);
  return (data as { id: string }).id;
}

export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.from("drafts").delete().eq("id", id);
  if (error) fail(error);
}

// ------------------------------------------------------------------ audience topics
export async function listAudience(appId: string): Promise<AudienceTopic[]> {
  const { data, error } = await supabase.from("audience_topics").select("*").eq("app_id", appId)
    .order("kind").order("name");
  if (error) fail(error);
  return (data ?? []) as AudienceTopic[];
}

export async function addAudienceTopic(input: { app_id: string; name: string; label: string; kind: AudienceKind }): Promise<void> {
  const { error } = await supabase.from("audience_topics").insert(input);
  if (error) fail(error);
}

export async function deleteAudienceTopic(id: string): Promise<void> {
  const { error } = await supabase.from("audience_topics").delete().eq("id", id);
  if (error) fail(error);
}

// ------------------------------------------------------------------ image upload
export const IMAGE_MAX_BYTES = 1_000_000;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function uploadImage(appId: string, file: File): Promise<string> {
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new ApiError("Use a JPG, PNG or WebP image.");
  if (file.size > IMAGE_MAX_BYTES) throw new ApiError("Image must be under 1 MB.");
  const path = `${appId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("notification-images").upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) fail(error);
  return supabase.storage.from("notification-images").getPublicUrl(path).data.publicUrl;
}

// ------------------------------------------------------------------ dashboard
export async function loadDashboard(): Promise<DashboardData> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const [apps, recent, week, scheduled] = await Promise.all([
    listApps(),
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(8),
    supabase.from("notifications").select("status,created_at").in("status", ["sent", "failed"])
      .gte("created_at", start.toISOString()).limit(5000),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
  ]);
  if (recent.error) fail(recent.error);
  if (week.error) fail(week.error);
  const days = bucketByDay((week.data ?? []) as { status: string; created_at: string }[], lastDays(7));
  return {
    apps,
    days,
    sent7: days.reduce((n, d) => n + d.sent, 0),
    failed7: days.reduce((n, d) => n + d.failed, 0),
    scheduled: scheduled.count ?? 0,
    recent: (recent.data ?? []) as NotificationRec[],
  };
}
