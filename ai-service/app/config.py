import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ENV = Path(__file__).resolve().parents[2] / "backend" / ".env"
load_dotenv(BACKEND_ENV)
load_dotenv()

ALLOWED_CATEGORIES = ["travel", "nature", "food", "technology", "sports", "animals", "entertainment"]
INTENTS = ["video_search", "video_recommendation", "category_discovery", "preference_based_recommendation", "follow_up_search"]


def llm_settings() -> dict:
    base = os.getenv("OPENAI_API_BASE", "").strip().rstrip("/")
    url = os.getenv("OPENAI_API_URL", "").strip().rstrip("/")
    chosen = base or url
    source = "OPENAI_API_BASE" if base else "OPENAI_API_URL" if url else ""
    if base and url and base != url:
        source = "OPENAI_API_BASE"
        chosen = base
    return {
        "base": chosen,
        "baseSource": source,
        "basesDiffer": bool(base and url and base != url),
        "apiKey": os.getenv("OPENAI_API_KEY", "").strip(),
        "model": os.getenv("LLM_MODEL", "").strip(),
        "backendUrl": os.getenv("BACKEND_URL", "http://127.0.0.1:3000").rstrip("/"),
    }


def llm_configured() -> bool:
    settings = llm_settings()
    return bool(settings["base"] and settings["apiKey"] and settings["model"])
