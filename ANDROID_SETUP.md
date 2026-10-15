# Android setup for Push Admin

Each Android app has its **own** Firebase project (used only for FCM). Do this once per app.

**Fastest way:** open the panel, go to **Settings → Android integration guide**, click **Copy guide**, and paste it into
an AI coding agent (Claude Code, Cursor, Copilot…) inside the app's project. It contains everything below with
complete code. The same code, written for humans, is in [Guideline_Notification.md](Guideline_Notification.md).

## 1. Firebase and dependencies
* Add the app in the Firebase console and put its **own** `google-services.json` in `app/`.
* Apply the Google Services Gradle plugin and add:
```groovy
implementation platform("com.google.firebase:firebase-bom:34.17.0")
implementation "com.google.firebase:firebase-messaging"
```
* `androidx.core:core-ktx` is needed too (the topics helper uses `PackageInfoCompat`).
* Do not run another push SDK (for example OneSignal) at the same time.

## 2. Topics: how the panel finds your users
This panel has **no device-token database**. Messages go to **topics** that the app subscribes to itself.
Add the `PushTopics` helper (code in the panel's Audience tab and in section 11 of `Guideline_Notification.md`)
and call it on every launch:
```kotlin
PushTopics.sync(this) // in Application.onCreate(), after the notification channel is created
```
It subscribes the device to:

| Topic | Used for |
|---|---|
| `all` | "All users" (must equal the app's *Default topic* in the panel) |
| `v_<versionCode>` | Audience: app version |
| `country_<ISO>` | Audience: country (from the phone's region setting, not GPS) |
| `tz_<Zone_Name>` | Audience: time zone, for example `tz_Asia_Kolkata` |
| `utc_<p\|m>HHMM` | **Device-local-time sends**, for example `utc_p0530` |

It only re-subscribes when a value changed and leaves the previous topic. Firebase stores the subscriptions, so
nothing is saved in your database. Then save the audiences you want to target in the panel's **Audience** tab.
Language is intentionally not used.

Audiences and local-time sends only reach users on an app version that includes `PushTopics`. Release an update.
Old versions that only subscribed to `all` still receive normal "All users" sends.

## 3. Channel, permission and link
* Create a notification channel whose ID equals the app's **Channel ID** in the panel (default `app_updates_channel`),
  and set it as `com.google.firebase.messaging.default_notification_channel_id` in the manifest.
* Request `POST_NOTIFICATIONS` on Android 13+.
* Launcher activity: `android:launchMode="singleTop"`; call `NotificationLinkHandler.handle()` in both `onCreate`
  and `onNewIntent`.
* The panel sends the link as data key **`url`**. The handler must accept only `http`/`https` URLs with a host.
* The panel can also send an image (https URL), a replace key (collapse key and tag), an expiry (TTL) and a
  priority. Android handles all of these itself when the app is in the background; no extra code is needed.

## 4. Get a device token for "Send test to token"
Temporary code, remove afterwards:
```kotlin
FirebaseMessaging.getInstance().token.addOnSuccessListener { Log.d("FCM_TOKEN", it) }
```
Copy the value from Logcat into the panel's *Test device token* field.

## 5. Service account access (one-time, per Firebase project)
The panel sends through a service account, so for **every** app's Firebase project:
1. Google Cloud Console → *IAM → Grant access* → add the service account's email → role **Firebase Cloud Messaging API Admin**.
2. *APIs & Services → Library* → make sure **Firebase Cloud Messaging API (V1)** is enabled.

If you cannot create the service-account key because of the organization policy
`iam.disableServiceAccountKeyCreation`, ask an organization admin to allow key creation for that project (or
create the key in a project outside the organization), then continue as in the README.

## 6. Add the app in the panel
**Apps → Add app**: name, package name, the Firebase **Project ID**, default topic `all`, channel ID, and
optionally an icon URL and App URL (the Play Store link is detected from the package name when empty).

## 7. Checklist per app
- [ ] This app's own `google-services.json`; `firebase-messaging` and `core-ktx` dependencies
- [ ] `PushTopics.kt` added and `PushTopics.sync(this)` called in `Application.onCreate()`
- [ ] Channel ID matches the panel; `POST_NOTIFICATIONS` requested
- [ ] `singleTop`, `handle()` in `onCreate` and `onNewIntent`
- [ ] IAM role + FCM V1 API in this app's Firebase project
- [ ] Panel: app added with the correct **FCM project ID**
- [ ] Tested: token test, All users, one audience, foreground, background, killed, invalid link
- [ ] Update released (audiences and local-time sends need it)
