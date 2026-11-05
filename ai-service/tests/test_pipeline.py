import json

import pytest

from app.config import llm_configured, llm_settings
from fastapi.testclient import TestClient

from app.main import app
from app.pipeline import AiFailure, recommend, search_queries


def analysis(intent="video_search", category="nature", keywords=None, duration=None):
    return json.dumps({
        "intent": intent,
        "category": category,
        "mood": "calm",
        "keywords": keywords if keywords is not None else ["peaceful forest", "waterfall"],
        "durationMax": duration,
        "limit": 6,
    })


def video(video_id="125", title="Forest", category="nature", url="https://cdn.example/a.mp4", duration=12):
    return {"id": video_id, "title": title, "description": title, "category": category, "thumbnailUrl": "https://cdn.example/t.jpg", "videoUrl": url, "duration": duration, "width": 1280, "height": 720}


def test_health_configuration_does_not_require_a_live_call(monkeypatch):
    monkeypatch.setenv("OPENAI_API_BASE", "https://proxy.example/v1")
    monkeypatch.setenv("OPENAI_API_URL", "https://other.example/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    settings = llm_settings()
    assert settings["baseSource"] == "OPENAI_API_BASE"
    assert settings["basesDiffer"] is True
    assert llm_configured() is True
    monkeypatch.delenv("OPENAI_API_KEY")
    assert llm_configured() is False


def test_recommendation_uses_only_retrieved_https_videos():
    def search(query):
        return [video(), video("9", "Broken", url="http://insecure.example/a.mp4")]
    result = recommend(lambda _prompt: analysis(), search, {"message": "Find relaxing nature videos.", "preferences": ["nature"]})
    assert [item["id"] for item in result["videos"]] == ["125"]
    assert result["videos"][0]["title"] == "Forest"
    assert result["reply"].startswith("I found these on Pixabay for ")
    assert "\n-" not in result["reply"]


def test_empty_pixabay_result_is_honest():
    result = recommend(lambda _prompt: analysis(), lambda _query: [], {"message": "Show me Malaysian street food."})
    assert result["videos"] == []
    assert "did not return" in result["reply"]


def test_invalid_llm_json_fails():
    with pytest.raises(AiFailure) as error:
        recommend(lambda _prompt: "not json", lambda _query: [video()], {"message": "hello"})
    assert error.value.code == "LLM_INVALID"


def test_duration_and_negative_feedback_change_rank():
    def search(_query):
        return [video("1", "Long match forest", duration=40), video("2", "Short forest", duration=8)]
    result = recommend(lambda _prompt: analysis(duration=20), search, {
        "message": "Show me shorter videos about forests.",
        "feedback": [{"video_id": "2", "sentiment": "negative"}],
    })
    assert result["videos"] == []


def test_follow_up_history_is_passed_to_the_single_model_call():
    seen = {}
    def complete(prompt):
        seen["prompt"] = prompt
        return analysis(keywords=["waterfall"])
    recommend(complete, lambda _query: [video(title="Waterfall")], {
        "message": "Show me something more relaxing.",
        "history": [{"role": "user", "content": "Find nature videos."}],
    })
    assert "Find nature videos." in seen["prompt"]
    assert seen["prompt"].count("Return only JSON") == 1


def test_motorsport_phrases_map_to_pixabay_searches():
    prompts = {
        "you can you give me some video about f1": "Formula 1 racing",
        "Show me Formula 1 videos": "Formula One race cars",
        "I want to watch motorsport": "Motorsport racing",
        "Find Grand Prix racing videos": "Grand Prix racing",
        "Show me race cars": "Racing circuit",
        "F1 drivers": "Formula 1 racing",
        "F1 racing circuits": "Formula 1 racing",
        "Formula One": "Formula One race cars",
    }
    for prompt, expected in prompts.items():
        seen = []

        def search(query, _seen=seen):
            _seen.append(query)
            return [video(title="Race car", category="sports")]

        result = recommend(lambda _prompt: analysis(category="f1", keywords=[]), search, {"message": prompt})
        assert expected in seen, prompt
        assert result["videos"]
        assert result["videos"][0]["videoUrl"].startswith("https://")
        assert "Formula" not in result["videos"][0]["id"]


def test_nature_and_food_keep_their_own_search_terms():
    nature = []
    recommend(lambda _prompt: analysis(keywords=["peaceful forest"]), lambda query: nature.append(query) or [video()], {"message": "Recommend relaxing nature videos"})
    assert nature == ["peaceful forest"]
    food = []
    recommend(lambda _prompt: analysis(category="food", keywords=["street food"]), lambda query: food.append(query) or [video(category="food")], {"message": "Show me food videos"})
    assert food == ["street food"]


def test_unknown_topic_is_kept():
    seen = []
    recommend(lambda _prompt: analysis(category="origami", keywords=["paper crane"]), lambda query: seen.append(query) or [video(title="Paper")], {"message": "Show me origami videos"})
    assert seen == ["paper crane"]


def test_f1_with_no_pixabay_results_suggests_real_search_terms():
    result = recommend(lambda _prompt: analysis(category=None, keywords=[]), lambda _query: [], {"message": "you can you give me some video about f1"})
    assert result["videos"] == []
    assert "did not return" in result["reply"]
    assert "Formula 1 racing" in result["reply"]


def test_invalid_video_urls_are_dropped():
    def search(_query):
        return [
            video("bad-http", url="http://insecure.example/a.mp4"),
            video("bad-text", url="not-a-url"),
            video("ok", title="Open wheel", url="https://cdn.example/ok.mp4"),
            {"id": "blank", "title": "  ", "videoUrl": "https://cdn.example/blank.mp4"},
        ]
    result = recommend(lambda _prompt: analysis(keywords=["Formula 1 racing"]), search, {"message": "Show me Formula 1 videos"})
    assert [item["id"] for item in result["videos"]] == ["ok"]


def test_f1_request_accepts_missing_and_null_fields(monkeypatch):
    monkeypatch.setenv("AI_ALLOW_UNCONFIGURED", "test")
    monkeypatch.setenv("AI_FAKE_COMPLETION", analysis(category="f1", keywords=["city night"]))
    monkeypatch.setenv("AI_FAKE_SEARCH", json.dumps([video(title="City race", category="sports")]))
    client = TestClient(app)
    missing = client.post("/api/ai/recommend", json={"message": "you can you give me some video about f1"})
    assert missing.status_code == 200
    body = missing.json()["recommendation"]
    assert "Formula 1 racing" in body["keywords"]
    assert "city night" in body["keywords"]
    assert body["videos"][0]["id"] == "125"
    blank = client.post("/api/ai/recommend", json={
        "message": "Show me Formula 1 videos",
        "history": None,
        "preferences": None,
        "feedback": None,
        "limit": None,
    })
    assert blank.status_code == 200
    assert "Traceback" not in blank.text


def test_empty_and_invalid_requests_do_not_leak_validation_details(monkeypatch):
    monkeypatch.setenv("AI_ALLOW_UNCONFIGURED", "test")
    client = TestClient(app)
    empty = client.post("/api/ai/recommend", json={"message": "   "})
    assert empty.status_code == 400
    assert empty.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "Traceback" not in empty.text
    assert "loc" not in empty.text
    invalid = client.post("/api/ai/recommend", json={"limit": "nope"})
    assert invalid.status_code == 400
    assert "traceback" not in invalid.text.lower()
    assert search_queries("racing", []) == ["Motorsport racing", "Racing circuit"]
