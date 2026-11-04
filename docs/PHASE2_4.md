# EngageVideo AI, phases 2–4

The dashboard stays the existing React app. It was not rewritten as Vue.

## Architecture

- Android talks only to the Node backend.
- The Node backend owns accounts, favorites, watch history, notification settings, the Pixabay library, and EngageLab campaigns.
- `ai-service` is a separate FastAPI process. It runs one LangChain LCEL chain and calls the backend Pixabay search. It does not store accounts and does not send pushes.
- LLM credentials stay in `backend/.env`. The AI process loads that file without rewriting it. Android never receives the key.

## LCEL chain

`intent_analyzer | query_rewriter | context_loader | pixabay_retriever | result_validator | recommendation_ranker | response_generator`

The model is called once. The rewriter only cleans the keywords from that response. The retriever uses `GET /api/videos?query=`. The validator keeps only those results with an https URL. The ranker is a scored sort using the request, saved interests, duration, and negative feedback. It is not a trained model. If Pixabay returns nothing, the reply says so.

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
