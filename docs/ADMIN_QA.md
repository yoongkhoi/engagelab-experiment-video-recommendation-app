# Admin QA: experiments, library activation, and one device

This is the operator workflow for the dashboard at `http://localhost:5173`. The backend is `http://localhost:3000`. Sign in with the admin API key. Do not paste Registration IDs, the admin key, or provider secrets into notes or chat.

The dashboard does not show the video-library page in the current version. `/library` returns to Overview. The library HTTP API below remains available for automated tests. Do not treat it as a visible operator screen.

No step below proves that a phone displayed a notification. `deviceDeliveryVerified` stays false until you see the notification on the device.

## States

Library video:

| State | Meaning |
| --- | --- |
| draft | Saved from Pixabay. No push. |
| published | Eligible for matching. Publishing still does not send. |

Library campaign, created when a video is published:

| State | Meaning |
| --- | --- |
| draft | Created. No push has been submitted. |
| active | Activate submitted a targeted campaign or queued a digest. This is not device delivery. |
| paused | Further sends for that campaign are blocked. |
| completed | Activate found no further immediate recipient. |

Push delivery rows use a different set: `queued`, `simulated`, `accepted_by_provider`. An app event can later record `notification_opened`. Provider acceptance is not `delivered`.

## Library: search, publish, dry run, activate

1. Open **Video library**.
2. Search Pixabay and choose **Add to library**. Expected: a draft row. Nothing is sent.
3. Choose **Publish**. Expected: the video becomes `published`, a campaign row appears as `draft`, and the message says no push was sent.
4. Choose **Preview**. Expected: matched users, eligible devices, excluded users, and queued users, with reasons such as `opted_out`, `quiet_hours`, `duplicate`, `frequency_cap`, or `no_registered_device`. `sent` stays false.
5. Choose **Dry run**. Expected: `EngageLab called=false` and `Sent=false`. Topics come from the saved category and keywords. The decision is stored and no notification is sent.
6. On the draft campaign, choose **Activate**, read the confirmation, then choose **Confirm activate**. Expected: only eligible matched devices are submitted. There is no broadcast fallback.
7. Choose **Confirm activate** again. Expected: `Sent=0`, `EngageLab called=false`, and the message says no duplicate push was created.

Endpoints:

- `POST /api/library`
- `POST /api/library/:videoId/publish`
- `POST /api/library/:videoId/preview`
- `POST /api/library/:videoId/dry-run`
- `POST /api/library/campaigns/:id/activate` with `{ "confirm": true }`
- `POST /api/library/campaigns/:id/pause`

Database:

- `library_entries.library_state` moves from `draft` to `published`.
- `library_campaigns.status` moves from `draft` to `active`, `paused`, or `completed`.
- `notification_deliveries` gains one row per recipient. A repeat activation does not insert another row for the same user and video.
- `push_decisions` records publish, dry run, and activation with the topic list, action, and reason. `engage_lab_called` is 0 for dry run.

Automatic matching does not send during development. Publish never sends. The `automatic campaigns` checkbox only saves policy. `server.ts` starts the digest timer only when `SCHEDULER_ENABLED=true`, and that timer releases queued rows only when `SCHEDULER_CONFIRM=true` as well. Leave both unset.

Matching uses every saved interest that appears in the video category, keywords, or derived topics. A user is excluded when notifications are off, the category filter does not match, the video was watched or dismissed, no device is registered, the same user and video was already sent, quiet hours apply, or the daily or interval cap is reached. Those reasons are stored. Users without a device are not replaced by a broadcast.

## A/B experiments

1. Open **A/B tests**. The page states that one real device cannot validate a statistically meaningful test.
2. Enter a name, choose an active video, and give variant A and variant B different title or message text. Set allocation from 1 to 99 and duration from 1 to 720 hours.
3. Choose **Start experiment**.
   - With fewer than two stored devices, the button stays clickable and the page shows the insufficient-audience message. No push is sent.
   - With two or more devices, the button shows **Starting…**, then a success or the backend error. Live mode submits two EngageLab campaigns. Demo mode records them locally.
4. Choose **Preview split** before sending. Expected: both texts and the real recipient count. `EngageLab called=false`.
5. Choose **Run labelled simulation**. Expected: a banner that says simulation, with a synthetic split such as 60 users. Those users are not real recipients, deliveries, or click-through. The real sample stays 0 until a real start assigns devices.
6. If both real devices land in one variant, start returns `422 EXPERIMENT_VARIANT_EMPTY` and sends nothing.

Endpoints:

- `POST /api/experiments` creates a draft.
- `POST /api/experiments/:id/preview` does not send.
- `POST /api/experiments/:id/simulate` with `{ "syntheticUsers": 60 }` writes `experiment_simulations` only.
- `POST /api/experiments/:id/start` writes `experiment_assignments` and two campaigns, or rejects the audience and writes neither.
- `GET /api/experiments/:id` and `GET /api/analytics/experiments` count assignment rows and device events. Simulation rows are listed separately and are not added to the sample.

Database for a real start: `experiments.status` moves `draft` to `running`. Each variant campaign is `simulated` in demo mode or `accepted_by_provider` when EngageLab accepts it. A failed send moves the experiment to `failed` and a repeat start does not send a second pair.

## One stored device

1. Register the app once and confirm the dashboard device count is 1. Do not copy the Registration ID.
2. Use **Preview split**. Expected: one variant has 1 real recipient and the other has 0. Significance stays unavailable.
3. Use **Run labelled simulation** to inspect a split. It is labelled simulation.
4. Check the single-device confirmation, then choose **Send variant A to this device** or variant B. This is a separate test, not an A/B result.
   - Demo mode: `simulated=true` and EngageLab is not called.
   - Live mode: EngageLab is called for that one variant. Acceptance is not delivery.
5. The experiment stays `draft`. Real sample sizes stay 0. The test row shows a masked device hint and `deviceDeliveryVerified=false`.
6. Look at the phone. Only the notification on the device verifies delivery. Tapping it should open the selected video. This session did not observe that receipt.

Endpoint: `POST /api/experiments/:id/test-send` with `{ "variant": "A", "registrationId": "<stored id>", "confirm": true }`.

## What remains unverified without the device

- Whether EngageLab delivered the notification.
- Whether the phone displayed it.
- Whether a tap opened the video.
- Which A/B variant wins. That needs at least 30 real devices in each variant.
