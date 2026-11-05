# API reference

HTTP contract for the EngageVideo backend. Behavior and limits are summarized in `README.md`. This file does not repeat credentials.

Base URL: `http://localhost:3000`

Machine-readable spec: `GET /api/openapi.yaml`

Admin routes need `Authorization: Bearer <ADMIN_API_KEY>`. Device routes need `Authorization: Device <deviceToken>`.

Error bodies look like:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.", "details": [] } }
```

## Public

### GET /api/health

`{ "ok": true, "database": "up", "service": "engagevideopush-backend" }`

### GET /api/config/status

Returns `mode` (`live` or `demo`), `engagelabConfigured`, `knownDataCenter`, and `deliveryMetricsAvailable: false`. No secrets.

### GET /api/videos

Active videos. `?all=1` with the admin key includes inactive videos.

### GET /api/videos/:id

One video, including inactive. `404 VIDEO_NOT_FOUND` when missing.

### POST /api/devices/register

```json
{
  "registrationId": "sdk-registration-id",
  "platform": "android",
  "categories": ["tech", "funny"],
  "appVersion": "1.0.0"
}
```

Creates or updates the device. Returns `device`, `deviceToken`, `created`, and a note that this call did not mint the Registration ID. `tagSyncStatus` is `synced`, `failed`, `skipped`, or `unknown`.

## Admin video routes

### POST /api/videos

Body: `title`, `description`, `category` (`tech`, `funny`, `lifestyle`), `sourceType` (`remote` or `asset`), `source`, optional `id`, `assetFilename`, `thumbnailUrl`, `active`. Remote sources must be `https`. Duplicate ids return `409`.

### PUT /api/videos/:id

Same body. Replaces metadata.

### DELETE /api/videos/:id

Deletes the row when no campaign references it. Otherwise deactivates it and returns `{ "deleted": false, "deactivated": true, "video": {} }`.

## Admin device routes

### GET /api/devices and GET /api/devices/:id

List or fetch devices. The id may be the internal id or the Registration ID. Responses include a masked Registration ID as well as the full value the operator needs for a test push. The device token is not listed.

### PUT /api/devices/:id/preferences

Admin bearer token or device token.

```json
{ "categories": ["lifestyle"] }
```

Saves categories and attempts EngageLab tag sync.

### POST /api/devices/:id/sync-tags

Admin only. Retries tag sync and returns the device. A failure stays `failed`.

## Campaigns

### POST /api/campaigns

```json
{
  "name": "Evening pick",
  "videoId": "1001",
  "title": "Watch this",
  "message": "A short video is ready.",
  "targeting": {
    "mode": "category",
    "categories": ["tech"],
    "confirmBroadcast": false,
    "acknowledgeTagScope": false
  },
  "delivery": "immediate"
}
```

`delivery` is `draft`, `immediate`, or `scheduled`. Scheduled delivery also needs `scheduleTime` (`yyyy-MM-dd HH:mm:ss`), `timeZone`, and optional `zoneType` (`1` or `2`).

Target modes:

- `registration_id` with `registrationId`
- `registration_ids` with `registrationIds`
- `category` with `categories` (stored devices only)
- `tag` with `categories` and `acknowledgeTagScope: true`
- `broadcast` with `confirmBroadcast: true`

`422 TARGET_EMPTY` means nobody matched and the push was not widened. `400 BROADCAST_CONFIRMATION_REQUIRED` and `400 TAG_SCOPE_CONFIRMATION_REQUIRED` stop the send. Unknown videos are `404`. Inactive videos are `409`.

A live success returns `simulated: false` and status `accepted_by_provider` or `scheduled`. Demo mode returns `simulated: true` and status `simulated`. Provider failures are `502` with the failed campaign in `details.campaign`.

### GET /api/campaigns and GET /api/campaigns/:id

History. `?refresh=1` loads `GET /v4/schedules/{schedule_id}` when a schedule id exists.

### POST /api/campaigns/:id/send

Sends a draft. Optional body `{ "confirmBroadcast": true, "acknowledgeTagScope": true }`.

### POST /api/campaigns/:id/schedule

```json
{
  "scheduleTime": "2030-01-15 09:30:00",
  "timeZone": "Asia/Singapore",
  "zoneType": 1
}
```

Past times for zone type 1 return `400 SCHEDULE_IN_THE_PAST`.

## Experiments

### POST /api/experiments

```json
{
  "name": "Title test",
  "videoId": "1001",
  "variantA": { "title": "A", "message": "Message A" },
  "variantB": { "title": "B", "message": "Message B" },
  "targeting": { "mode": "registration_ids", "registrationIds": ["id-one", "id-two"] },
  "allocationA": 50,
  "durationHours": 48,
  "primaryMetric": "notification_opened"
}
```

`allocationA` is 1 through 99. `primaryMetric` is `notification_opened` or `video_play_started`.

### GET /api/experiments and GET /api/experiments/:id

Detail includes `results` with sample sizes, the measurement window, and statistics. `preliminary: true` means significance was not calculated.

### POST /api/experiments/:id/preview

Returns the real-device split and both notification texts. `engageLabCalled` is false. Fewer than two real devices is reported in `warning` and does not send.

### POST /api/experiments/:id/simulate

```json
{ "syntheticUsers": 60 }
```

Stores a labelled synthetic split. The response sets `countedAsRealRecipients`, `countedAsDelivered`, and `countedAsCtr` to false. EngageLab is not called. Real result sample sizes stay unchanged.

### POST /api/experiments/:id/test-send

```json
{ "variant": "A", "registrationId": "stored-id", "confirm": true }
```

Sends one variant to one stored device. `confirm` must be true. The send is not inserted into `experiment_assignments`, so it does not change the A/B sample. `deviceDeliveryVerified` is false.

### POST /api/experiments/:id/start

Assigns real devices, stores the assignment, and sends two registration-id campaigns. Broadcast experiments are rejected. Fewer than two real devices returns `422 INSUFFICIENT_AUDIENCE` and sends nothing. If every device lands in one bucket, nothing is sent and the response is `422 EXPERIMENT_VARIANT_EMPTY`. A second activation of the same experiment returns `409` and does not send again.

Dashboard steps, dry run, and the one-device limits are in [ADMIN_QA.md](ADMIN_QA.md).

## Events and analytics

### POST /api/events

Device token required. `registrationId` must belong to that token.

```json
{
  "eventType": "video_play_started",
  "registrationId": "sdk-registration-id",
  "videoId": "1001",
  "campaignId": "11111111-1111-4111-8111-111111111111",
  "dedupeKey": "video_play_started:device:campaign:1001"
}
```

`eventType` is `device_registered`, `push_submitted`, `notification_opened`, `video_opened`, `video_play_started`, or `video_play_completed`. A repeated `dedupeKey` returns the original event with `duplicate: true`.

### GET /api/analytics/overview

Counts from SQLite, plus source descriptions. `provider.deliveryMetricsAvailable` is false.

### GET /api/analytics/campaigns

Per campaign: provider ids and device event counts. The definition text states that opens are app-reported.

### GET /api/analytics/videos

Play counts per video.

### GET /api/analytics/experiments

One result object per experiment.

## Provider helpers

### GET /api/engagelab/status

When credentials exist, probes `GET /v4/tags/`. On failure the error kind distinguishes authentication, network, and timeout. Demo mode returns `connected: false` and does not pretend otherwise.

### POST /api/engagelab/test-push

```json
{ "registrationId": "sdk-registration-id", "videoId": "1001" }
```

This is an explicit operator action. It creates and sends a campaign. It is not called at startup.
