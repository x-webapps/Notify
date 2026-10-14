# Android setup for Push Admin

Each Android app has its **own** Firebase project (used only for FCM). Do this once per app.
The full Kotlin code (link handler, messaging service, manifest, channel, `MainActivity`) is in
`Guideline_Notification.md`; this page lists what the panel needs from the app.

## 1. Firebase and dependencies
* Add the app in the Firebase console and put its **own** `google-services.json` in `app/`.
* Apply the Google Services Gradle plugin and add:
```groovy
implementation platform("com.google.firebase:firebase-bom:34.17.0")
implementation "com.google.firebase:firebase-messaging"
```
* Do not run another push SDK (e.g. OneSignal) at the same time.

## 2. Subscribe to the topic (required)
This panel has **no device-token database**. Users receive “all users” messages only if the app subscribes, so call this on first launch (e.g. in `Application.onCreate()` or `MainActivity`):
```kotlin
FirebaseMessaging.getInstance().subscribeToTopic("all")
```
Use the same name as the app's *Default topic* in the panel. For targeted sends, subscribe to extra topics (e.g. `news`, `pro`) and use a **Condition** like `'news' in topics && 'pro' in topics`.

## 3. Channel, permission and link
* Create a notification channel whose ID equals the app's **Channel ID** in the panel (default `app_updates_channel`), and set it as `com.google.firebase.messaging.default_notification_channel_id` in the manifest.
* Request `POST_NOTIFICATIONS` on Android 13+.
* Launcher activity: `android:launchMode="singleTop"`; call `NotificationLinkHandler.handle()` in both `onCreate` and `onNewIntent`.
* The panel sends the link as data key **`url`**. The handler must accept only `http`/`https` URLs with a host (see the guideline).

## 4. Get a device token for “Send test to token”
Temporary code, remove afterwards:
```kotlin
FirebaseMessaging.getInstance().token.addOnSuccessListener { Log.d("FCM_TOKEN", it) }
```
Copy the value from Logcat into the panel's *Test device token* field.

## 5. Service account access (one-time, per Firebase project)
The panel sends through a service account, so for **every** app's Firebase project:
1. Google Cloud Console → *IAM → Grant access* → add the service account's email → role **Firebase Cloud Messaging Admin**.
2. *APIs & Services → Library* → make sure **Firebase Cloud Messaging API (V1)** is enabled.

If you cannot create the service-account key because of the organization policy `iam.disableServiceAccountKeyCreation`, ask an organization admin to allow key creation for that project (or create the key in a project outside the organization), then continue as in the README.

## 6. Checklist per app
- [ ] `google-services.json` of this app, `firebase-messaging` dependency
- [ ] `subscribeToTopic("all")` on first launch
- [ ] Channel ID matches the panel; `POST_NOTIFICATIONS` requested
- [ ] `singleTop`, `handle()` in `onCreate` and `onNewIntent`
- [ ] IAM role + FCM V1 API in this app's Firebase project
- [ ] Panel: app added with the correct **FCM project ID**
- [ ] Tested: foreground, background, killed, invalid link
