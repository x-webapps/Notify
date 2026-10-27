# Push Admin support for an Android app

What the app needs so the Push Admin panel can reach it: tapping a notification opens its `url`, the image shows, and
audiences work. Works when the app is in the foreground, background or killed.

Replace `com.example.app` with your package name.

## Checklist (tick every box before release)

**App**
- [ ] `firebase-messaging` dependency and the app's own `google-services.json`
- [ ] No other push SDK (OneSignal etc.)
- [ ] `NotificationLinkHandler.kt`, `AppFirebaseMessagingService.kt`, `PushTopics.kt` copied; package names fixed
- [ ] Manifest: service, default channel meta-data, `POST_NOTIFICATIONS`, `launchMode="singleTop"` on the launcher activity
- [ ] Channel `app_updates_channel` created and `PushTopics.sync(this)` called in `Application.onCreate()`
- [ ] Launcher activity calls `NotificationLinkHandler.handle()` in both `onCreate` and `onNewIntent`
- [ ] Android 13+ notification permission requested
- [ ] Subscribes to the **package name** topic, not `all` (topics are shared by every app in a Firebase project)

**Panel**
- [ ] Apps, Add app: package name, service account key uploaded, **Default topic = package name**, channel `app_updates_channel`
- [ ] App settings, Check connection says *Connected*

**Test on a device** (use a build that has all of the above)
- [ ] Foreground, background and killed: notification arrives, tap opens the link
- [ ] Image shows in foreground and background
- [ ] Invalid `url` (`javascript:alert(1)`) opens nothing
- [ ] A send to this app does not reach your other apps in the same Firebase project

---

## 1. Dependency
`app/build.gradle` (Firebase BoM must already be present):
```groovy
implementation platform(libs.firebase.bom)
implementation libs.firebase.messaging
```

## 2. Link handler
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
            context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
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

## 3. Messaging service
FCM shows the notification itself in the background. This service only runs in the **foreground**, so it builds the
notification, with the `url` and the image.

`notifications/AppFirebaseMessagingService.kt`
```kotlin
package com.example.app.notifications

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.example.app.MainActivity
import com.example.app.R
import java.net.HttpURLConnection
import java.net.URL

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
        // Unique request code so each notification keeps its own url.
        val pending = PendingIntent.getActivity(
            this, System.currentTimeMillis().toInt(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val picture = message.notification?.imageUrl?.toString()?.let { downloadImage(it) }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher) // better: a white monochrome icon
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
        if (picture != null) {
            builder.setLargeIcon(picture).setStyle(
                NotificationCompat.BigPictureStyle().bigPicture(picture).bigLargeIcon(null as Bitmap?).setSummaryText(body)
            )
        } else {
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }
        getSystemService(NotificationManager::class.java)
            ?.notify(System.currentTimeMillis().toInt(), builder.build())
    }

    /** Runs on a background thread, so a short blocking download is fine. Null on any problem. */
    private fun downloadImage(url: String): Bitmap? {
        if (!url.startsWith("https://")) return null
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 8000
            conn.inputStream.use { input ->
                val bytes = input.readBytes()
                if (bytes.size > 2_000_000) null else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        /** Must match the panel's Channel ID and the manifest meta-data. */
        const val CHANNEL_ID = "app_updates_channel"
    }
}
```

## 4. Manifest
Inside `<application>`:
```xml
<service android:name=".notifications.AppFirebaseMessagingService" android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>

<meta-data
    android:name="com.google.firebase.messaging.default_notification_channel_id"
    android:value="app_updates_channel" />

<activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTop">
    ...
</activity>
```
Top level:
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```
Without `singleTop`, a tap while the app is in the background opens the app but loses the link.

## 5. Channel, topics and launcher activity
`Application.onCreate()`:
```kotlin
override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel("app_updates_channel", "Updates & Announcements", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }
    PushTopics.sync(this)
}
```

Launcher activity:
```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    NotificationLinkHandler.handle(this, intent) // opened from a tap (background / killed)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
}

override fun onNewIntent(intent: Intent) { // already open, notification tapped
    super.onNewIntent(intent)
    setIntent(intent)
    NotificationLinkHandler.handle(this, intent)
}
```
`notificationPermissionLauncher` is `registerForActivityResult(ActivityResultContracts.RequestPermission()) { }`.

## 6. Topics
The panel sends to **topics**, not device tokens, so the app subscribes on every launch. These names are fixed:

| Topic | Meaning |
|---|---|
| `<package name>` | Every user of this app. The panel's **Default topic** must be exactly this |
| `v_<versionCode>` | App version, e.g. `v_42` |
| `country_<ISO>` | Country from the phone's region setting, e.g. `country_IN` |
| `tz_<Zone_Name>` | Time zone, e.g. `tz_Asia_Kolkata` |
| `utc_<p\|m>HHMM` | UTC offset for "send at 9:00 AM local time", e.g. `utc_p0530` |

Topics belong to the Firebase **project**, so two apps sharing one project must not share the default topic. Use the
package name, never `all`.

`notifications/PushTopics.kt`
```kotlin
package com.example.app.notifications

import android.content.Context
import androidx.core.content.pm.PackageInfoCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs

/** Keeps this device subscribed to the topics used by the Push Admin panel. */
object PushTopics {
    private const val PREFS = "push_topics"

    /** Call on every app start. Only changed topics are re-subscribed. */
    fun sync(context: Context) {
        forgetCacheIfProjectChanged(context)
        FirebaseMessaging.getInstance().subscribeToTopic(context.packageName)

        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val version = PackageInfoCompat.getLongVersionCode(info)
        val country = Locale.getDefault().country.uppercase()
        val zone = TimeZone.getDefault().id.replace(Regex("[^a-zA-Z0-9_.~%-]"), "_")

        swap(context, "version", "v_$version")
        if (country.isNotEmpty()) swap(context, "country", "country_$country")
        swap(context, "timezone", "tz_$zone")

        val offsetMin = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000
        val sign = if (offsetMin < 0) "m" else "p"
        swap(context, "offset", "utc_" + sign + "%02d%02d".format(abs(offsetMin) / 60, abs(offsetMin) % 60))
    }

    /** If google-services.json now points at another project, the remembered topics are stale. */
    private fun forgetCacheIfProjectChanged(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val projectId = FirebaseApp.getInstance().options.projectId ?: return
        if (prefs.getString("project_id", null) == projectId) return
        prefs.edit().clear().putString("project_id", projectId).apply()
    }

    /** Subscribes to [topic]; leaves the topic previously stored for [slot] if it changed. */
    private fun swap(context: Context, slot: String, topic: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val old = prefs.getString(slot, null)
        if (old == topic) return
        val fcm = FirebaseMessaging.getInstance()
        if (old != null) fcm.unsubscribeFromTopic(old)
        fcm.subscribeToTopic(topic).addOnSuccessListener { prefs.edit().putString(slot, topic).apply() }
    }
}
```

Notes:
- A new subscription can take a few minutes to become active.
- Audience topics (`v_`, `country_`, `tz_`, `utc_`) are shared by every app in the project. Only the package-name topic
  separates your apps. Use *Match all* with the default topic if you ever target an audience across several apps.
- Moving an existing app from `all`: keep subscribing to `all` as well, leave the panel on `all`, and switch the
  Default topic to the package name once most users have updated.

## 7. Panel setup
1. **Apps, Add app**: name, package name, **Choose key file** (Firebase console, Project settings, Service accounts,
   Generate new private key), Default topic (fills in from the package name), channel `app_updates_channel`.
2. **App settings, Check connection** should say *Connected*. It does not prove the app is installed or subscribed.
3. One Firebase project, several apps: add each app separately and upload the same key to each.

## 8. Testing
| Case | Steps | Expected |
|---|---|---|
| Foreground | App open, send | Notification appears, tap opens the link |
| Background | Press Home, send, tap | App opens, then the link |
| Killed | Swipe away from recents, send, tap | Same |
| Image | Send with an https image | Shows in all three cases |
| Invalid | `url` = `javascript:alert(1)` | Nothing opens; Logcat `NotificationLink` says "Ignored invalid url" |

Use an emulator image **with Google Play**. Test the tap only, without Firebase:
```bash
adb shell am start -n com.example.app/.MainActivity -e url https://example.com
```

## 9. Troubleshooting
| Problem | Check |
|---|---|
| Panel says "Sent", nothing arrives | App never subscribed: `PushTopics.sync()` runs, Default topic equals the package name, device online, wait a few minutes after first launch |
| Arrives, tap only opens the app | `url` data key is exactly `url`; `launchMode="singleTop"` set; `handle()` called in `onCreate` and `onNewIntent` |
| Link opens twice | Keep `removeExtra` in the handler |
| Image missing | Foreground: the service must load it (section 3). Background: direct https JPG/PNG/WebP under 1 MB; on Samsung it shows only when expanded |
| Another app got the notification | Both apps subscribe to the same topic. Give each its package name |
| Audience send reaches nobody | Topic name must match exactly (`country_IN`, `v_42`); install a build that includes `PushTopics` |
| Stopped after switching Firebase project | `PushTopics` re-subscribes when the project changes; otherwise reinstall |
| White square icon | Use a monochrome transparent icon and set `com.google.firebase.messaging.default_notification_icon` |

## 10. Security
- Always validate the URL (scheme and host) before opening. Never open `intent:`, `file:`, `javascript:` or custom schemes.
- Only people with access to your Firebase project and the panel can send; protect those accounts with 2FA.
- No secrets or personal data in notification data.
