import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("GEMINI_API_KEY", "")
os.environ.setdefault("TAVILY_API_KEY", "")
os.environ["DISABLE_PIPELINES"] = "1"

import database

_test_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_test_db.close()
database.DB_PATH = _test_db.name
database.init_db()

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_root_returns_ok():
    res = client.get("/")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "pipelines" in body
    assert "db_path" in body


def test_health_returns_details():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] in ("healthy", "degraded")
    assert "db_path" in body
    assert "db_writable" in body
    assert body["db_writable"] is True
    assert "article_count" in body
    assert "fetch_running" in body


def test_articles_returns_list():
    res = client.get("/articles")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_articles_genre_filter():
    database.insert_article(
        {
            "title": "Test cricket headline",
            "url": "https://example.com/cricket-test",
            "source": "Test Source",
            "genre": "Cricket",
            "subgenre": "IPL",
            "lean": "Unclear",
            "lean_confidence": 0,
            "is_rumour": 0,
            "is_breaking": 0,
            "is_transfer": 0,
            "rumour_true_probability": 50,
            "rumour_false_probability": 50,
            "rumour_verdict": "Unverified",
            "published_at": None,
            "fetched_at": "2025-01-01T00:00:00",
            "summary": "Test",
            "transfer_player": None,
            "transfer_from": None,
            "transfer_to": None,
            "transfer_fee": None,
            "image_keyword": "cricket",
            "ingestion_source": "rss",
        }
    )
    res = client.get("/articles", params={"genre": "Cricket"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 1
    assert all(a["genre"] == "Cricket" for a in data)


def test_search_requires_min_length():
    res = client.get("/search", params={"q": "ab"})
    assert res.status_code == 200
    assert res.json() == []


def test_search_finds_articles():
    database.insert_article(
        {
            "title": "Unique quantum breakthrough headline",
            "url": "https://example.com/quantum-search",
            "source": "Science Daily",
            "genre": "Science",
            "subgenre": "Other",
            "lean": "Unclear",
            "lean_confidence": 0,
            "is_rumour": 0,
            "is_breaking": 0,
            "is_transfer": 0,
            "rumour_true_probability": 50,
            "rumour_false_probability": 50,
            "rumour_verdict": "Unverified",
            "published_at": None,
            "fetched_at": "2025-01-01T00:00:00",
            "summary": "Scientists discover quantum effect",
            "transfer_player": None,
            "transfer_from": None,
            "transfer_to": None,
            "transfer_fee": None,
            "image_keyword": "science",
            "ingestion_source": "rss",
        }
    )
    res = client.get("/search", params={"q": "quantum"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 1
    assert any("quantum" in a["title"].lower() for a in data)


def test_fetch_status_includes_progress():
    res = client.get("/fetch/status")
    assert res.status_code == 200
    body = res.json()
    assert "running" in body
    assert "total" in body
    assert "processed" in body
    assert "total_to_process" in body


def test_stats_has_required_keys():
    res = client.get("/stats")
    assert res.status_code == 200
    body = res.json()
    for key in (
        "total",
        "rumours",
        "transfers",
        "rss_count",
        "agent_count",
        "lean_breakdown",
        "genres_breakdown",
    ):
        assert key in body


def test_ingestion_source_filter():
    base = {
        "title": "Tech story",
        "source": "Test",
        "genre": "Technology",
        "subgenre": "Other",
        "lean": "Unclear",
        "lean_confidence": 0,
        "is_rumour": 0,
        "is_breaking": 0,
        "is_transfer": 0,
        "rumour_true_probability": 50,
        "rumour_false_probability": 50,
        "rumour_verdict": "Unverified",
        "published_at": None,
        "fetched_at": "2025-01-01T00:00:00",
        "summary": "Test",
        "transfer_player": None,
        "transfer_from": None,
        "transfer_to": None,
        "transfer_fee": None,
        "image_keyword": "tech",
    }
    database.insert_article(
        {
            **base,
            "url": "https://example.com/rss-tech",
            "source": "TechCrunch",
            "ingestion_source": "rss",
        }
    )
    database.insert_article(
        {
            **base,
            "url": "https://example.com/agent-tech",
            "source": "Wired.com",
            "ingestion_source": "agent",
        }
    )
    rss_res = client.get("/articles", params={"ingestion_source": "rss"})
    agent_res = client.get("/articles", params={"ingestion_source": "agent"})
    assert rss_res.status_code == 200
    assert agent_res.status_code == 200
    assert all(a["ingestion_source"] == "rss" for a in rss_res.json())
    assert all(a["ingestion_source"] == "agent" for a in agent_res.json())
