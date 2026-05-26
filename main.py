import asyncio
import os
import threading
import time
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

import classifier
import database
import scraper
from classifier import DEFAULT_RESULT

load_dotenv()

try:
    import agent as agent_module

    AGENT_AVAILABLE = bool(os.getenv("TAVILY_API_KEY"))
except ImportError:
    agent_module = None
    AGENT_AVAILABLE = False

app = FastAPI(title="NewsLens API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

database.init_db()

_FRONTEND_CANDIDATES = [
    os.path.join(os.path.dirname(__file__), "frontend"),
    os.path.join(os.path.dirname(__file__), "frontend"),
]
FRONTEND_DIR = next((p for p in _FRONTEND_CANDIDATES if os.path.isdir(p)), None)
if FRONTEND_DIR:
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/fetch")
def trigger_fetch():
    """Manually start RSS ingestion (runs in background)."""
    with _fetch_lock:
        if _fetch_running:
            return {"status": "running", "message": "Fetch already in progress"}
    threading.Thread(target=fetch_and_classify, daemon=True).start()
    return {"status": "started", "message": "RSS fetch started in background"}


@app.get("/fetch/status")
def fetch_status():
    return {
        "running": _fetch_running,
        "last_added": _last_fetch_count,
        "total": database.get_stats()["total"],
    }


@app.get("/dashboard")
def dashboard_redirect():
    return RedirectResponse(url="/app/")


def _default_classification(title: str) -> dict:
    result = dict(DEFAULT_RESULT)
    result["summary"] = title
    return result


def _build_record(
    article: dict, classification: dict, ingestion_source: str = "rss"
) -> dict:
    return {
        "title": article["title"],
        "url": article["url"],
        "source": article["source"],
        "published_at": article.get("published_at"),
        "fetched_at": datetime.utcnow().isoformat(),
        "summary": classification.get("summary") or article.get("summary"),
        "lean": classification.get("lean", "Unclear"),
        "lean_confidence": classification.get("lean_confidence", 0),
        "genre": classification.get("genre", "Other"),
        "subgenre": classification.get("subgenre", "Other"),
        "is_rumour": 1 if classification.get("is_rumour") else 0,
        "rumour_true_probability": classification.get("rumour_true_probability", 50),
        "rumour_false_probability": classification.get("rumour_false_probability", 50),
        "rumour_verdict": classification.get("rumour_verdict", "Unverified"),
        "is_breaking": 1 if classification.get("is_breaking") else 0,
        "is_transfer": 1 if classification.get("is_transfer") else 0,
        "transfer_player": classification.get("transfer_player"),
        "transfer_from": classification.get("transfer_from"),
        "transfer_to": classification.get("transfer_to"),
        "transfer_fee": classification.get("transfer_fee"),
        "image_keyword": classification.get("image_keyword", "news"),
        "ingestion_source": ingestion_source,
    }


_fetch_lock = threading.Lock()
_fetch_running = False
_last_fetch_count = 0

_GENRE_RULES = [
    ("Football", ("football", "premier league", "la liga", "transfer", "goal.com")),
    ("Cricket", ("cricket", "ipl", "ashes", "wicket")),
    ("Technology", ("tech", "ai ", "apple", "google", "microsoft", "startup")),
    ("Economy", ("market", "stock", "economy", "fed ", "inflation", "trade")),
    ("Science", ("science", "space", "nasa", "research")),
    ("Health", ("health", "covid", "vaccine", "hospital", "who ")),
    ("Entertainment", ("film", "movie", "music", "celebrity", "box office")),
    ("India", ("india", "modi", "delhi", "mumbai")),
    ("World Politics", ("election", "parliament", "president", "minister", "war ")),
]

_RUMOUR_WORDS = (
    "rumour", "rumor", "reportedly", "linked with", "set to sign",
    "in talks", "sources claim", "could sign",
)


def _fast_classify(title: str, source: str) -> dict:
    """Instant rule-based labels — no external API."""
    result = _default_classification(title)
    text = f"{title} {source}".lower()
    for genre, keywords in _GENRE_RULES:
        if any(k in text for k in keywords):
            result["genre"] = genre
            break
    if any(w in text for w in _RUMOUR_WORDS):
        result["is_rumour"] = True
    src_lower = source.lower()
    if any(s in src_lower for s in ("fox", "breitbart")):
        result["lean"] = "Right"
        result["lean_confidence"] = 60
    elif any(s in src_lower for s in ("guardian", "huff", "msnbc")):
        result["lean"] = "Left"
        result["lean_confidence"] = 60
    elif any(s in src_lower for s in ("reuters", "ap ", "bbc", "npr")):
        result["lean"] = "Centre"
        result["lean_confidence"] = 55
    result["image_keyword"] = result["genre"].lower()
    return result


def fetch_and_classify():
    global _fetch_running, _last_fetch_count
    with _fetch_lock:
        if _fetch_running:
            print("[RSS] Fetch already in progress, skipping", flush=True)
            return
        _fetch_running = True

    try:
        print(f"[RSS] Starting fetch at {datetime.utcnow().isoformat()}", flush=True)
        articles = scraper.fetch_all_feeds()
        existing = database.get_existing_urls()
        now = datetime.utcnow().isoformat()
        records = []
        for article in articles:
            if article["url"] in existing:
                continue
            classification = _fast_classify(article["title"], article["source"])
            record = _build_record(article, classification, ingestion_source="rss")
            record["fetched_at"] = now
            records.append(record)
            existing.add(article["url"])

        new_count = database.insert_articles_batch(records)
        _last_fetch_count = new_count
        print(f"[RSS] Done — added {new_count} new articles", flush=True)
    finally:
        with _fetch_lock:
            _fetch_running = False


def run_agent_sync():
    if not AGENT_AVAILABLE or agent_module is None:
        print("[Agent] Skipped — TAVILY_API_KEY not set")
        return
    loop = None
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(agent_module.run_agent())
    except Exception as e:
        print(f"[Agent] Error: {e}")
    finally:
        if loop is not None:
            loop.close()


_TESTING = os.getenv("PYTEST_CURRENT_TEST") is not None or os.getenv("DISABLE_PIPELINES") == "1"

if not _TESTING:
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        fetch_and_classify, "interval", minutes=10, id="rss_job", max_instances=1
    )
    if AGENT_AVAILABLE:
        scheduler.add_job(
            run_agent_sync, "interval", minutes=60, id="agent_job", max_instances=1
        )
        print("[NewsLens] Agent pipeline enabled (Tavily key found)")
    else:
        print("[NewsLens] Agent pipeline disabled (no TAVILY_API_KEY)")
    scheduler.start()

    def _delayed_startup():
        time.sleep(2)
        fetch_and_classify()

    def _delayed_agent():
        time.sleep(5)
        if AGENT_AVAILABLE:
            run_agent_sync()

    threading.Thread(target=_delayed_startup, daemon=True).start()
    if AGENT_AVAILABLE:
        threading.Thread(target=_delayed_agent, daemon=True).start()


@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "NewsLens API",
        "pipelines": {"rss": True, "agent": AGENT_AVAILABLE},
    }


@app.get("/articles")
def list_articles(
    genre: Optional[str] = None,
    source: Optional[str] = None,
    lean: Optional[str] = None,
    is_rumour: Optional[bool] = None,
    is_transfer: Optional[bool] = None,
    is_breaking: Optional[bool] = None,
    ingestion_source: Optional[str] = None,
    limit: int = Query(50, le=200),
):
    return database.get_articles(
        genre=genre,
        source=source,
        lean=lean,
        is_rumour=is_rumour,
        is_transfer=is_transfer,
        is_breaking=is_breaking,
        ingestion_source=ingestion_source,
        limit=limit,
    )


@app.get("/trending")
def trending():
    return database.get_trending()


@app.get("/stats")
def stats():
    return database.get_stats()


@app.get("/rumours")
def rumours():
    return database.get_rumours()


@app.get("/transfers")
def transfers():
    return database.get_transfers()


@app.get("/sources/bias")
def source_bias():
    return database.get_source_bias()
