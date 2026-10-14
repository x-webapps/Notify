import type { TargetType } from "./validate.ts";

export type NotificationStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled";

export interface AppRow {
  id: string;
  name: string;
  package_name: string;
  fcm_project_id: string;
  default_topic: string;
  channel_id: string;
  secret_key: string | null;
  url_allowlist: string[];
}

export interface NotificationRow {
  id: string;
  app_id: string;
  title: string;
  body: string;
  url: string | null;
  image_url: string | null;
  target_type: TargetType;
  target_value: string;
  tz: string;
  status: NotificationStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  fcm_message_id: string | null;
  error: string | null;
  created_by: string | null;
}

export interface DeliveryResult {
  notification_id: string;
  ok: boolean;
  status: NotificationStatus;
  message_id?: string;
  error?: string;
  hint?: string;
}
