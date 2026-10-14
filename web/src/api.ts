import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type {
  AppInput,
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
