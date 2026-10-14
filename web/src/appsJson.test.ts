import { describe, expect, it } from "vitest";
import { exportApps, parseAppsImport } from "./appsJson";
import type { AppRec } from "./types";

const app: AppRec = {
  id: "x", created_at: "2026-01-01", name: "Glass", package_name: "com.glass", fcm_project_id: "glass-12345",
  default_topic: "all", channel_id: "app_updates_channel", secret_key: null, url_allowlist: ["example.com"],
  icon_url: "https://cdn.example.com/i.png", app_url: null,
};

describe("apps export/import", () => {
  it("round-trips and never includes ids or key material", () => {
    const json = JSON.stringify(exportApps([app]));
    expect(json).not.toContain("private_key");
    expect(json).not.toContain('"id"');
    expect(parseAppsImport(json)).toEqual([
      { name: "Glass", package_name: "com.glass", fcm_project_id: "glass-12345", default_topic: "all",
        channel_id: "app_updates_channel", secret_key: null, url_allowlist: ["example.com"],
        icon_url: "https://cdn.example.com/i.png", app_url: null },
    ]);
  });

  it("rejects bad input", () => {
    expect(() => parseAppsImport("nope")).toThrow(/valid JSON/);
    expect(() => parseAppsImport("{}")).toThrow(/No apps/);
    expect(() => parseAppsImport(JSON.stringify({ apps: [{ name: "a", package_name: "b", fcm_project_id: "BAD ID" }] }))).toThrow(/fcm_project_id/);
    expect(() => parseAppsImport(JSON.stringify({ apps: [{ name: "a", package_name: "b", fcm_project_id: "good-123", secret_key: "SUPABASE_SERVICE_ROLE_KEY" }] }))).toThrow(/secret_key/);
  });
});
