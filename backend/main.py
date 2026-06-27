import asyncio
import os
import threading
import time
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from logging_config import log_event, setup_logging

load_dotenv()
logger = setup_logging(os.getenv("LOG_LEVEL", "INFO"))

import classifier
import database
import scraper
from classifier import BATCH_SIZE, DEFAULT_RESULT

try:
    import agent as agent_module

    AGENT_AVAILABLE = bool(os.getenv("TAVILY_API_KEY"))
except ImportError:
    agent_module = None
    AGENT_AVAILABLE = False

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "0") == "1"
COLD_START_CAP = int(os.getenv("COLD_START_CAP", "50"))
FETCH_RATE_LIMIT_PER_HOUR = int(os.getenv("FETCH_RATE_LIMIT", "5"))

app = FastAPI(title="NewsLens API")

_cors_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
if _cors_origins:
    _origins = [o.strip() for o in _cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

database.init_db()
logger.info("DB persistence: %s", database.DB_PATH)

_FRONTEND_CANDIDATES = [
    os.path.join(os.path.dirname(__file__), "..", "frontend"),
    os.path.join(os.path.dirname(__file__), "frontend"),
    "/opt/render/project/src/frontend",
]
FRONTEND_DIR = next((p for p in _FRONTEND_CANDIDATES if os.path.isdir(p)), None)
if FRONTEND_DIR:
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


def _format_ago(iso_ts: Optional[str]) -> Optional[str]:
    if not iso_ts:
        return None
    try:
        then = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if then.tzinfo:
            then = then.replace(tzinfo=None)
        delta = datetime.utcnow() - then
        mins = int(delta.total_seconds() // 60)
        if mins < 1:
            return "just now"
        if mins < 60:
            return f"{mins} minute{'s' if mins != 1 else ''} ago"
        hrs = mins // 60
        if hrs < 24:
            return f"{hrs} hour{'s' if hrs != 1 else ''} ago"
        days = hrs // 24
        return f"{days} day{'s' if days != 1 else ''} ago"
    except ValueError:
        return iso_ts


@app.get("/health")
def health():
    ingest = database.get_ingest_status()
    feeds_up = sum(1 for f in _feed_status.values() if f.get("ok"))
    feeds_down = sum(1 for f in _feed_status.values() if not f.get("ok"))
    db_writable = database.check_db_writable()
    article_count = database.get_article_count()
    healthy = db_writable and not (_fetch_running and article_count == 0)

    return {
        "status": "healthy" if healthy else "degraded",
        "db_path": database.DB_PATH,
        "db_writable": db_writable,
        "article_count": article_count,
        "feeds_up": feeds_up,
        "feeds_down": feeds_down,
        "last_fetch": _format_ago(ingest.get("last_fetch_at")),
        "fetch_running": _fetch_running or ingest.get("running", False),
        "classifier": "gemini" if GEMINI_API_KEY else "rules",
    }


_fetch_lock = threading.Lock()
_fetch_running = False
_last_fetch_count = 0
_feed_status = {}
_fetch_rate_limit: dict[str, list[float]] = {}
_fetch_rate_lock = threading.Lock()


def _check_admin(request: Request, x_admin_token: Optional[str]) -> None:
    if not ADMIN_TOKEN:
        return
    token = x_admin_token or request.headers.get("X-Admin-Token")
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _check_fetch_rate_limit(client_ip: str) -> None:
    if not RATE_LIMIT_ENABLED and not ADMIN_TOKEN:
        return
    now = time.time()
    with _fetch_rate_lock:
        timestamps = [t for t in _fetch_rate_limit.get(client_ip, []) if now - t < 3600]
        if len(timestamps) >= FETCH_RATE_LIMIT_PER_HOUR:
            raise HTTPException(status_code=429, detail="Rate limited")
        timestamps.append(now)
        _fetch_rate_limit[client_ip] = timestamps


@app.post("/fetch")
def trigger_fetch(
    request: Request,
    x_admin_token: Optional[str] = Header(None),
):
    """Manually start RSS ingestion (runs in background)."""
    _check_admin(request, x_admin_token)
    client_ip = request.client.host if request.client else "unknown"
    _check_fetch_rate_limit(client_ip)

    with _fetch_lock:
        if _fetch_running:
            return {"status": "running", "message": "Fetch already in progress"}
    threading.Thread(target=fetch_and_classify, daemon=True).start()
    log_event(logger, "Manual fetch triggered", client_ip=client_ip)
    return {"status": "started", "message": "RSS fetch started in background"}


@app.get("/fetch/status")
def fetch_status():
    ingest = database.get_ingest_status()
    return {
        "running": _fetch_running or ingest.get("running", False),
        "last_added": ingest.get("last_added", _last_fetch_count),
        "total": database.get_stats()["total"],
        "processed": ingest.get("processed", 0),
        "total_to_process": ingest.get("total_to_process", 0),
        "last_added_at": ingest.get("last_added_at"),
    }


@app.get("/search")
def search(q: str = Query("", min_length=0), limit: int = Query(20, le=100)):
    return database.search_articles(q, limit=limit)


@app.get("/sources/status")
def sources_status():
    return _feed_status


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
    "rumour",
    "rumor",
    "reportedly",
    "linked with",
    "set to sign",
    "in talks",
    "sources claim",
    "could sign",
)


def _fast_classify(title: str, source: str) -> dict:
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


def _fetch_rss_articles() -> list[dict]:
    all_articles = []
    seen_urls = set()
    for source_name, feed_url in scraper.FEEDS:
        run_ts = datetime.utcnow().isoformat()
        articles = []
        for attempt in range(3):
            try:
                result = scraper.fetch_feed(feed_url, source_name)
                if result:
                    articles = result
                    break
            except Exception:
                if attempt < 2:
                    time.sleep(2**attempt)
        if articles:
            _feed_status[source_name] = {
                "ok": True,
                "last_count": len(articles),
                "last_run": run_ts,
            }
            for a in articles:
                if a["url"] not in seen_urls:
                    seen_urls.add(a["url"])
                    all_articles.append(a)
        else:
            logger.warning("RSS feed failed after retries: %s", source_name)
            _feed_status[source_name] = {
                "ok": False,
                "last_count": 0,
                "last_run": run_ts,
            }
    return all_articles


def _process_articles_incremental(new_articles: list[dict]) -> int:
    """Classify in batches and insert after each batch."""
    total_added = 0
    processed = 0
    now = datetime.utcnow().isoformat()

    for i in range(0, len(new_articles), BATCH_SIZE):
        batch = new_articles[i : i + BATCH_SIZE]
        classifications = classifier.batch_classify_with_cache(batch, _fast_classify)

        records = []
        for article, classification in zip(batch, classifications):
            record = _build_record(article, classification, ingestion_source="rss")
            record["fetched_at"] = now
            records.append(record)

        added = database.insert_articles_batch(records)
        total_added += added
        processed += len(batch)
        database.update_ingest_progress(processed=processed, last_added=added)
        log_event(
            logger,
            "Ingest batch inserted",
            batch_size=len(batch),
            added=added,
            processed=processed,
        )

        if GEMINI_API_KEY and i + BATCH_SIZE < len(new_articles):
            time.sleep(1)

    return total_added


def fetch_and_classify():
    global _fetch_running, _last_fetch_count
    with _fetch_lock:
        if _fetch_running:
            logger.info("Fetch already in progress, skipping")
            return
        _fetch_running = True

    total_added = 0
    try:
        started_at = datetime.utcnow().isoformat()
        log_event(logger, "Ingest started", feed_count=len(scraper.FEEDS))

        all_articles = _fetch_rss_articles()
        log_event(logger, "RSS fetch complete", article_count=len(all_articles))

        existing = database.get_existing_urls()
        new_articles = [a for a in all_articles if a["url"] not in existing]

        if not new_articles:
            logger.info("No new articles to classify")
            database.finish_ingest(0)
            _last_fetch_count = 0
            return

        is_cold_start = database.get_article_count() == 0
        if is_cold_start and len(new_articles) > COLD_START_CAP:
            new_articles.sort(
                key=lambda a: a.get("published_at") or "",
                reverse=True,
            )
            new_articles = new_articles[:COLD_START_CAP]
            log_event(
                logger,
                "Cold start cap applied",
                cap=COLD_START_CAP,
                total_available=len(all_articles),
            )

        database.reset_ingest_status(
            running=True,
            total_to_process=len(new_articles),
            processed=0,
        )

        mode = "gemini" if GEMINI_API_KEY else "rules"
        log_event(
            logger,
            "Classification started",
            mode=mode,
            count=len(new_articles),
        )

        total_added = _process_articles_incremental(new_articles)
        _last_fetch_count = total_added
        database.finish_ingest(total_added)
        log_event(
            logger,
            "Ingest complete",
            added=total_added,
            started_at=started_at,
        )

    except Exception as exc:
        logger.exception("Ingest failed: %s", exc)
        database.finish_ingest(total_added)
    finally:
        with _fetch_lock:
            _fetch_running = False


def run_agent_sync():
    if not AGENT_AVAILABLE or agent_module is None:
        logger.info("Agent skipped — TAVILY_API_KEY not set")
        return
    loop = None
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(agent_module.run_agent())
    except Exception as exc:
        logger.exception("Agent error: %s", exc)
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
        logger.info("Agent pipeline enabled (Tavily key found)")
    else:
        logger.info("Agent pipeline disabled (no TAVILY_API_KEY)")
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
        "classifier": "gemini" if GEMINI_API_KEY else "rules",
        "db_path": database.DB_PATH,
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
