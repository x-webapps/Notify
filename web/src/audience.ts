import type { AudienceKind } from "./types";

/** Max topics FCM accepts in one condition. */
export const MAX_TOPICS_IN_CONDITION = 5;

const clean = (s: string): string => s.trim().replace(/[^a-zA-Z0-9_.~%-]+/g, "_").replace(/^_+|_+$/g, "");

/** The topic name the Android app must subscribe to for a given audience. */
export function topicName(kind: AudienceKind, value: string): string {
  const v = clean(value);
  if (!v) return "";
  switch (kind) {
    case "version": return `v_${v}`;
    case "country": return `country_${v.toUpperCase()}`;
    case "timezone": return `tz_${clean(value.replace(/\//g, "_"))}`;
    default: return v;
  }
}

export interface BuiltTarget {
  type: "topic" | "condition";
  value: string;
}

/** AND ("all") or OR ("any") of saved topics, as an FCM target. */
export function buildAudienceTarget(names: string[], mode: "all" | "any"): BuiltTarget | null {
  const unique = [...new Set(names)];
  if (unique.length === 0) return null;
  const only = unique[0];
  if (unique.length === 1 && only) return { type: "topic", value: only };
  const op = mode === "all" ? " && " : " || ";
  return { type: "condition", value: unique.map((n) => `'${n}' in topics`).join(op) };
}

/** Draft storage format for the audience builder: "all:a,b" or "any:a,b". */
export function encodeAudience(names: string[], mode: "all" | "any"): string {
  return `${mode}:${names.join(",")}`;
}

export function decodeAudience(value: string): { names: string[]; mode: "all" | "any" } {
  const [m = "all", rest = ""] = value.split(":", 2);
  return { mode: m === "any" ? "any" : "all", names: rest.split(",").filter(Boolean) };
}

export const KOTLIN_SNIPPET = `package com.example.app.notifications

import android.content.Context
import androidx.core.content.pm.PackageInfoCompat
import com.google.firebase.messaging.FirebaseMessaging
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs

/** Keeps this device subscribed to the audience topics used by the Push Admin panel. */
object PushTopics {
    private const val PREFS = "push_topics"

    /** Call on every app start (e.g. Application.onCreate). Only changed topics are re-subscribed. */
    fun sync(context: Context) {
        FirebaseMessaging.getInstance().subscribeToTopic("all")

        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val version = PackageInfoCompat.getLongVersionCode(info)
        val country = Locale.getDefault().country.uppercase()
        val zone = TimeZone.getDefault().id.replace(Regex("[^a-zA-Z0-9_.~%-]"), "_")

        swap(context, "version", "v_$version")
        if (country.isNotEmpty()) swap(context, "country", "country_$country")
        swap(context, "timezone", "tz_$zone")

        // UTC offset topic, used for "send at 9:00 AM device local time"
        val offsetMin = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000
        val sign = if (offsetMin < 0) "m" else "p"
        swap(context, "offset", "utc_" + sign + "%02d%02d".format(abs(offsetMin) / 60, abs(offsetMin) % 60))
    }

    /** Subscribes to [topic]; leaves the topic previously stored for [slot] if it changed. */
    private fun swap(context: Context, slot: String, topic: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val old = prefs.getString(slot, null)
        if (old == topic) return
        val fcm = FirebaseMessaging.getInstance()
        if (old != null) fcm.unsubscribeFromTopic(old)
        fcm.subscribeToTopic(topic).addOnSuccessListener {
            prefs.edit().putString(slot, topic).apply()
        }
    }
}`;
