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

## 8. Send from Firebase Console
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

## 11. Optional improvements
- **Topics**: `FirebaseMessaging.getInstance().subscribeToTopic("all")` to message everyone without tokens.
- **Domain allowlist**: in `validate()`, check `uri.host` against your own domains.
- **Play Store links**: also allow the `market` scheme if you want `market://details?id=...`.
- **Monochrome small icon** and separate channels (Updates / Offers).
- **Analytics**: log a `notification_open` event inside `handle()`.

## 12. Security notes
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
- [ ] Tested: foreground, background, killed, invalid URL
