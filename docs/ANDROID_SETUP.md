# Android setup

## Android Studio

- Android Studio with Android Gradle Plugin 8.7.3 support
- JDK 17
- Android SDK platform 35 and matching build-tools
- A device or an emulator with Google Play or another image that can reach the internet

## Gradle

Open the `android` directory. `engagelab.properties` is gitignored and holds:

```properties
ENGAGELAB_APPKEY=
ENGAGELAB_APP_SITE=Singapore
BACKEND_LAN_HOST=
BACKEND_PORT=3000
```

Leave `BACKEND_LAN_HOST` blank. The debug build reads this computer's current LAN IPv4. The running app then chooses the URL:

- Emulator: `http://10.0.2.2:<BACKEND_PORT>`
- Phone or tablet: `http://<that LAN address>:<BACKEND_PORT>`

`BACKEND_PORT` must be the same number as `PORT` in `backend/.env`. The backend listens on `0.0.0.0`. If the computer's address changes, rebuild or type the new URL on the Device screen. `10.0.2.2` works only inside the emulator. Release builds do not allow cleartext HTTP.

The first screen is email sign-in. The backend emails a code only when SMTP is configured. With `AUTH_EMAIL_MODE=test`, the server records the request and does not send mail.

Build:

```powershell
cd android
.\gradlew.bat assembleDebug
.\gradlew.bat test
```

`scripts/build-android.ps1` runs `assembleDebug test` when `JAVA_HOME` and `ANDROID_HOME` are set.

## SDK integration

`EngageApplication.onCreate` calls, in order, when the AppKey is 24 characters:

1. `MTCorePrivatesApi.configDebugMode`
2. `MTCorePrivatesApi.configAppKey`
3. `MTCorePrivatesApi.configAppSiteName`
4. `MTPushPrivatesApi.init`

`UserReceiver.onConnectStatus(true)` reads `MTCorePrivatesApi.getRegistrationId` and registers it with the backend. If the ID is empty, the Device screen says so. The app does not substitute a fake ID.

## Notifications

The app creates channel `engage_video_push` at importance high. Pushes set `channel_id` to that value. Android 13 and newer prompt for `POST_NOTIFICATIONS`. On older versions the Device screen reports the permission as granted because the runtime prompt does not exist.

Only `com.engagelab:engagelab:5.4.0` is on the classpath. The EngageLab documentation describes that artifact as the core channel. It does not include FCM or a manufacturer SDK. Those are separate integrations and are not part of this project.

Documented core-SDK behavior, still requiring a device to confirm:

- Foreground: notifications are shown by default from SDK 4.3.1. This app does not send `display_foreground`, so it uses that default.
- Background: the `:remote` process keeps the EngageLab connection. Pressing Home leaves that process eligible to receive a notification. Battery restrictions can delay or drop it.
- Killed process: force-stop can remove both the app and `:remote`. Nothing in this repository registers FCM or a vendor channel, so a notification after force-stop is not an implemented capability. Test it on a device and record what happened. Do not treat a missing notification as a parser bug until Logcat shows whether the SDK received it.

## What to test on a device

1. Allow the notification prompt. The Device screen should say granted.
2. Wait until `onConnectStatus` is true. The Registration ID row must show the SDK value. Logcat tag `EngagePush` prints the length, not the id.
3. Confirm the same id on the dashboard Devices page. Tag sync `synced` means a follow-up device read contained the selected categories. `failed` and `unknown` are not success.
4. Send one registration-id push for video `1001`. Confirm `msg_id`, then look at the phone. That is the delivery check.
5. Tap once with the app open, once after Home, and once after force-stop. The player should open `1001` at most once per tap. A second delivery of the same video and campaign within five seconds does not navigate again.

## Device or emulator

1. Start the backend on port 3000.
2. Start an emulator, or enable USB debugging on a phone.
3. Install the debug APK.
4. Open the app and allow notifications.
5. Watch Logcat for the tag `EngagePush`. Filter the main process and the `:remote` process. SDK logs are often in the remote process.

## Verify registration

The Device screen should move from `initialized` to a connected state and then show a Registration ID. Backend should change to `stored`. Tag sync is `synced`, `failed`, `skipped`, or `unknown`. `skipped` means the backend has no EngageLab credentials. `failed` is not success.

## Deep link test

Send a campaign for video `1001`. Tap the notification:

- while the app is in front
- after pressing Home
- after swiping the app away

The player should open video `1001`. A second delivery of the same message within five seconds does not navigate twice. A payload without `video_id` opens an explanation screen instead of a player.

Playback uses `assets/videos/<file>` when that MP4 exists, otherwise the HTTPS sample URL. Missing local files are expected until you add them.
