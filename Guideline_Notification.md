# Guideline: Open a URL from a Firebase (FCM) Notification

Send a notification from Firebase Console with a custom `url`; tapping it opens that link in the browser.
Works when the app is in the **foreground, background, and killed** state. No app update needed per link.

Package/namespace used below: `com.example.app`. Replace with your own.

---

## 1. Prerequisites
- App is connected to Firebase (`google-services.json` in `app/`, Google Services plugin applied).
- Do **not** use OneSignal or another push SDK at the same time (they conflict over FCM).

## 2. Dependency

`gradle/libs.versions.toml`
```toml
firebase-messaging = { module = "com.google.firebase:firebase-messaging" }
```

`app/build.gradle` (Firebase BoM must already be present)
```groovy
implementation platform(libs.firebase.bom)
implementation(libs.firebase.messaging)
```

Without a version catalog:
```groovy
implementation platform("com.google.firebase:firebase-bom:34.17.0")
implementation "com.google.firebase:firebase-messaging"
```

## 3. Link handler
`notifications/NotificationLinkHandler.kt`
```kotlin
package com.example.app.notifications

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log

object NotificationLinkHandler {
    const val EXTRA_URL = "url"
    private const val TAG = "NotificationLink"

    fun handle(context: Context, intent: Intent?) {
        val raw = intent?.getStringExtra(EXTRA_URL) ?: return
        intent.removeExtra(EXTRA_URL) // consume: don't reopen on rotation / onNewIntent

        val uri = validate(raw) ?: run {
            Log.w(TAG, "Ignored invalid url: $raw")
            return
        }
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No app can open $uri", e)
        }
    }

    /** Only http(s) links with a host are allowed. */
    fun validate(raw: String): Uri? {
        val uri = Uri.parse(raw.trim())
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return null
        if (uri.host.isNullOrBlank()) return null
        return uri
    }
}
```

## 4. Messaging service (foreground messages)
FCM shows notifications itself when the app is in the background/killed.
This service is only called in the **foreground**, so we build the notification ourselves.

`notifications/AppFirebaseMessagingService.kt`
```kotlin
package com.example.app.notifications

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.example.app.MainActivity
import com.example.app.R

class AppFirebaseMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: getString(R.string.app_name)
        val body = message.notification?.body ?: message.data["body"] ?: return
        val url = message.data[NotificationLinkHandler.EXTRA_URL]

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) return

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (url != null) putExtra(NotificationLinkHandler.EXTRA_URL, url)
        }
        val pending = PendingIntent.getActivity(
            this, System.currentTimeMillis().toInt(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, "app_updates_channel")
            .setSmallIcon(R.mipmap.ic_launcher) // better: a white monochrome icon
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        getSystemService(NotificationManager::class.java)
            ?.notify(System.currentTimeMillis().toInt(), notification)
    }
}
```

## 5. AndroidManifest.xml
Inside `<application>`:
```xml
<service
    android:name=".notifications.AppFirebaseMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>

<meta-data
    android:name="com.google.firebase.messaging.default_notification_channel_id"
    android:value="app_updates_channel" />
```

On your launcher activity add `launchMode="singleTop"`:
```xml
<activity
    android:name=".MainActivity"
    android:exported="true"
    android:launchMode="singleTop">
    ...
</activity>
```

Permission (if not already present):
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## 6. Notification channel
In your `Application.onCreate()` (or any startup place):
```kotlin
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    getSystemService(NotificationManager::class.java)?.createNotificationChannel(
        NotificationChannel(
            "app_updates_channel",
            "Updates & Announcements",
            NotificationManager.IMPORTANCE_DEFAULT
        )
    )
}
```
The channel ID must match the one in the manifest meta-data and the service.

## 7. Launcher Activity
```kotlin
class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // App opened from a notification tap (background / killed)
        NotificationLinkHandler.handle(this, intent)

        // Android 13+ notification permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        // setContent { ... }
    }

    // App already open (foreground / singleTop) and notification tapped
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        NotificationLinkHandler.handle(this, intent)
    }
}
```

## 8. Send from the Push Admin panel (or Firebase Console)
The Push Admin panel sends the same message format (`notification` + data key `url`, channel `app_updates_channel`), so no extra app code is needed beyond sections 3 to 7 and the topics in section 11.

To send from the Firebase Console instead:
1. **Messaging → New campaign → Firebase Notification messages**
2. Fill title and text.
3. **Additional options → Custom data**
   - Key: `url`
   - Value: `https://example.com`
4. Target the app (or a topic / test device) and publish.

Key must be exactly `url` (lowercase).

## 9. Testing
Get a device token (temporary, remove after):
```kotlin
FirebaseMessaging.getInstance().token.addOnSuccessListener { Log.d("FCM_TOKEN", it) }
```
Console → **Send test message** → paste token.

| Case | Steps | Expected |
|---|---|---|
| Foreground | Keep app open, send | Notification appears, tap opens link |
| Background | Press Home, send, tap | App opens, then link opens |
| Killed | Swipe away from recents, send, tap | Same |
| Invalid | `url` = `javascript:alert(1)` or `file:///x` | Nothing opens; Logcat `NotificationLink` shows "Ignored invalid url" |

Without Firebase, tap handling only:
```bash
adb shell am start -n com.example.app/.MainActivity -e url https://example.com
```

Use an emulator image **with Google Play**, otherwise FCM won't work.

## 10. Troubleshooting
| Problem | Check |
|---|---|
| Nothing arrives | Notifications enabled for the app; `google-services.json` package matches `applicationId`; device has internet and Play Services |
| Arrives but link doesn't open | Custom data key is exactly `url`; value starts with `https://`; `handle()` is called in both `onCreate` and `onNewIntent` |
| Link opens twice | Make sure `removeExtra` is kept in the handler |
| Works only in foreground | `launchMode="singleTop"` missing, or the data key is wrong |
| White square icon | Use a monochrome transparent icon and set `com.google.firebase.messaging.default_notification_icon` meta-data |
| Conflict with another push SDK | Remove OneSignal/others, or only one SDK can own FCM |
| Panel says "Sent" but the device gets nothing | The app never subscribed: check `PushTopics.sync()` runs, the device is online, and wait a few minutes after the first launch |
| Audience send reaches nobody | The topic name in the panel must match exactly (`country_IN`, `v_42`, `tz_Asia_Kolkata`); install a build that includes `PushTopics` |

## 11. Audience topics (required for the Push Admin panel)
The panel sends to **topics**, not to stored device tokens, so the app must subscribe on every launch.
Topic names are fixed; the panel's **Audience** tab uses exactly these:

| Topic | Meaning | Example |
|---|---|---|
| `all` | Every user (the panel's default target) | `all` |
| `v_<versionCode>` | Installed app version | `v_42` |
| `country_<ISO>` | Country from the device region setting | `country_IN` |
| `tz_<Zone_Name>` | Device time zone (`/` becomes `_`) | `tz_Asia_Kolkata` |

`notifications/PushTopics.kt`
```kotlin
package com.example.app.notifications

import android.content.Context
import androidx.core.content.pm.PackageInfoCompat
import com.google.firebase.messaging.FirebaseMessaging
import java.util.Locale
import java.util.TimeZone

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
}
```

Call it once at startup:
```kotlin
class ApplicationClass : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        PushTopics.sync(this)
    }
}
```

Notes:
- Subscriptions are stored by Firebase, so nothing is kept in your own database.
- When the user updates the app, the helper leaves the old `v_` topic and joins the new one, so "version 42 only" counts stay accurate.
- The country comes from the phone's region setting, not from GPS. Users with no region set simply have no `country_` topic.
- A new subscription can take a few minutes to become active on FCM's side.
- Target several audiences in the panel with *Match all* (AND) or *Match any* (OR). FCM allows at most 5 topics per condition.
- Language is intentionally not used.

## 12. Optional improvements
- **Domain allowlist**: in `validate()`, check `uri.host` against your own domains.
- **Play Store links**: also allow the `market` scheme if you want `market://details?id=...`.
- **Monochrome small icon** and separate channels (Updates / Offers).
- **Analytics**: log a `notification_open` event inside `handle()`.
- **Variables**: the panel replaces `{app_name}`, `{date}`, `{time}` and `{day}` before sending, so the app needs no code for them.
- **Big image**: the panel can send an `image` URL (https). Android shows it automatically when the app is in the background; for foreground messages load it yourself and use `BigPictureStyle`.

## 13. Security notes
- Always validate the URL (scheme + host) before opening. Never open `intent:`, `file:`, `javascript:` or custom schemes from data.
- Only people with access to your Firebase project can send these messages, so protect that account with 2FA.
- Do not put secrets or personal data in notification data.

## Checklist for a new app
- [ ] `firebase-messaging` dependency added
- [ ] `NotificationLinkHandler.kt` and `AppFirebaseMessagingService.kt` copied; package names fixed
- [ ] Service + default channel meta-data in manifest
- [ ] `launchMode="singleTop"` on launcher activity
- [ ] Channel created in `Application.onCreate()`
- [ ] `handle()` called in `onCreate` and `onNewIntent`
- [ ] `POST_NOTIFICATIONS` permission requested (Android 13+)
- [ ] `PushTopics.kt` added and `PushTopics.sync(this)` called in `Application.onCreate()`
- [ ] Panel: app added with the correct **FCM project ID**; audiences saved in the Audience tab
- [ ] Tested: foreground, background, killed, invalid URL
- [ ] Tested: send to `all`, then to one audience (e.g. `country_IN`) and confirm only matching devices receive it
