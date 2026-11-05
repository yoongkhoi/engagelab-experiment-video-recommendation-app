from app.pipeline import recommend
from app.skills import instructions_for


def analysis():
    return '{"intent":"video_search","category":"sports","mood":null,"keywords":[],"durationMax":null,"limit":6}'


def video():
    return {"id": "125", "title": "Race car", "description": "cars", "category": "sports", "thumbnailUrl": "https://cdn.example/t.jpg", "videoUrl": "https://cdn.example/a.mp4", "duration": 30, "width": 1280, "height": 720}


def test_direct_intents_do_not_search():
    calls = {"search": 0, "complete": 0}

    def search(_query):
        calls["search"] += 1
        return [video()]

    def complete(_prompt):
        calls["complete"] += 1
        return analysis()

    calculation = recommend(complete, search, {"message": "1+1-1=?"})
    image = recommend(complete, search, {"message": "Can you give me an image?"})
    question = recommend(complete, search, {"message": "What is Formula 1?"})
    invalid = recommend(complete, search, {"message": "abcdefgh"})
    assert calculation["intent"] == "CALCULATION"
    assert calculation["reply"].endswith("1.")
    assert image["intent"] == "IMAGE_REQUEST"
    assert image["reply"] == "No, I can only recommend videos."
    assert image["videos"] == []
    assert question["intent"] == "GENERAL_QUESTION"
    assert question["videos"] == []
    assert invalid["intent"] == "INVALID_INPUT"
    assert calls == {"search": 0, "complete": 0}


def test_follow_up_uses_earlier_topic_and_limits_searches():
    seen = []

    def search(query):
        seen.append(query)
        return [] if query == "missing" else [video()]

    result = recommend(lambda _prompt: analysis(), search, {
        "message": "Find me some videos.",
        "history": [{"role": "user", "content": "I like F1."}],
    })
    assert "Formula 1 racing" in seen
    assert len(seen) <= 3
    assert result["videos"]
    assert result["videos"][0]["videoUrl"].startswith("https://")
    assert "suggestions" in result
    assert result["suggestions"]
    assert "trace" in result


def test_video_search_does_not_load_every_skill():
    text = instructions_for("VIDEO_SEARCH")
    assert "Video discovery" in text
    assert "Account context" not in text
    assert "CALCULATION" not in text or "Intent understanding" in text
