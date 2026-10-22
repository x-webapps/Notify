# Icon pack migration: OneSignal -> FCM (Push Admin) + Analytics

Reusable guide for Blueprint-based icon packs (Jahir Fiquitiva's Blueprint template: `buildSrc` with
`Libs/Versions/Plugins/OneSignal.kt`, `MyApplication : FramesApplication`, `MainActivity : *BlueprintActivity`).
Worked and tested on `com.nothing.icon.free` (Nothing Stock). Replace the placeholders for each pack.

## Placeholders

| Placeholder | Example (Nothing Stock) | Where to find it |
|---|---|---|
| `APP_PACKAGE` | `com.nothing.icon.free` | `MyApp.appId` in `buildSrc` / `namespace` in `app/build.gradle` |
| `PROJECT_ID` | `nothing-stock` | Firebase console -> Project settings, or `project_id` in `google-services.json` |
| `CHANNEL_ID` | `app_updates_channel` | Keep this value; it must match the panel |
| `SERVICE_ACCOUNT_EMAIL` | `firebase-adminsdk-fbsvc@glass-widgets-9aefd.iam.gserviceaccount.com` | Only for the central-account method: Panel -> App settings -> Check connection -> "Service account used" |
| `OWNER_EMAIL` | your Google account | Must be an Owner of the Firebase project |

Topic names (`all`, `v_<versionCode>`, `country_<ISO>`, `tz_<Zone>`, `utc_<p|m>HHMM`) and the `url` data key are a
contract with the panel. Never rename them.

---

## Part A - Code changes (do these in the pack's repo)

### 0. Check first
- Search for `onesignal` / `OneSignal` (case-insensitive) in `app/build.gradle`, `buildSrc`, the manifest and `kotlin/`.
  Expect: `OneSignal.kt`, `Libs.oneSignal`, `Versions.oneSignal`, manifest `NotificationServiceExtension` meta-data,
  `MyApplication` init, `NotificationServiceExtension.kt`, `ONESIGNAL_APP_ID` buildConfig fields, `manifestPlaceholders`.
- Do not keep two push SDKs. Remove OneSignal completely.

### 1. Remove OneSignal
- Delete `buildSrc/src/main/java/OneSignal.kt` and `app/src/main/kotlin/<pkg>/NotificationServiceExtension.kt`.
- `Libs.kt`: remove `oneSignal`. `Versions.kt`: remove `oneSignal`.
- `app/build.gradle`: remove `implementation Libs.oneSignal`, both `ONESIGNAL_APP_ID` `buildConfigField` lines
  (defaultConfig and `buildTypes.each`), and the whole `manifestPlaceholders = [...]` block.
- `AndroidManifest.xml`: remove the `com.onesignal.NotificationServiceExtension` meta-data.
- `MyApplication.kt`: remove every `OneSignal.*` call and import. `FramesApplication(BuildConfig.ONESIGNAL_APP_ID)`
  becomes `FramesApplication()` (the OneSignal id was its only argument).

### 2. Gradle
`buildSrc/src/main/java/Versions.kt`
```kotlin
// Firebase
const val firebaseBom = "34.17.0"
const val googleServices = "4.4.4"
const val coreKtx = "1.15.0"
```
`buildSrc/src/main/java/Libs.kt`
```kotlin
// Firebase
const val firebaseBom = "com.google.firebase:firebase-bom:${Versions.firebaseBom}"
const val firebaseMessaging = "com.google.firebase:firebase-messaging"
const val firebaseAnalytics = "com.google.firebase:firebase-analytics"
const val coreKtx = "androidx.core:core-ktx:${Versions.coreKtx}"
```
`buildSrc/src/main/java/Plugins.kt`
```kotlin
const val googleServices = "com.google.gms:google-services:${Versions.googleServices}"
```
Root `build.gradle` (buildscript dependencies): add `classpath Plugins.googleServices`.

`app/build.gradle` dependencies:
```groovy
// Firebase Cloud Messaging (Push Admin) + Analytics
implementation platform(Libs.firebaseBom)
implementation Libs.firebaseMessaging
implementation Libs.firebaseAnalytics
implementation Libs.coreKtx
```
At the very bottom of `app/build.gradle` (conditional apply so the build does not fail before the JSON exists):
```groovy
// Needs this app's own google-services.json in app/ (Firebase console > Project settings > Your apps).
// Until the file exists the app still builds; push notifications simply stay off.
if (file('google-services.json').exists()) {
    apply plugin: 'com.google.gms.google-services'
}
```
Skip `firebase-analytics` if you do not want usage analytics (it is what feeds "active devices" in Firebase).
If you add it, mention it in the privacy policy / Play Data safety form.

### 3. Manifest
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```
On the launcher activity add `android:launchMode="singleTop"`. Inside `<application>`:
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

### 4. New files in `app/src/main/kotlin/<pkg>/notifications/`
Change `package` and the `MainActivity` / `R` imports to the pack's own.

**`NotificationLinkHandler.kt`** - only `http(s)` links with a host are opened.
```kotlin
package APP_PACKAGE.notifications

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

**`AppFirebaseMessagingService.kt`** - builds the notification when the app is in the foreground (FCM shows it
itself in background/killed state). Respects the Blueprint in-app "notifications" switch.
```kotlin
package APP_PACKAGE.notifications

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import APP_PACKAGE.MainActivity
import APP_PACKAGE.R
import dev.jahir.frames.extensions.context.color
import dev.jahir.frames.extensions.context.hasNotificationsPermission
import dev.jahir.frames.extensions.context.preferences
import java.net.HttpURLConnection
import java.net.URL

class AppFirebaseMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: getString(R.string.app_name)
        val body = message.notification?.body ?: message.data["body"] ?: return
        val url = message.data[NotificationLinkHandler.EXTRA_URL]

        // Respect the in-app "notifications" switch and the Android 13+ permission.
        if (!preferences.notificationsEnabled || !hasNotificationsPermission) return

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

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification) // white monochrome icon (OneSignal pack already has one)
            .setColor(color(R.color.accent))
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

    companion object {
        /** Must match MyApplication, the manifest meta-data and the panel's Channel ID. */
        const val CHANNEL_ID = "app_updates_channel"
    }
}
```

**`PushTopics.kt`** - audience topics. Skips safely when Firebase is not initialised; leaves every topic when the
user turns notifications off in the app.
```kotlin
package APP_PACKAGE.notifications

import android.content.Context
import androidx.core.content.pm.PackageInfoCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs

/** Keeps this device subscribed to the audience topics used by the Push Admin panel. */
object PushTopics {
    private const val PREFS = "push_topics"
    private val SLOTS = listOf("all", "version", "country", "timezone", "offset")

    fun sync(context: Context, enabled: Boolean = true) {
        // Firebase is not initialised when google-services.json is missing: do nothing instead of crashing.
        if (FirebaseApp.getApps(context).isEmpty()) return
        if (!enabled) {
            leaveAll(context)
            return
        }

        forgetCacheIfProjectChanged(context)
        swap(context, "all", "all")

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

    /**
     * Topic subscriptions belong to one Firebase project. If google-services.json now points at another
     * project, the remembered topics are stale, so forget them and subscribe again.
     */
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
        fcm.subscribeToTopic(topic).addOnSuccessListener {
            prefs.edit().putString(slot, topic).apply()
        }
    }

    private fun leaveAll(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val fcm = FirebaseMessaging.getInstance()
        for (slot in SLOTS) prefs.getString(slot, null)?.let { fcm.unsubscribeFromTopic(it) }
        prefs.edit().clear().apply()
    }
}
```

### 5. `MyApplication.kt`
```kotlin
package APP_PACKAGE

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import APP_PACKAGE.notifications.AppFirebaseMessagingService
import APP_PACKAGE.notifications.PushTopics
import dev.jahir.frames.extensions.context.preferences
import dev.jahir.frames.ui.FramesApplication

class MyApplication : FramesApplication() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        PushTopics.sync(this, preferences.notificationsEnabled)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(
                NotificationChannel(
                    AppFirebaseMessagingService.CHANNEL_ID,
                    "Updates & Announcements",
                    NotificationManager.IMPORTANCE_DEFAULT
                )
            )
        }
    }
}
```

### 6. `MainActivity.kt`
Keep the existing Blueprint base class. Add imports (`android.Manifest`, `android.content.Intent`,
`android.content.pm.PackageManager`, `android.os.Build`, `android.os.Bundle`, `android.util.Log`,
`androidx.activity.result.contract.ActivityResultContracts`, `com.google.firebase.FirebaseApp`,
`com.google.firebase.messaging.FirebaseMessaging`, `<pkg>.notifications.NotificationLinkHandler`) and these members:
```kotlin
private val notificationPermissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // App opened from a notification tap (background / killed)
    NotificationLinkHandler.handle(this, intent)

    // Debug builds only: print the FCM token for "Send test to token" (adb logcat -s FCM_TOKEN)
    if (BuildConfig.DEBUG && FirebaseApp.getApps(this).isNotEmpty()) {
        FirebaseMessaging.getInstance().token.addOnSuccessListener { Log.d("FCM_TOKEN", it) }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

// App already open (singleTop) and a notification is tapped
override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    NotificationLinkHandler.handle(this, intent)
}
```
If the pack already overrides `onCreate`, merge instead of duplicating.

### 7. Firebase file
Put the pack's own `google-services.json` in `app/` (Firebase console -> Project settings -> Your apps; the Android
app's package must equal `APP_PACKAGE`). Never invent or commit someone else's keys.

### 8. Build and verify
```bash
./gradlew :app:assembleDebug
```
Checklist: service + meta-data in the manifest, same channel id everywhere, `singleTop` set, `handle()` called in
`onCreate` and `onNewIntent`, `PushTopics.sync` runs at startup, no `onesignal` text left anywhere
(`grep -ri onesignal app buildSrc`).

Link handling can be tested without Firebase:
```bash
adb shell am start -n APP_PACKAGE/.MainActivity -e url https://example.com
```
`javascript:alert(1)` must open nothing and log "Ignored invalid url".

---

## Part B - Push Admin panel (per pack)

1. **Create a service account key for the pack's Firebase project:** Firebase Console -> Project settings ->
   Service accounts -> **Generate new private key**. Save the `.json` outside the repo. Never paste it into chat,
   commit it, or give it to an AI agent.
2. **Add the app in the panel:** Apps -> Add app. Package `APP_PACKAGE`, Default topic `all`, Channel ID
   `app_updates_channel`, then **Choose key file** and pick the `.json`. The Firebase Project ID (`PROJECT_ID`) fills
   in from the key. On save the panel checks the key with Firebase (nothing is sent) and stores it encrypted. There
   are no `gcloud` or IAM steps: Firebase's own `firebase-adminsdk` account can already send.
3. Open **App settings -> Check connection**. It should say **Connected**.
4. **Test:** run a debug build, open the app, read the token with `adb logcat -s FCM_TOKEN`, paste it into the panel's
   *Device token* field, give it a name and **Save device**, then **Send test to token**. Then send a real message to
   topic `all` (the panel asks you to type the app name for a send to everyone).
5. **Release** a version containing this change. Audience, country, time zone and local-time sends only reach users on it.
   Existing OneSignal subscribers get nothing from Push Admin until they update.
6. Delete the downloaded key file from your computer. The panel keeps its own encrypted copy.

If the key is rejected: it must come from the same Firebase project as this pack's `google-services.json`, and
**Firebase Cloud Messaging API (V1)** must be enabled (Google Cloud Console -> APIs & Services -> Library).

### Alternative: central account (no key per app)
The older method: one service account (stored as the server secret `FCM_SERVICE_ACCOUNT`) is granted a role in
every pack's Firebase project. Use it only if you cannot create keys (for example the organization policy
`iam.disableServiceAccountKeyCreation` is on).

1. Add the app in the panel without a key file. Open App settings -> Check connection -> "Service account used"
   (the panel's account, **not** the pack's own `firebase-adminsdk` account). PERMISSION_DENIED is expected until access is granted.
2. Grant access (terminal; needs the Google Cloud CLI and an Owner account of `PROJECT_ID`):
   ```bash
   gcloud auth list
   gcloud auth login
   gcloud config set account OWNER_EMAIL
   gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" --role="roles/firebasecloudmessaging.admin"
   gcloud projects get-iam-policy PROJECT_ID --flatten="bindings[].members" --filter="bindings.members:SERVICE_ACCOUNT_EMAIL" --format="value(bindings.role)"
   gcloud services enable fcm.googleapis.com --project=PROJECT_ID
   ```
   Keep the `serviceAccount:` prefix. Console alternative: Google Cloud Console -> `PROJECT_ID` -> IAM -> Grant access ->
   the email -> role **Firebase Cloud Messaging API Admin** (not the older "Firebase Cloud Messaging Admin").
3. Wait 1-2 minutes, then click Check connection until it says **Connected**.

## Troubleshooting

The `gcloud` / role rows below only apply to the central-account method.

| Symptom | Cause / fix |
|---|---|
| `Principal ... should appear as "user:..."` | You passed a plain email or the wrong one. The `--member` must be `serviceAccount:<panel service account email>` |
| `PERMISSION_DENIED ... cloudmessaging.messages.create` | Role not granted yet (or still propagating, wait 1-2 min), or granted to the wrong account |
| Policy modification failed / not permitted | Logged-in gcloud account is not an Owner of `PROJECT_ID`: `gcloud auth login` with the right account |
| `gcloud` not found | Install the Google Cloud CLI, reopen the terminal |
| Check connection OK but no notification | App not installed/subscribed, notifications switched off in the app or OS, or the token/topic is wrong; use "Send test to token" |
| Firebase "active devices" stays 0 | `firebase-analytics` missing, or data not processed yet (up to 24 h). DebugView: `adb shell setprop debug.firebase.analytics.app APP_PACKAGE` |
| Build fails on `google-services.json` | File missing or its package does not match `APP_PACKAGE` |
| Gradle: `Unable to establish loopback connection` | Sandbox/network restriction of the environment; build from a normal terminal / Android Studio |
