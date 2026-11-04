import json
import re
from typing import Callable

from langchain_core.runnables import RunnableLambda

from app.config import ALLOWED_CATEGORIES, INTENTS

Search = Callable[[str], list[dict]]
Complete = Callable[[str], str]


class AiFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def build_chain(complete: Complete, search: Search):
    def analyze(state: dict) -> dict:
        prompt = (
            "Return only JSON with keys intent, category, mood, keywords, durationMax, limit. "
            f"intent must be one of {INTENTS}. category must be one of {ALLOWED_CATEGORIES} or null. "
            "keywords must be short Pixabay search phrases. Do not invent video ids or urls.\n"
            f"Preferences: {state.get('preferences')}\nHistory: {state.get('history')}\nUser: {state['message']}"
        )
        try:
            parsed = json.loads(_json_block(complete(prompt)))
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            raise AiFailure("LLM_INVALID", "The model did not return usable recommendation JSON.") from error
        intent = parsed.get("intent")
        if intent not in INTENTS:
            raise AiFailure("LLM_INVALID", "The model returned an unknown intent.")
        category = parsed.get("category")
        if category not in ALLOWED_CATEGORIES:
            category = None
        raw_keywords = parsed.get("keywords") or []
        if not isinstance(raw_keywords, list):
            raw_keywords = []
        keywords = [str(item).strip() for item in raw_keywords if str(item).strip()][:3]
        try:
            limit = int(parsed.get("limit") or 6)
        except (TypeError, ValueError):
            limit = 6
        state["analysis"] = {
            "intent": intent,
            "category": category,
            "mood": parsed.get("mood"),
            "keywords": keywords,
            "durationMax": parsed.get("durationMax") if isinstance(parsed.get("durationMax"), int) else None,
            "limit": min(limit, 8),
        }
        return state

    def rewrite(state: dict) -> dict:
        analysis = state["analysis"]
        keywords = list(analysis["keywords"])
        if not keywords and analysis["category"]:
            keywords = [analysis["category"]]
        state["queries"] = search_queries(state.get("message") or "", keywords)
        return state

    def load_context(state: dict) -> dict:
        state["negative"] = {item["video_id"] for item in state.get("feedback") or [] if item.get("sentiment") == "negative"}
        return state

    def retrieve(state: dict) -> dict:
        found = []
        seen = set()
        for query in state["queries"]:
            for video in search(query):
                if video.get("id") in seen:
                    continue
                seen.add(video["id"])
                video = dict(video)
                video["searchQuery"] = query
                found.append(video)
        state["retrieved"] = found
        return state

    def validate(state: dict) -> dict:
        allowed = {video["id"] for video in state["retrieved"]}
        state["valid"] = [
            video for video in state["retrieved"]
            if video.get("id") in allowed
            and str(video.get("videoUrl", "")).startswith("https://")
            and str(video.get("title") or "").strip()
        ]
        return state

    def rank(state: dict) -> dict:
        analysis = state["analysis"]
        preferences = set(state.get("preferences") or [])
        ranked = []
        for video in state["valid"]:
            if video["id"] in state["negative"]:
                continue
            duration = video.get("duration")
            if isinstance(analysis.get("durationMax"), int) and isinstance(duration, int) and duration > analysis["durationMax"]:
                continue
            text = f"{video.get('title', '')} {video.get('description', '')}".lower()
            score = 0
            for keyword in state["queries"]:
                if keyword.lower() in text:
                    score += 2
            if analysis.get("category") and video.get("category") == analysis["category"]:
                score += 2
            if video.get("category") in preferences:
                score += 1
            ranked.append((score, video))
        ranked.sort(key=lambda item: item[0], reverse=True)
        state["ranked"] = [video for _, video in ranked[: analysis["limit"]]]
        return state

    def respond(state: dict) -> dict:
        videos = state["ranked"]
        if not videos:
            suggestions = ", ".join(state["queries"][:3])
            reply = "Pixabay did not return a playable video for that request."
            if suggestions:
                reply = f"{reply} You can try {suggestions}."
        else:
            queries = ", ".join(state["queries"][:3]) or "that request"
            lines = [f"I found these on Pixabay for {queries}."]
            lines.extend(f"- {video['title'].strip()}" for video in videos if str(video.get("title") or "").strip())
            reply = "\n".join(lines)
        state["result"] = {
            "reply": reply,
            "explanation": reply,
            "intent": state["analysis"]["intent"],
            "keywords": state["queries"],
            "videos": [_public(video) for video in videos],
        }
        return state

    return (
        RunnableLambda(analyze)
        | RunnableLambda(rewrite)
        | RunnableLambda(load_context)
        | RunnableLambda(retrieve)
        | RunnableLambda(validate)
        | RunnableLambda(rank)
        | RunnableLambda(respond)
    )


def recommend(complete: Complete, search: Search, payload: dict) -> dict:
    state = {
        "message": payload["message"],
        "history": payload.get("history") or [],
        "preferences": payload.get("preferences") or [],
        "feedback": payload.get("feedback") or [],
    }
    result = build_chain(complete, search).invoke(state)
    return result["result"]


_F1 = re.compile(r"\b(?:f1|formula\s*1|formula\s*one)\b", re.IGNORECASE)
_GRAND_PRIX = re.compile(r"\bgrand\s*prix\b", re.IGNORECASE)
_MOTORSPORT = re.compile(r"\bmotorsports?\b", re.IGNORECASE)
_RACE_CARS = re.compile(r"\brace\s*cars?\b|\bracing\s*circuits?\b", re.IGNORECASE)
_RACING = re.compile(r"\bracing\b", re.IGNORECASE)


def search_queries(message: str, keywords: list[str]) -> list[str]:
    mapped: list[str] = []

    def add(*items: str) -> None:
        for item in items:
            if item not in mapped:
                mapped.append(item)

    if _F1.search(message):
        add("Formula 1 racing", "Formula One race cars")
    if _GRAND_PRIX.search(message):
        add("Grand Prix racing")
    if _MOTORSPORT.search(message):
        add("Motorsport racing")
    if _RACE_CARS.search(message):
        add("Racing circuit")
    if _RACING.search(message) and not mapped:
        add("Motorsport racing", "Racing circuit")
    merged: list[str] = []
    for item in mapped + [keyword for keyword in keywords if keyword]:
        if item not in merged:
            merged.append(item)
    return merged[:4]


def _https(value: object) -> str | None:
    text = value if isinstance(value, str) else ""
    return text if text.startswith("https://") else None


def _public(video: dict) -> dict:
    query = video.get("searchQuery")
    return {
        "id": video["id"],
        "title": video["title"],
        "description": video.get("description") or "",
        "category": video.get("category") or "",
        "thumbnailUrl": _https(video.get("thumbnailUrl")),
        "thumbnail_url": _https(video.get("thumbnailUrl")),
        "videoUrl": video["videoUrl"],
        "video_url": video["videoUrl"],
        "source": video["videoUrl"],
        "duration": video.get("duration"),
        "width": video.get("width"),
        "height": video.get("height"),
        "creator_name": video.get("creator_name") or None,
        "creator_profile_url": _https(video.get("creator_profile_url")),
        "source_url": _https(video.get("source_url")),
        "reason": f"Recommended because it matched the Pixabay search “{query}”." if query else None,
    }


def _json_block(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("no json")
    return text[start:end + 1]
