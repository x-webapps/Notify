import type { TargetType } from "./validate";

export type { TargetType };

export type NotificationStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled";

export interface AppRec {
  id: string;
  name: string;
  package_name: string;
  fcm_project_id: string;
  default_topic: string;
  channel_id: string;
  secret_key: string | null;
  url_allowlist: string[];
  icon_url: string | null;
  app_url: string | null;
  created_at: string;
}

export type AppInput = Omit<AppRec, "id" | "created_at">;

export interface NotificationRec {
  id: string;
  app_id: string;
  title: string;
  body: string;
  url: string | null;
  image_url: string | null;
  target_type: TargetType;
  target_value: string;
  status: NotificationStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  fcm_message_id: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TemplateRec {
  id: string;
  app_id: string;
  name: string;
  title: string;
  body: string;
  url: string | null;
  image_url: string | null;
  created_at: string;
}

export type TemplateInput = Omit<TemplateRec, "id" | "created_at">;

export interface SendResult {
  notification_id: string;
  ok: boolean;
  status: NotificationStatus;
  message_id?: string;
  error?: string;
  hint?: string;
}

export type TargetChoice = "default" | "topic" | "condition" | "token" | "audience";

export interface DraftRec {
  id: string;
  app_id: string;
  title: string;
  body: string;
  url: string | null;
  image_url: string | null;
  target_choice: TargetChoice;
  target_value: string;
  updated_at: string;
}

export type DraftInput = Omit<DraftRec, "id" | "updated_at">;

export type AudienceKind = "custom" | "version" | "country" | "language" | "timezone";

export interface AudienceTopic {
  id: string;
  app_id: string;
  name: string;
  label: string;
  kind: AudienceKind;
  created_at: string;
}

export interface DayStat {
  key: string;
  label: string;
  sent: number;
  failed: number;
}

export interface DashboardData {
  apps: AppRec[];
  days: DayStat[];
  sent7: number;
  failed7: number;
  scheduled: number;
  recent: NotificationRec[];
}
