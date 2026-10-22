# TASK: Add Push Admin compatible push notifications (Firebase Cloud Messaging) to this Android app

You are an AI coding agent. Implement push notifications in THIS Android app exactly as described below,
so that the app works with the "Push Admin" panel (a web panel that sends FCM messages). Read the whole
brief first, inspect the project (Gradle setup, Application class, launcher activity, manifest, package
name), then make the changes. Prefer small, focused edits that match the project's existing code style.

## How the panel talks to the app (context)
- The panel sends FCM HTTP v1 messages to **topics**. It does not store device tokens.
- Message shape: `notification { title, body, image? }`, data key `url` (optional), and
  `android.notification.channel_id`. The default channel id is `app_updates_channel`.
- Tapping a notification must open the `url` in the browser (only http/https links).
- Audiences are topics the app subscribes to itself: `all`, `v_<versionCode>`, `country_<ISO>`,
  `tz_<Zone_Name>` and `utc_<p|m>HHMM` (UTC offset, used for "send at 9:00 AM device local time").
  The topic names are a contract with the panel: do not rename them.

## Placeholders you must resolve before writing code
- `APP_PACKAGE`: the app's namespace / applicationId (the examples below use `com.example.app`; replace it everywhere).
- `LAUNCHER_ACTIVITY`: the app's launcher activity class (examples use `MainActivity`).
- `CHANNEL_ID`: use `app_updates_channel` unless the project owner told you a different Channel ID.
- If the project has no custom `Application` class, create one and register it with `android:name` in the manifest.
- The human must supply this app's own `google-services.json` (put it in `app/`). If it is missing, add the code anyway and list this as a required manual step. Never invent or paste Firebase keys.

## Rules
1. Use only Firebase Cloud Messaging for push. If another push SDK (OneSignal, etc.) is present, stop and report the conflict.
2. Never open anything except `http://` or `https://` links that have a host. Reject `javascript:`, `file:`, `intent:` and custom schemes.
3. Do not log or store FCM tokens, and do not put secrets in the app.
4. Keep the topic names and the `url` data key exactly as specified.
5. Match the project's Gradle style (version catalog `libs.versions.toml` or plain strings). Do not upgrade unrelated dependencies.
6. Do not remove existing features. If something below conflicts with existing code, adapt minimally and report it.

## Step 1: Dependencies
Apply the Google Services plugin if it is not already applied, and add Firebase Messaging using the Firebase BoM.
Version catalog style:
```toml
firebase-messaging = { module = "com.google.firebase:firebase-messaging" }
```
```groovy
implementation platform(libs.firebase.bom)
implementation(libs.firebase.messaging)
```
Plain style:
```groovy
implementation platform("com.google.firebase:firebase-bom:34.17.0")
implementation "com.google.firebase:firebase-messaging"
```
`androidx.core:core-ktx` is also required (it provides `PackageInfoCompat`); add it if missing.

## Step 2: Link handler
Create `notifications/NotificationLinkHandler.kt`:
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
        intent.removeExtra(EXTRA_URL) // consume: do not reopen on rotation / onNewIntent

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

## Step 3: Messaging service (messages received while the app is in the foreground)
When the app is in the background or killed, FCM shows the notification itself. In the foreground this
service must build it. Create `notifications/AppFirebaseMessagingService.kt` (use the app's real launcher
activity, a real small icon, and the right `R` import):
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
        val pending = PendingIntent.getActivity(
            this, System.currentTimeMillis().toInt(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Background messages get their image from FCM itself; in the foreground we load it here.
        val picture = message.notification?.imageUrl?.toString()?.let { downloadImage(it) }

        val builder = NotificationCompat.Builder(this, "app_updates_channel")
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

    /** onMessageReceived runs on a background thread, so a short blocking download is fine. Null on any problem. */
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
}
```

## Step 4: AndroidManifest.xml
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
The launcher activity must use `android:launchMode="singleTop"`. Add the permission if it is missing:
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## Step 5: Notification channel
In `Application.onCreate()` (or an existing channel-creation function), create the channel. The id must
match the manifest meta-data, the service, and the Channel ID configured in the panel:
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

## Step 6: Launcher activity
Handle the tap in both `onCreate` and `onNewIntent`, and ask for the notification permission on Android 13+
(skip the permission request if the app already has one):
```kotlin
class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // App opened from a notification tap (background / killed)
        NotificationLinkHandler.handle(this, intent)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        // existing setContent { ... } stays as it is
    }

    // App already open (foreground / singleTop) and a notification is tapped
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        NotificationLinkHandler.handle(this, intent)
    }
}
```
If the launcher activity is not a `ComponentActivity` (for example an `AppCompatActivity`), keep its
existing base class and apply the same three additions.

## Step 7: Audience topics (required for audiences and local-time sends)
Create `notifications/PushTopics.kt`:
```kotlin
{{PUSH_TOPICS_KT}}
```
Then call it once from `Application.onCreate()`, after the channel is created:
```kotlin
PushTopics.sync(this)
```
Notes: subscriptions are stored by Firebase (nothing is saved in the app's own database). The helper only
re-subscribes when a value changed and leaves the previous version / country / time zone / offset topic.
The country comes from the device region setting (not GPS).

## Step 8: Verify and report
1. Build the app (`./gradlew :app:assembleDebug` or the project's equivalent) and fix compile errors.
2. Confirm: service and meta-data are in the manifest, the channel id matches everywhere, `singleTop` is set,
   `handle()` is called in `onCreate` and `onNewIntent`, `PushTopics.sync(this)` runs at startup.
3. Without Firebase you can test link handling only:
   `adb shell am start -n APP_PACKAGE/.LAUNCHER_ACTIVITY -e url https://example.com`
   An invalid value such as `javascript:alert(1)` must open nothing and log "Ignored invalid url".
4. Report back: files created or changed, the resolved package/activity/channel id, anything you adapted,
   and the manual steps still needed.

## Manual steps for the human (list these in your final report)
- Add this app's own `google-services.json` to `app/` (Firebase Console, Project settings, Your apps).
- In the Push Admin panel: Apps, Add app. Enter the package name,
  Default topic `all` and the same Channel ID as above.
- In the panel's app settings, upload this Firebase project's **service account key** (Firebase Console, Project
  settings, Service accounts, Generate new private key; choose the downloaded .json file). The panel checks it with
  Firebase and stores it encrypted. No role setup is needed: Firebase's own `firebase-adminsdk` account can already
  send. Do not paste the key into chat, commit it, or give it to an AI agent.
- Run a debug build on a device or emulator with Google Play services, open the app once, then use the
  panel's "Send test to token" (token from Logcat via a temporary
  `FirebaseMessaging.getInstance().token.addOnSuccessListener { Log.d("FCM_TOKEN", it) }`, removed afterwards).
- Release an app version that contains this change: audiences and local-time sends only reach users on it.
