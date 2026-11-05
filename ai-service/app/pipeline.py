import ast
import json
import re
from typing import Callable

from langchain_core.runnables import RunnableLambda

from app.config import ALLOWED_CATEGORIES, INTENTS
from app.skills import instructions_for

Search = Callable[[str], list[dict]]
Complete = Callable[[str], str]


class AiFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def build_chain(complete: Complete, search: Search):
    def analyze(state: dict) -> dict:
        prompt = (
            instructions_for("VIDEO_SEARCH")
            + "\nReturn only JSON with keys intent, category, mood, keywords, durationMax, limit. "
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
        state["queries"] = search_queries(contextual_message(state.get("message") or "", state.get("history") or []), keywords)
        return state

    def load_context(state: dict) -> dict:
        state["negative"] = {item["video_id"] for item in state.get("feedback") or [] if item.get("sentiment") == "negative"}
        return state

    def retrieve(state: dict) -> dict:
        found = []
        seen = set()
        attempted = []
        for query in state["queries"]:
            if query in attempted or len(attempted) >= 3:
                continue
            attempted.append(query)
            for video in search(query):
                if video.get("id") in seen:
                    continue
                seen.add(video["id"])
                video = dict(video)
                video["searchQuery"] = query
                found.append(video)
        state["attempted"] = attempted
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
            reply = f"I found these on Pixabay for {queries}."
        state["result"] = {
            "reply": reply,
            "explanation": reply,
            "intent": "VIDEO_REFINEMENT" if _needs_memory(state.get("message") or "") else "VIDEO_SEARCH",
            "keywords": state["queries"],
            "videos": [_public(video) for video in videos],
            "suggestions": follow_ups(state["queries"], videos),
            "trace": {
                "intent": "VIDEO_SEARCH",
                "queries": state.get("attempted") or state["queries"][:3],
                "resultCount": len(videos),
                "outcome": "results" if videos else "empty",
            },
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
    direct = classify_message(payload["message"])
    if direct is not None:
        return direct
    state = {
        "message": payload["message"],
        "history": payload.get("history") or [],
        "preferences": payload.get("preferences") or [],
        "feedback": payload.get("feedback") or [],
    }
    result = build_chain(complete, search).invoke(state)
    return result["result"]


def classify_message(message: str) -> dict | None:
    text = message.strip()
    if _CALC.match(text):
        value = _calculate(text)
        expression = text.split("=", 1)[0].strip()
        return _direct("CALCULATION", f"{expression} = {value}.", "answered")
    if re.search(r"\b(image|picture|photo)\b", text, re.IGNORECASE) and not re.search(r"\bvideos?\b", text, re.IGNORECASE):
        return _direct("IMAGE_REQUEST", "No, I can only recommend videos.", "unsupported")
    if re.fullmatch(r"[A-Za-z]{6,}", text) and text.lower() not in _TOPICS:
        return _direct("INVALID_INPUT", "I didn't understand that. Ask for a kind of video, such as nature or racing.", "clarification")
    if re.search(r"^\s*(what|who|why|how)\b", text, re.IGNORECASE) and not re.search(r"\bvideos?\b", text, re.IGNORECASE):
        if re.search(r"formula\s*1|\bf1\b", text, re.IGNORECASE):
            answer = "Formula 1 is a motorsport championship for open-wheel race cars."
        else:
            answer = "I can answer briefly, and I can look for videos when you want them."
        return _direct("GENERAL_QUESTION", answer, "answered")
    return None


def _direct(intent: str, reply: str, outcome: str) -> dict:
    return {
        "reply": reply,
        "explanation": reply,
        "intent": intent,
        "keywords": [],
        "videos": [],
        "suggestions": [],
        "trace": {"intent": intent, "queries": [], "resultCount": 0, "outcome": outcome},
    }


def _calculate(message: str) -> int | float:
    expression = message.split("=", 1)[0]
    if not re.fullmatch(r"[0-9+\-*/(). ]+", expression.strip()):
        raise AiFailure("LLM_INVALID", "That calculation was not accepted.")
    tree = ast.parse(expression, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.UAdd)):
            raise AiFailure("LLM_INVALID", "That calculation was not accepted.")
    result = eval(compile(tree, "<calculation>", "eval"), {"__builtins__": {}})
    if isinstance(result, float) and result.is_integer():
        return int(result)
    return result


def contextual_message(message: str, history: list[dict]) -> str:
    if not _needs_memory(message):
        return message
    prior = " ".join(str(item.get("content") or "") for item in history if item.get("role") == "user")
    return f"{message}\n{prior}" if prior else message


def _needs_memory(message: str) -> bool:
    if _F1.search(message) or _GRAND_PRIX.search(message) or _MOTORSPORT.search(message) or _RACE_CARS.search(message) or _RACING.search(message):
        return False
    if re.search(r"\b(nature|food|forest|travel|technology|animal|ocean|cooking)\b", message, re.IGNORECASE):
        return False
    return bool(re.search(r"\b(videos?|something similar|more like|these)\b", message, re.IGNORECASE))


def follow_ups(queries: list[str], videos: list[dict]) -> list[str]:
    topic = queries[0] if queries else "this topic"
    suggestions = [f"More like these", f"Explore similar {topic} videos"]
    if any(isinstance(video.get("duration"), int) and video["duration"] > 20 for video in videos):
        suggestions.append("Show shorter videos")
    suggestions.append("Try another category")
    unique = []
    for item in suggestions:
        if item not in unique:
            unique.append(item)
    return unique[:4]


_TOPICS = {
    "nature", "travel", "sports", "food", "music", "gaming", "fashion", "design", "fitness",
    "animals", "animal", "forest", "racing", "motorsport", "technology", "science", "lifestyle",
    "photography", "architecture", "entertainment", "movies", "movie", "waterfall", "ocean", "formula",
}
_CALC = re.compile(r"^\s*[0-9]+(?:\s*[+\-*/]\s*[0-9]+)+\s*=?\s*\??\s*$")
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
