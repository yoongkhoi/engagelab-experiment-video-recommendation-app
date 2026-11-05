# EngageVideo AI, phases 2–4

This note describes the account, assistant, and library data added after the first push demo. The current product overview is `README.md`. The dashboard remains the existing React app. It was not rewritten as Vue. The video-library screen is hidden; the API is unchanged.

## Architecture

- Android talks only to the Node backend.
- The Node backend owns accounts, favorites, watch history, notification settings, the Pixabay library, and EngageLab campaigns.
- `ai-service` is a separate FastAPI process. It runs one LangChain LCEL chain and calls the backend Pixabay search. It does not store accounts and does not send pushes.
- LLM credentials stay in `backend/.env`. The AI process loads that file without rewriting it. Android never receives the key.

## Recommendation pipeline

Image requests, calculations, and other non-video messages are answered without Pixabay or a model call. A video request uses one model JSON call, then at most three distinct Pixabay searches. The visible reply names the search and does not list titles. Playable cards come from the returned videos. The validator keeps only https results. If Pixabay returns nothing, the reply says so. Skill files in `ai-service/skills/` supply the instructions for that path. The ranker is a scored sort, not a trained model.

`OPENAI_API_BASE` is the chat-completions base. `OPENAI_API_URL` is used only when the base is empty. If they differ, the base wins.

## Data added to SQLite

`favorites`, `watch_history`, `ai_conversations`, `ai_messages`, `recommendation_feedback`, `notification_preferences`, `library_entries`, `library_campaigns`, `notification_deliveries`.

Existing users, sessions, and devices are not rebuilt. A Pixabay id is published only after an administrator publishes the library entry. Playback rows are not published automatically.

## Notification behavior

Quiet hours use `ENGAGELAB_SITE_TIMEZONE`, or UTC when that value is empty. An overnight range such as 22:00–07:00 is quiet. Daily and weekly frequencies are queued. Instant delivery is capped at 3 targeted sends per user per 24 hours. The same user, video, and Registration ID is not sent twice. There is no broadcast fallback. Demo mode records `simulated` and is not device delivery. Provider acceptance is also not device delivery.

## Run

```powershell
cd D:\engagelab\EngageVideoPush\backend
npm.cmd run dev
```

```powershell
cd D:\engagelab\EngageVideoPush\dashboard
npm.cmd run dev
```

```powershell
cd D:\engagelab\EngageVideoPush\ai-service
py -3 -m pip install -r requirements.txt
py -3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
cd D:\engagelab\EngageVideoPush\android
$env:JAVA_HOME = "D:\engagelab\.tools\jdk-17.0.20.1+1"
$env:ANDROID_HOME = "D:\engagelab\.tools\android-sdk"
.\gradlew.bat :app:assembleDebug
```

Automated AI tests do not call the live model:

```powershell
cd D:\engagelab\EngageVideoPush\ai-service
py -3 -m pytest
```
