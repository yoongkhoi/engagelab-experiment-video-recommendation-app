# Troubleshooting

## SDK initialization failed

Logcat, process `:remote`, will show EngageLab debug lines when `configDebugMode` is on. If Device says `not_configured`, `engagelab.properties` has no 24-character AppKey and `init` was not called.

## Registration ID stays empty

- The package name in the console must be `com.example.engagevideopush`.
- `ENGAGELAB_APP_SITE` must be the site for the same data center as `ENGAGELAB_BASE_URL`.
- The device needs a network path to EngageLab. An emulator without DNS will not connect.
- Wait for `onConnectStatus(true)`. Calling `getRegistrationId` earlier often returns an empty string. Use Refresh on the Device screen after the connection row changes.
- The app will not fill in a placeholder ID.

## AppKey and package mismatch

The manifest placeholder `ENGAGELAB_PRIVATES_APPKEY` and `configAppKey` must be the AppKey of the application whose Android package is `com.example.engagevideopush`. A test-environment AppKey is not the live AppKey.

## Authentication failures

`errorKind: authentication` or HTTP 401/403 from EngageLab means the AppKey, Master Secret, or host does not belong together. Resetting the Master Secret in the console invalidates the old value immediately. Update `backend/.env` and restart.

## Wrong data center

A request to Singapore will not see devices registered in Virginia. Compare the console Service Endpoint with `ENGAGELAB_BASE_URL` and with the Android site name. The server logs a warning when the host is not one of the documented push hosts.

## Invalid REST body

`errorKind: validation` includes the provider `code` and `message`. Common causes are a Registration ID from another AppKey, a schedule time that is not `yyyy-MM-dd HH:mm:ss`, a schedule name with characters outside letters, numbers, underscores, and Chinese characters (the backend rewrites the provider task name), or `enabled: false`. This project sends `enabled: true`.

## The device does not show the notification

- `msg_id` only proves API acceptance. It does not prove display.
- Android 13+ notification permission must be granted. The Device screen shows the state. Denying the prompt leaves the EngageLab connection able to register while the shade stays empty.
- The included SDK is the EngageLab core channel only. There is no FCM or manufacturer dependency. A force-stopped app may not receive the notification. That limitation is in the build, not something the parser can fix.
- With the app in the foreground, the Create Push API default is to show the notification. If it does not, capture Logcat for `EngagePush` and the `:remote` process before changing payload code.
- After Home, the `:remote` process is the documented path. Battery optimizations can still block it.
- `time_to_live` is 86400 seconds. After that the provider can drop the message.
- Category sends only go to Registration IDs stored for that category. An empty audience returns `422` instead of a broadcast.
- Tag sends run only after a device read confirms the tag. Status `unknown` or `failed` cancels the tag push.

## Click does nothing

- The activity must stay `singleTask` so `onNewIntent` runs.
- `ENGAGELAB_PRIVATES_TRANSFER` must list `com.example.engagevideopush.MainActivity`.
- The push must include `notification.android.intent.url` and `extras.video_id`.
- Log `message_json` on the activity. Manufacturer messages may use `MTMessageExtra` or `JMessageExtra`; the activity reads those too.
- A repeated tap inside five seconds is ignored on purpose.

## Video playback fails

Add `android/app/src/main/assets/videos/tech.mp4` (and the funny and lifestyle files) or keep the HTTPS sample URLs. Playback errors from ExoPlayer are shown on the player screen. The sample hosts require internet.

## CORS and ports

The dashboard dev server proxies `/api` to `http://localhost:3000`. Direct browser calls are allowed from `CORS_ORIGIN` (default `http://localhost:5173`). If port 3000 is taken, change `PORT` and the dashboard proxy in `dashboard/vite.config.ts`.

## Gradle or Node errors

- Backend and dashboard need Node.js 22.13 or newer because they use `node:sqlite`.
- Android needs JDK 17 and SDK 35. `JAVA_HOME` and `ANDROID_HOME` must be set before `gradlew.bat`.
- The first Gradle run downloads the wrapper distribution and Maven artifacts, including `com.engagelab:engagelab:5.4.0`.
