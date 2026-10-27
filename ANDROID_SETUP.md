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
| `<package name>` | "All users" (must equal the app's *Default topic* in the panel). Not `all`: topics are shared by every app in a Firebase project, so a package-name topic keeps your apps apart |
| `v_<versionCode>` | Audience: app version |
| `country_<ISO>` | Audience: country (from the phone's region setting, not GPS) |
| `tz_<Zone_Name>` | Audience: time zone, for example `tz_Asia_Kolkata` |
| `utc_<p\|m>HHMM` | **Device-local-time sends**, for example `utc_p0530` |

It only re-subscribes when a value changed and leaves the previous topic. Firebase stores the subscriptions, so
nothing is saved in your database. Then save the audiences you want to target in the panel's **Audience** tab.
Language is intentionally not used.

Audiences and local-time sends only reach users on an app version that includes `PushTopics`. Release an update.
Switching an existing app from `all` to the package name: keep subscribing to `all` too and leave the panel's Default
topic on `all` until most users have updated, then change it.

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
Copy the value from Logcat into the panel's *Device token* field, give it a name (for example "My phone") and click
**Save device**. Saved devices stay in your browser only. Before a send to everyone, the confirmation dialog can send a
test to a saved device first.

## 5. Service account key (once per app, no `gcloud` needed)
In this app's Firebase project: *Project settings → Service accounts → Generate new private key*. Keep the `.json`
file outside the repo, and never paste it into chat or give it to an AI agent. You upload it in step 6; the panel
checks it with Firebase and stores it encrypted. Delete the downloaded file afterwards.

The key must come from the **same** Firebase project as this app's `google-services.json`, and
*APIs & Services → Library → **Firebase Cloud Messaging API (V1)*** must be enabled (usually already on).

If you cannot create keys because of the organization policy `iam.disableServiceAccountKeyCreation`, use the central
account instead: grant the panel's service account the role **Firebase Cloud Messaging API Admin** in this app's project
(see the README) and leave the key file empty in step 6.

## 6. Add the app in the panel
**Apps → Add app**: name, package name, **Choose key file** (the Project ID fills in from the key), default topic
(the app's package name), channel ID, and optionally an icon URL and App URL (the Play Store link is detected from the package name when
empty). On save the panel checks the key; then **App settings → Check connection** should say *Connected*.

## 7. Checklist per app
- [ ] This app's own `google-services.json`; `firebase-messaging` and `core-ktx` dependencies
- [ ] `PushTopics.kt` added and `PushTopics.sync(this)` called in `Application.onCreate()`
- [ ] Channel ID matches the panel; `POST_NOTIFICATIONS` requested
- [ ] `singleTop`, `handle()` in `onCreate` and `onNewIntent`
- [ ] Panel: app added with this project's **service account key** (Check connection says Connected)
- [ ] Foreground image loading in `AppFirebaseMessagingService`, and `PushTopics` re-subscribing when the Firebase project changes (both are in the guide)
- [ ] Tested: token test, All users, one audience, foreground, background, killed, invalid link
- [ ] Update released (audiences and local-time sends need it)
