# Testing

## Automated

From `EngageVideoPush`:

```powershell
npm test
npm run typecheck
npm run lint
npm run build:dashboard
```

Backend tests use Vitest, Supertest, and an in-memory SQLite database. EngageLab is replaced with a mock `fetch`. No real credential is required for these tests. They cover:

- partial, missing, and complete environment configuration
- video create, duplicate id, update, and deactivate-when-referenced
- device registration and a second registration for the same Registration ID
- malformed JSON and admin authentication
- unknown videos, empty category audiences, and broadcast confirmation
- category targeting that sends only the matching Registration ID
- schedule validation and the `/v4/schedules` body
- event dedupe and analytics that leave delivery unavailable
- stable A/B assignment and a preliminary result under 30 devices per variant
- a one-device experiment that does not send, a labelled simulation that stays out of the real sample, and a single-device test send that is not an assignment
- interest targeting that resolves a saved category to that account’s device
- Basic auth construction, extras, and the Android intent URL
- authentication, validation, and timeout classification
- tag pushes that use `to.tag` only after a device tag read

Dashboard tests cover broadcast confirmation and Registration ID masking.

Android unit tests are in `android/app/src/test`. They parse nested `message_json`, reject a missing or unsafe `video_id`, and ignore a duplicate notification inside five seconds. Run them with:

```powershell
cd android
.\gradlew.bat test
```

`.\gradlew.bat assembleDebug test` was executed with JDK 17 and Android SDK platform 35. Debug and release unit tests each ran `PushPayloadParserTest` (4 tests, 0 failures). The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. This does not install the app or exercise a real Registration ID.

## Manual end-to-end

1. Start the backend and confirm `GET /api/health`.
2. Open `GET /api/engagelab/status` with the admin key. Live mode should report `connected: true` only after `GET /v4/tags/` succeeds.
3. Install the app, allow notifications, and wait for a Registration ID.
4. Confirm the device row in the dashboard.
5. Send an immediate push for video `1001` to that Registration ID.
6. Confirm the campaign status is `accepted_by_provider` and `msg_id` is present.
7. Tap the notification from the foreground, background, and after force-stop.
8. Confirm the player shows video `1001` and that overview counts increase for notification opens and play starts.
9. Create a schedule a few minutes ahead using the data-center timezone.
10. Change preferences to one category and sync tags, then send a category campaign and a tag campaign.
11. Start an A/B experiment. With only a few devices the result must say preliminary.

Do not treat a simulated banner as a delivery. Do not treat `msg_id` as proof the notification was shown.
