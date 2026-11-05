from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1] / "skills"

ACTIVE = {
    "VIDEO_SEARCH": ["intent-understanding", "video-discovery", "query-expansion", "video-validation", "recommendation-personalization", "response-formatting"],
    "VIDEO_REFINEMENT": ["intent-understanding", "conversation-memory", "video-discovery", "query-expansion", "response-formatting"],
    "GENERAL_QUESTION": ["intent-understanding", "response-formatting"],
    "CALCULATION": ["intent-understanding"],
    "IMAGE_REQUEST": ["intent-understanding", "response-formatting"],
    "CLARIFICATION": ["intent-understanding", "conversation-memory"],
    "INVALID_INPUT": ["intent-understanding"],
    "UNSUPPORTED_REQUEST": ["intent-understanding", "response-formatting"],
}


def instructions_for(intent: str) -> str:
    names = ACTIVE.get(intent, ["intent-understanding"])
    parts = []
    for name in names:
        path = SKILL_DIR / name / "SKILL.md"
        if path.is_file():
            parts.append(path.read_text(encoding="utf-8")[:700])
    return "\n".join(parts)
