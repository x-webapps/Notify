import { describe, expect, it } from "vitest";
import { androidGuide } from "./androidGuide";
import { OFFSETS_MIN, offsetTopic } from "./localtime";

describe("android guide", () => {
  const text = androidGuide();

  it("inlines the PushTopics helper and leaves no placeholder behind", () => {
    expect(text).not.toContain("{{");
    expect(text).toContain("object PushTopics");
    expect(text).toContain("fun sync(context: Context)");
  });

  it("covers every part an agent must implement", () => {
    for (const needle of [
      "NotificationLinkHandler",
      "AppFirebaseMessagingService",
      "MESSAGING_EVENT",
      "default_notification_channel_id",
      "app_updates_channel",
      "POST_NOTIFICATIONS",
      "singleTop",
      "onNewIntent",
      "PushTopics.sync(this)",
      "google-services.json",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("uses the same topic names the panel targets", () => {
    for (const topic of ["all", "v_", "country_", "tz_", "utc_"]) expect(text).toContain(topic);
    // the Kotlin offset formatting must produce what offsetTopic() expects, e.g. utc_p0530
    expect(offsetTopic(OFFSETS_MIN[0] ?? 0)).toMatch(/^utc_[pm]\d{4}$/);
  });
});
