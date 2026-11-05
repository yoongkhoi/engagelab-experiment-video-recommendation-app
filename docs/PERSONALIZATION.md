# EngageVideo personalization

This document covers onboarding, recommendations, the video assistant, and notification matching. The product overview is `README.md`. It does not replace the EngageLab setup notes.

## Startup

From `EngageVideoPush` in PowerShell:

```powershell
npm run install:all
npm run start:backend
npm run start:dashboard
```

- Backend: http://localhost:3000/api/health
- Dashboard: http://localhost:5173
- The backend listens on `0.0.0.0` and does not send a push at startup.

AI service, from `ai-service`:

```powershell
py -3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The service reads `backend/.env` without writing it. `AI_SERVICE_URL` defaults to `http://127.0.0.1:8000`.

Android emulator, using the installed system image:

```powershell
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
& "$env:ANDROID_SDK_ROOT\emulator\emulator.exe" -avd Medium_Phone_API_37.0
```

Build and install:

```powershell
$env:JAVA_HOME = "D:\engagelab\.tools\jdk-17.0.20.1+1"
cd android
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
adb -s emulator-5554 install -r -t app\build\outputs\apk\debug\app-debug.apk
adb -s emulator-5554 shell am force-stop com.example.engagevideopush
adb -s emulator-5554 shell am start -n com.example.engagevideopush/.MainActivity
```

The debug app uses `http://10.0.2.2:3000` on the emulator.

## Scheduler

`server.ts` starts a 60-second interval only when `SCHEDULER_ENABLED=true`. That interval calls `schedulerTick`. The tick releases due digest rows only when `SCHEDULER_CONFIRM=true` as well. Both values ship as `false` in `backend/.env.example`. Leave them unset in `backend/.env`.

This session did not start that interval and did not observe a tick. An admin can still release due rows with `POST /api/library/digest/run` and `{ "confirm": true }`. That route is manual. It is not the scheduler. A digest whose `deliver_after` is still in the future is left queued.

## Tests

```powershell
cd backend
npm.cmd test
npm.cmd run typecheck
npm.cmd run build

cd ..\ai-service
py -3 -m pytest -q

cd ..\dashboard
npm.cmd test
npm.cmd run build

cd ..\android
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

Automated tests mock the LLM, Pixabay, and EngageLab. They do not send a push.

## Authorized single-device push

Do not run this unless you explicitly decide to send one real notification.

1. Create one test account and finish onboarding with the interest that matches the video.
2. Register one device and confirm the app shows a stored Registration ID. Do not copy that ID into chat, logs, or the dashboard.
3. Add one Pixabay video to the library and publish it. Publishing does not send anything.
4. Open Preview or Dry run. Dry run does not call EngageLab and does not write a sent delivery. The full dashboard sequence, including A/B simulation and one-device limits, is in [ADMIN_QA.md](ADMIN_QA.md).
5. Confirm the preview lists only that account, and only one device.
6. Stop here until you have explicitly authorized the send.
7. Activate that one library campaign. The backend targets that device's Registration ID. There is no broadcast fallback.
8. Treat a provider acceptance as acceptance only. Confirm on the device that the notification arrived and that tapping it opens the same video.

## What was verified in this session

- Backend: 54 tests passed after the frequency-cap test was added (the full suite had 53 passing tests, then `tests/personalization.test.ts` passed 10 tests including the new cap). Typecheck and production build passed.
- AI service: 16 pytest tests passed.
- Dashboard: 4 tests passed and the production build completed.
- Android: `testDebugUnitTest` and `assembleDebug` completed with `BUILD SUCCESSFUL`.
- Emulator `emulator-5554`: the new APK installed and opened. The signed-in home screen showed **Because You Like Travel** and **Because You Like Nature** with Pixabay videos. It did not open onboarding. The AI tab showed the assistant as Ready. Search for Nature showed All, Short, and Long. The Short tap stayed on that screen; the filtered cards sit below the visible area, so the filter change itself was not separately confirmed.
- No live EngageLab push was sent. No scheduler tick was observed.

## Manual push result

None. No device receipt is claimed.
