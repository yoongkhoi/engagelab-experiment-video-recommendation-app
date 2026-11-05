# EngageLab setup

Connect EngageVideo to one AppPush application and one data center. Use the AppPush console for the application you created. The values below come from the EngageLab docs, not from the computer's region.

## 1. Select the application

Open the AppPush application. App Information shows the AppKey, the masked Master Secret, and the Service Endpoint. The endpoint tells you which data center the app actually uses.

## 2. Copy the AppKey and Master Secret

- AppKey: a 24-character identifier. The Android SDK and the REST API both use it.
- Master Secret: click Show on the server that will call the REST API. Put it only in `backend/.env` as `ENGAGELAB_MASTER_SECRET`.

Do not put the Master Secret in Android resources, Gradle files, dashboard environment variables, source code, logs, or this documentation.

## 3. Choose the base URL from the console

| Console data center | REST base URL | Android `configAppSiteName` |
| --- | --- | --- |
| Singapore | `https://pushapi-sgp.engagelab.com` | `Singapore` |
| Virginia, USA | `https://pushapi-usva.engagelab.com` | `USA_Virginia` |
| Frankfurt | `https://pushapi-defra.engagelab.com` | `DEU_Frankfurt` |
| Hong Kong | `https://pushapi-hk.engagelab.com` | `HongKong` |
| Japan | `https://pushapi-jpn.engagelab.com` | Confirm the SDK site name in the current SDK guide. The older site list does not include Japan. |
| Brazil | `https://pushapi-bra.engagelab.com` | Confirm the SDK site name in the current SDK guide. |

Set the same choice in both places:

- `ENGAGELAB_BASE_URL` in `backend/.env`
- `ENGAGELAB_APP_SITE` in `android/engagelab.properties`

For Singapore also set `ENGAGELAB_SITE_TIMEZONE=Asia/Singapore`. `zone_type` 1 means the scheduled clock time is interpreted in the main-site timezone.

If the console endpoint is not Singapore, change the base URL, the Android site name, and the timezone together. A push to the wrong host fails authentication or never reaches the device.

## 4. Bind the Android package name

In Integration Settings, set the Android package name to:

`com.example.engagevideopush`

The Gradle `applicationId` uses that same value. A mismatch is a common reason the Registration ID never appears.

## 5. SDK configuration

`android/engagelab.properties` supplies the AppKey. Gradle writes it to:

- the manifest placeholder `ENGAGELAB_PRIVATES_APPKEY`
- `MTCorePrivatesApi.configAppKey` before `MTPushPrivatesApi.init`

The integration also registers:

- `UserService` extending `MTCommonService` in the `:remote` process
- `UserReceiver` extending `MTCommonReceiver`
- `ENGAGELAB_PRIVATES_TRANSFER` = `com.example.engagevideopush.MainActivity`

The dependency is `com.engagelab:engagelab:5.4.0`, the version named in the current channel integration guide. Maven Central also publishes newer 5.x builds. This project stays on 5.4.0 so the documented classes (`MTPushPrivatesApi`, `MTCorePrivatesApi`, `MTCommonReceiver`, `MTCommonService`) match the guide used here.

Channel and process placeholders:

- `ENGAGELAB_PRIVATES_CHANNEL=developer`
- `ENGAGELAB_PRIVATES_PROCESS=:remote`

## Push delivery with the SDK that is actually included

The Android app depends on `com.engagelab:engagelab:5.4.0` only. That is the EngageLab core SDK. The Gradle file does not include Firebase Cloud Messaging or a manufacturer channel SDK (Huawei, Xiaomi, OPPO, vivo, Honor, Meizu).

What the core SDK documentation supports:

- A long connection in the `:remote` process (`MTCommonService`).
- A Registration ID from `MTCorePrivatesApi.getRegistrationId` after `onConnectStatus(true)`.
- Notification display through the EngageLab channel, including while the app is in the foreground. The Create Push API says foreground display is the default since Android SDK 4.3.1 (`display_foreground` defaults to showing the notification). This project does not set that field.
- A click that opens the activity named in `notification.android.intent.url`, with business fields in `notification.android.extras`. SDK 3.4.0 and later also places the notification JSON in the `message_json` intent extra.

What is not provided by the current dependency, and therefore is not a claimed capability:

- Delivery after the app process and the `:remote` process have been killed, unless EngageLab's own channel can still reach the device. Vendor and FCM channels are separate products and are not configured here.
- Adding those SDKs without the matching console vendor parameters would not make delivery work.

Confirm on a real device before treating any of the following as done: the Registration ID appears, a notification is visible in the foreground, the same notification is visible after pressing Home, and whether anything arrives after force-stop. API acceptance (`msg_id`) is not that confirmation.

## 6. Obtain a Registration ID

1. Install the debug APK.
2. Allow notifications on Android 13 or newer.
3. Open Device.
4. Wait until the connection row says connected.
5. The Registration ID row shows the value from `MTCorePrivatesApi.getRegistrationId`. The app does not invent one.
6. Logcat tag `EngagePush` prints the length, not a second copy of any secret. There is no secret in the app.

The app then calls `POST /api/devices/register`. That stores the ID locally. `tagSyncStatus` is the only field that describes a server-side EngageLab device call.

## 7. Send a test notification

1. Confirm the dashboard banner says Live EngageLab mode.
2. Compose a push to that Registration ID, or call `POST /api/engagelab/test-push` with the admin key.
3. A successful response includes `msg_id` and status `accepted_by_provider`.
4. The phone should show a notification on channel `engage_video_push`. Tapping it opens MainActivity. The payload extras are `video_id`, `campaign_id`, and `category`. The click intent is:

```text
intent:#Intent;action=com.example.engagevideopush.ACTION_OPEN;component=com.example.engagevideopush/com.example.engagevideopush.MainActivity;...;end
```

From SDK 3.4.0 onward, the opened activity reads `intent.getStringExtra("message_json")`. The receiver also reads `NotificationMessage.extras`.

## 8. Check that the provider accepted the request

`accepted_by_provider` and a non-empty `providerMsgIds` array mean the create-push call returned `msg_id`. A scheduled task instead returns `schedule_id` and status `scheduled`.

Those values do not prove the device displayed or opened the notification. Opens are counted only after the app posts `notification_opened`.

`GET /api/engagelab/status` calls `GET /v4/tags/` and reports whether authentication worked. It does not send a push. A direct probe of that endpoint with the configured Singapore host succeeded in this workspace and returned a small tag list. No push was sent.

## 9. When a push fails

Read `errorKind` on the campaign:

- `authentication`: AppKey, Master Secret, or data-center host is wrong
- `validation`: the provider rejected the JSON or the Registration ID
- `timeout` or `network`: the server could not reach EngageLab
- `configuration`: credentials are incomplete, so live mode is off

The stored provider body is scrubbed of the Master Secret and the Basic credential.
