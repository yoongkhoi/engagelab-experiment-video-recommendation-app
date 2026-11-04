import logging
import os
from collections import defaultdict
from time import time

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.config import llm_configured, llm_settings
from app.pipeline import AiFailure, recommend

app = FastAPI(title="EngageVideo AI")
logger = logging.getLogger("engagevideo.ai")
_hits: dict[str, list[float]] = defaultdict(list)


class RecommendRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[dict] = Field(default_factory=list)
    preferences: list[str] = Field(default_factory=list)
    feedback: list[dict] = Field(default_factory=list)
    limit: int = Field(default=6, ge=1, le=8)

    @field_validator("message", mode="before")
    @classmethod
    def strip_message(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("history", "preferences", "feedback", mode="before")
    @classmethod
    def none_to_list(cls, value):
        return [] if value is None else value

    @field_validator("limit", mode="before")
    @classmethod
    def none_limit(cls, value):
        return 6 if value is None else value


class FeedbackRequest(BaseModel):
    videoId: str = Field(min_length=1, max_length=64)
    sentiment: str


@app.get("/api/ai/health")
def health():
    settings = llm_settings()
    return {
        "ok": True,
        "llmConfigured": llm_configured(),
        "model": settings["model"] or None,
        "baseSource": settings["baseSource"] or None,
        "basesDiffer": settings["basesDiffer"],
    }


@app.post("/api/ai/chat")
@app.post("/api/ai/recommend")
def recommend_route(body: RecommendRequest):
    settings = llm_settings()
    if not llm_configured() and os.getenv("AI_ALLOW_UNCONFIGURED") != "test":
        return _error(503, "LLM_NOT_CONFIGURED", "The OpenAI-compatible proxy is not configured.")
    try:
        _limit("recommend")
        result = recommend(_complete, _search_backend, body.model_dump())
    except AiFailure as error:
        status = 429 if error.code == "AI_RATE_LIMIT" else 502
        message = "The video assistant could not answer. Try again."
        if error.code == "AI_RATE_LIMIT":
            message = "Too many AI requests. Wait before trying again."
        return _error(status, error.code, message)
    except httpx.TimeoutException:
        return _error(504, "AI_TIMEOUT", "The video assistant timed out. Try again.")
    except httpx.HTTPError:
        return _error(503, "PIXABAY_UNAVAILABLE", "Video search is unavailable right now.")
    except Exception as error:
        logger.error("AI recommendation failed type=%s", type(error).__name__)
        return _error(502, "AI_UNAVAILABLE", "The video assistant could not answer. Try again.")
    return {"recommendation": result}


@app.post("/api/ai/feedback")
def feedback(body: FeedbackRequest):
    if body.sentiment not in {"positive", "negative"}:
        return _error(400, "VALIDATION_ERROR", "sentiment must be positive or negative.")
    return {"accepted": True, "stored": False, "note": "Feedback is stored by the authenticated backend."}


def _complete(prompt: str) -> str:
    override = os.getenv("AI_FAKE_COMPLETION")
    if override is not None:
        return override
    settings = llm_settings()
    if not llm_configured():
        raise AiFailure("LLM_NOT_CONFIGURED", "The OpenAI-compatible proxy is not configured.")
    response = httpx.post(
        f"{settings['base']}/chat/completions",
        headers={"Authorization": f"Bearer {settings['apiKey']}"},
        json={"model": settings["model"], "temperature": 0, "messages": [{"role": "user", "content": prompt}]},
        timeout=35,
    )
    if response.status_code >= 400:
        raise AiFailure("LLM_UNAVAILABLE", "The model request failed.")
    return response.json()["choices"][0]["message"]["content"]


def _search_backend(query: str) -> list[dict]:
    override = os.getenv("AI_FAKE_SEARCH")
    if override is not None:
        import json
        return json.loads(override)
    settings = llm_settings()
    response = httpx.get(f"{settings['backendUrl']}/api/videos", params={"query": query, "page": 1}, timeout=15)
    response.raise_for_status()
    videos = []
    for video in response.json().get("videos") or []:
        url = video.get("video_url") or video.get("source") or ""
        title = str(video.get("title") or "").strip()
        if not str(url).startswith("https://") or not title:
            continue
        thumbnail = video.get("thumbnail_url") or video.get("thumbnailUrl")
        profile = video.get("creator_profile_url")
        page = video.get("source_url")
        videos.append({
            "id": str(video.get("id") or video.get("video_id")),
            "title": title,
            "description": video.get("description") or "",
            "category": video.get("category") or "",
            "thumbnailUrl": thumbnail if str(thumbnail or "").startswith("https://") else None,
            "videoUrl": url,
            "duration": video.get("duration"),
            "width": video.get("width"),
            "height": video.get("height"),
            "creator_name": video.get("creator_name") or None,
            "creator_profile_url": profile if str(profile or "").startswith("https://") else None,
            "source_url": page if str(page or "").startswith("https://") else None,
        })
    return videos


def _limit(key: str) -> None:
    now = time()
    recent = [stamp for stamp in _hits[key] if now - stamp < 60]
    if len(recent) >= 60:
        raise AiFailure("AI_RATE_LIMIT", "Too many AI requests.")
    recent.append(now)
    _hits[key] = recent


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, exc: RequestValidationError):
    logger.warning("AI request validation failed fields=%s", [
        {"path": ".".join(str(part) for part in item.get("loc", ())), "type": item.get("type")}
        for item in exc.errors()
    ])
    return _error(400, "VALIDATION_ERROR", "The chat request was not accepted. Send the message again.")


def _error(status: int, code: str, message: str):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})
