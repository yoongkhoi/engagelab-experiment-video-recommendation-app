# Interview guide

## How the phone gets a Registration ID

`EngageApplication` configures the AppKey and site, then calls `MTPushPrivatesApi.init`. The SDK opens its own connection from `UserService` in the `:remote` process. When `UserReceiver.onConnectStatus` is true, `MTCorePrivatesApi.getRegistrationId` returns the device id. The app posts that string to the backend. The server cannot create this id. The REST device API documentation says the same thing.

## How a push reaches the phone

The dashboard calls the backend. The backend resolves the audience, builds `POST /v4/push`, and authenticates with Basic base64 of `AppKey:MasterSecret`. EngageLab accepts the request and returns `msg_id`. EngageLab's connection, or a vendor channel if one were integrated, delivers the notification. This demo integrates the EngageLab channel package only, not Xiaomi, Huawei, or FCM. Delivery after `msg_id` is outside the API response.

## How REST authentication works

Every v4 call sends `Authorization: Basic <base64(appKey:masterSecret)>`. The client in `engagelabClient.ts` builds that header and never logs it. A 401, 403, or provider auth code is classified as authentication rather than as a successful send.

## Why the Master Secret stays on the server

Anyone with the Master Secret can push to every device of the application. The APK and the dashboard JavaScript are visible to users. The secret is loaded from `backend/.env`, which is gitignored, and responses scrub it if a provider body echoes it.

## How a tap opens one video

The push sets `notification.android.extras` to `video_id`, `campaign_id`, and `category`, and sets `intent.url` to an explicit component intent for `MainActivity`. On click, SDK 3.4+ puts JSON in `message_json`. The activity also reads direct extras and manufacturer extras. `PushPayloadParser` finds `video_id` and navigation opens `player/{videoId}`. A missing or malformed id does not start playback. A five-second dedupe key stops the receiver and the intent from opening the player twice.

## How segmentation works

Device rows still store the original tags `tech`, `funny`, and `lifestyle`. Compose interest targeting also matches categories saved on the signed-in account, then sends to that account’s stored Registration IDs. If none match, the API returns 422 and does not send `to: "all"`. Tag mode is separate: the server calls `POST /v4/devices/{registration_id}` with `tags.add` and `tags.remove`, then reads the device back. Only a confirmed tag set is followed by `to.tag`. The operator must acknowledge that a tag audience can be larger than the local table.

## How schedules work

`POST /v4/schedules` creates a one-time task with `enabled: true`, `trigger.single.time`, and `zone_type`. Zone type 1 is the main-site clock, so the dashboard asks for an IANA timezone and the backend rejects a time that is already past in that zone. The returned `schedule_id` is stored. Restarting Node does not cancel the provider task. This project does not also run a local timer.

## How A/B testing works

Each variant is a real campaign with its own title and message, sent only to the Registration IDs in that bucket. The bucket is `SHA-256(experimentId + ":" + registrationId)` modulo 100, compared with the allocation. The assignment table's primary key is the experiment plus the Registration ID, so a device cannot be in both variants. The result screen shows sample size and the measurement window. A z-test is reported only at 30 or more devices per variant.

## How delivery and clicks are measured

`msg_id` means the create-push API accepted the JSON. `notification_opened`, `video_opened`, `video_play_started`, and `video_play_completed` are rows the app posts. The overview labels those sources. EngageLab delivery and click callbacks are not configured here, so those rates are shown as unavailable instead of estimated.

## How to troubleshoot a missing notification

Check permission, the package name, the data center pair, the Registration ID, and the campaign error kind. Then separate "API rejected the call" from "API accepted it and the device did not draw it." Logcat in both the main process and `:remote` is the SDK side. The campaign row's scrubbed provider body is the API side.

## How provider failures are handled

Timeouts, network errors, auth failures, and validation failures are different `errorKind` values. The campaign is stored as `failed` with the provider body. The HTTP response is 502, not 200. A missing `msg_id` is not treated as acceptance. Demo mode never uses `accepted_by_provider`.

## How this could scale

The audience query and the SQLite file are the first limits. A production version would use a shared database, queue push batches of at most 1000 Registration IDs, and keep the EngageLab calls in a worker with the documented rate limit in mind (the overview quotes a standard 500 QPS cap). Vendor-channel Gradle modules would be added per manufacturer, matching the 5.4.0 plugin artifacts, only after those vendor apps exist.

## What production would change

TLS on the API, a secret manager instead of `.env`, shorter-lived operator sessions, device attestation instead of "whoever knows the Registration ID can re-fetch the device token", notification channel policy, minify rules that keep the SDK, removal of cleartext traffic, and a confirmed data-center pair per environment. Broadcast would stay behind an explicit confirmation. Delivery metrics would come from EngageLab callbacks, stored separately from app events.
