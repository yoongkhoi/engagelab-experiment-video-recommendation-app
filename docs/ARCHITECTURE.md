# Architecture

EngageVideo is three runtimes plus EngageLab and Pixabay. The Android app plays videos and reports a Registration ID the SDK already issued. The Node API stores accounts, devices, campaigns, and events. The Python service recommends Pixabay videos and does not send pushes. The React dashboard operates the API. Only the Node process holds the EngageLab Master Secret.

## Request path

`src/app.ts` builds Express, SQLite, and the services. Validation lives in `src/validators/schemas.ts`. Admin routes require `Authorization: Bearer <ADMIN_API_KEY>`. Device preference updates and events require `Authorization: Device <deviceToken>` issued at registration.

Business rules sit in the services:

- audience resolution refuses to turn a missing category or an unknown Registration ID into a broadcast
- interest targeting matches saved account categories, then uses that account’s stored Registration IDs
- campaign submission is separate from device delivery
- tag sync is successful only after `GET /v4/devices/{registration_id}` shows the expected tags
- experiments assign each real Registration ID to one variant with SHA-256
- simulated experiment users are stored apart from `experiment_assignments` and are not counted as recipients

`src/integrations/engagelabClient.ts` calls the documented v4 paths with HTTP Basic `base64(AppKey:MasterSecret)`, a timeout, and secret scrubbing.

## EngageLab calls

| Action | Method and path |
| --- | --- |
| Push | `POST /v4/push` |
| Read or set device tags | `GET` or `POST /v4/devices/{registration_id}` |
| Add devices to a tag if the tag does not exist yet | `POST /v4/tags/{tag_value}` |
| One-time schedule | `POST /v4/schedules` with `trigger.single` |
| Read a schedule | `GET /v4/schedules/{schedule_id}` |
| Credential probe | `GET /v4/tags/` |

Android custom data is `notification.android.extras` with string values `video_id`, `campaign_id`, and `category`. The click target is `notification.android.intent.url`. `builder_id` is omitted so the SDK uses the system notification style. The sample value `1` in the EngageLab examples is for apps that registered a custom layout.

Category targeting resolves stored devices and sends `to.registration_id`. Tag targeting is a separate mode. It syncs tags first and then sends `to.tag`. It requires `acknowledgeTagScope` because EngageLab can include devices that are not in SQLite. Broadcast requires `confirmBroadcast` and sends `to: "all"` with `platform: "android"`.

Scheduled tasks are created with EngageLab, not with `setTimeout`, so they survive a process restart. `zone_type` 1 uses the main-site clock. The API stores the wall time exactly as `yyyy-MM-dd HH:mm:ss`.

## Data

SQLite holds the push records `videos`, `devices`, `campaigns`, `experiments`, `experiment_assignments`, `experiment_simulations`, `experiment_test_sends`, and `events`. Account and recommendation records include `users`, `user_preferences`, `user_profiles`, `favorites`, `watch_history`, `ai_conversations`, `ai_messages`, `recommendation_feedback`, `notification_preferences`, `notification_deliveries`, `library_entries`, `library_campaigns`, and `push_decisions`.

Campaign status is one of `draft`, `scheduled`, `submitted`, `accepted_by_provider`, `simulated`, `failed`, `unknown`. `simulated` is used only when credentials are absent. It is never reported as provider acceptance.

Events from the phone use source `device`. A provider-accepted immediate push records `push_submitted` with source `server`. Analytics do not mix those into a delivery rate. Provider delivery statistics are reported as unavailable.

## A/B tests

`assignVariant` hashes `experimentId:registrationId` and buckets the first four bytes modulo 100. The same device stays in one variant. The primary key on assignments prevents a second row. Start requires at least two real stored devices and sends nothing when either variant would be empty. Results use a two-proportion z-test only when both variants have at least 30 real devices. Smaller samples are marked preliminary and `significant` is null. A simulation writes `experiment_simulations` only. A single-device test send does not insert an assignment.

## Android

One `MainActivity` in `singleTask` handles launcher starts and notification clicks. `PushPayloadParser` reads `message_json`, manufacturer extras (`MTMessageExtra`, `JMessageExtra`), and direct string extras. `NotificationOpenDeduper` ignores a repeated key for five seconds.

The player releases ExoPlayer in `DisposableEffect.onDispose`.

## What is intentionally local

SQLite and a single Node process are for the demo. Production would move credentials to a secret manager, put the API behind TLS, replace SQLite with a shared database, and add app attestation instead of treating the Registration ID as the device credential.
