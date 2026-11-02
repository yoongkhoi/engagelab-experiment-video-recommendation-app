# Demo script

Plan on eight minutes. Say which steps used the live EngageLab API and which used the phone.

## 1. Launch the Android app (30 seconds)

Open EngageVideoPush. Show the feed: Technology, Funny, and Lifestyle, each with a description and Play. If the backend is down, the offline banner is explicit and the bundled catalogue still plays.

## 2. Register the device (45 seconds)

Open Device. Point out SDK status, the data-center site, notification permission, and the app version. Wait until the connection is up. The Registration ID is the value returned by `MTCorePrivatesApi.getRegistrationId`. If it is empty, say that and do not invent one.

## 3. Show the stored device (30 seconds)

Open the dashboard and sign in with `ADMIN_API_KEY`. On Devices, reveal the same Registration ID. Read `tagSyncStatus`. Synced means `GET /v4/devices/{registration_id}` showed the category tags. Failed or skipped is not success.

## 4. Create and send a campaign (90 seconds)

Compose a push:

- Video `1001`
- A title and message you can recognize on the phone
- Targeting: that Registration ID
- Delivery: send now

Read the result. In live mode the status is `accepted_by_provider` and a `msg_id` is present. Say that this is API acceptance, not proof of display. In demo mode the banner says simulated and no request was made.

## 5. Receive and tap (60 seconds)

On the phone, show the notification. Tap it. The player opens video `1001`. Mention the extras `video_id`, `campaign_id`, and `category`, and that `message_json` is how SDK 3.4+ delivers the click payload.

If you have time, force-stop the app and tap the notification again so the cold start is visible.

## 6. Events (30 seconds)

Return to Overview. Notification opens and play starts come from `POST /api/events`. The provider delivery card stays unavailable. Do not quote a click-through rate.

## 7. Schedule (45 seconds)

Compose the same video with delivery scheduled. Use a clock time a few minutes ahead in the data-center timezone, for example `Asia/Singapore` when the base URL is Singapore. History should show `scheduled` and a `schedule_id` from `POST /v4/schedules`. The task is stored by EngageLab, not by a timer in Node.

## 8. Categories (45 seconds)

On the phone, leave only Funny selected and save. In the dashboard, send a category campaign for `tech`. It must not include this device. Send one for `funny` and it should. If you use tag mode, read the confirmation: EngageLab delivers to every device that has the tag under this AppKey.

## 9. A/B experiment (45 seconds)

Start the experiment on the A/B page. Explain the hash bucket: one device, one variant. With a handful of phones the result says preliminary and does not claim significance.

## 10. Close (20 seconds)

Separate what was verified:

- Live: EngageLab accepted `POST /v4/push` or `POST /v4/schedules` and returned an id. Tag status was confirmed with a device read.
- On device: the Registration ID, the notification, the tap, and the playback events.
- Not claimed: provider delivery rate, click-through rate, or statistical significance without 30 devices per variant.
