import hashlib
import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import List, Optional

logger = logging.getLogger("newslens")


def _resolve_db_path() -> str:
    env_path = os.getenv("DB_PATH", "/data/newslens.db")
    data_dir = os.path.dirname(env_path) or None
    if data_dir:
        try:
            os.makedirs(data_dir, exist_ok=True)
            return env_path
        except OSError as exc:
            fallback = os.path.join(os.path.dirname(__file__), "newslens.db")
            logger.error(
                "Failed to create data directory %s (%s); using fallback %s",
                data_dir,
                exc,
                fallback,
            )
            return fallback
    return os.path.join(os.path.dirname(__file__), "newslens.db")


DB_PATH = _resolve_db_path()

_MEMORY_URI = "file:newslens_test?mode=memory&cache=shared"

RUMOUR_KEYWORDS = [
    "rumour",
    "rumor",
    "reportedly",
    "sources claim",
    "according to sources",
    "could sign",
    "set to sign",
    "eyeing",
    "in talks",
    "considering",
    "linked with",
    "linked to",
    "shock move",
    "surprise interest",
    "transfer target",
    "could join",
    "expected to",
    "per sources",
]

_INSERT_SQL = """
    INSERT OR IGNORE INTO articles (
        title, url, source, published_at, fetched_at, summary,
        lean, lean_confidence, genre, subgenre,
        is_rumour, rumour_true_probability, rumour_false_probability,
        rumour_verdict, is_breaking, is_transfer,
        transfer_player, transfer_from, transfer_to, transfer_fee,
        image_keyword, ingestion_source
    ) VALUES (
        :title, :url, :source, :published_at, :fetched_at, :summary,
        :lean, :lean_confidence, :genre, :subgenre,
        :is_rumour, :rumour_true_probability, :rumour_false_probability,
        :rumour_verdict, :is_breaking, :is_transfer,
        :transfer_player, :transfer_from, :transfer_to, :transfer_fee,
        :image_keyword, :ingestion_source
    )
"""


def _rumour_keyword_clause() -> str:
    conditions = [f"LOWER(title) LIKE '%{kw}%'" for kw in RUMOUR_KEYWORDS]
    return "(" + " OR ".join(conditions) + ")"


def _configure_conn(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    if DB_PATH != ":memory:":
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")


def get_conn() -> sqlite3.Connection:
    if DB_PATH == ":memory:":
        conn = sqlite3.connect(_MEMORY_URI, uri=True, check_same_thread=False)
    else:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    _configure_conn(conn)
    return conn


@contextmanager
def db_conn():
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


def check_db_writable() -> bool:
    try:
        with db_conn() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS _health_probe (id INTEGER)")
            conn.execute("DROP TABLE IF EXISTS _health_probe")
            conn.commit()
        return True
    except Exception as exc:
        logger.warning("DB writable check failed: %s", exc)
        return False


def get_article_count() -> int:
    with db_conn() as conn:
        row = conn.execute("SELECT COUNT(*) FROM articles").fetchone()
        return int(row[0]) if row else 0


def _rebuild_fts(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO articles_fts(articles_fts) VALUES('rebuild')")


def _ensure_fts_triggers(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
            INSERT INTO articles_fts(rowid, title, summary, genre)
            VALUES (new.id, new.title, new.summary, new.genre);
        END
        """
    )
    conn.execute(
        """
        CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, title, summary, genre)
            VALUES ('delete', old.id, old.title, old.summary, old.genre);
        END
        """
    )
    conn.execute(
        """
        CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, title, summary, genre)
            VALUES ('delete', old.id, old.title, old.summary, old.genre);
            INSERT INTO articles_fts(rowid, title, summary, genre)
            VALUES (new.id, new.title, new.summary, new.genre);
        END
        """
    )


def init_db() -> None:
    with db_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                url TEXT UNIQUE NOT NULL,
                source TEXT NOT NULL,
                published_at TEXT,
                fetched_at TEXT NOT NULL,
                summary TEXT,
                lean TEXT DEFAULT 'Unclear',
                lean_confidence INTEGER DEFAULT 0,
                genre TEXT DEFAULT 'Other',
                subgenre TEXT DEFAULT 'Other',
                is_rumour INTEGER DEFAULT 0,
                rumour_true_probability INTEGER DEFAULT 50,
                rumour_false_probability INTEGER DEFAULT 50,
                rumour_verdict TEXT DEFAULT 'Unverified',
                is_breaking INTEGER DEFAULT 0,
                is_transfer INTEGER DEFAULT 0,
                transfer_player TEXT,
                transfer_from TEXT,
                transfer_to TEXT,
                transfer_fee TEXT,
                image_keyword TEXT,
                ingestion_source TEXT DEFAULT 'rss'
            )
            """
        )
        try:
            conn.execute(
                "ALTER TABLE articles ADD COLUMN ingestion_source TEXT DEFAULT 'rss'"
            )
        except sqlite3.OperationalError:
            pass

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingest_status (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                running INTEGER DEFAULT 0,
                total_to_process INTEGER DEFAULT 0,
                processed INTEGER DEFAULT 0,
                last_added INTEGER DEFAULT 0,
                last_added_at TEXT,
                last_fetch_at TEXT
            )
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO ingest_status (id, running, total_to_process, processed)
            VALUES (1, 0, 0, 0)
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS classification_cache (
                url_hash TEXT PRIMARY KEY,
                classification TEXT NOT NULL,
                cached_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
                title, summary, genre,
                content='articles', content_rowid='id'
            )
            """
        )

        _ensure_fts_triggers(conn)

        fts_count = conn.execute("SELECT COUNT(*) FROM articles_fts").fetchone()[0]
        article_count = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
        if article_count > 0 and fts_count == 0:
            _rebuild_fts(conn)

        conn.commit()
    logger.info("DB persistence: %s", DB_PATH)


def reset_ingest_status(
    running: bool,
    total_to_process: int = 0,
    processed: int = 0,
) -> None:
    with db_conn() as conn:
        conn.execute(
            """
            UPDATE ingest_status
            SET running = ?, total_to_process = ?, processed = ?, last_added = 0
            WHERE id = 1
            """,
            (1 if running else 0, total_to_process, processed),
        )
        conn.commit()


def update_ingest_progress(processed: int, last_added: int = 0) -> None:
    now = datetime.utcnow().isoformat()
    with db_conn() as conn:
        conn.execute(
            """
            UPDATE ingest_status
            SET processed = ?,
                last_added = last_added + ?,
                last_added_at = ?,
                last_fetch_at = ?
            WHERE id = 1
            """,
            (processed, last_added, now, now),
        )
        conn.commit()


def finish_ingest(last_added: int) -> None:
    now = datetime.utcnow().isoformat()
    with db_conn() as conn:
        conn.execute(
            """
            UPDATE ingest_status
            SET running = 0,
                last_added = ?,
                last_added_at = ?,
                last_fetch_at = ?
            WHERE id = 1
            """,
            (last_added, now, now),
        )
        conn.commit()


def get_ingest_status() -> dict:
    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT running, total_to_process, processed, last_added, last_added_at, last_fetch_at
            FROM ingest_status WHERE id = 1
            """
        ).fetchone()
    if not row:
        return {
            "running": False,
            "total_to_process": 0,
            "processed": 0,
            "last_added": 0,
            "last_added_at": None,
            "last_fetch_at": None,
        }
    return {
        "running": bool(row["running"]),
        "total_to_process": row["total_to_process"],
        "processed": row["processed"],
        "last_added": row["last_added"],
        "last_added_at": row["last_added_at"],
        "last_fetch_at": row["last_fetch_at"],
    }


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def get_cached_classification(url: str) -> Optional[dict]:
    url_hash = _url_hash(url)
    with db_conn() as conn:
        row = conn.execute(
            "SELECT classification FROM classification_cache WHERE url_hash = ?",
            (url_hash,),
        ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["classification"])
    except json.JSONDecodeError:
        return None


def cache_classification(url: str, classification: dict) -> None:
    url_hash = _url_hash(url)
    with db_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO classification_cache (url_hash, classification, cached_at)
            VALUES (?, ?, ?)
            """,
            (url_hash, json.dumps(classification), datetime.utcnow().isoformat()),
        )
        conn.commit()


def url_exists(url: str) -> bool:
    with db_conn() as conn:
        row = conn.execute("SELECT 1 FROM articles WHERE url = ?", (url,)).fetchone()
        return row is not None


def get_existing_urls() -> set:
    with db_conn() as conn:
        rows = conn.execute("SELECT url FROM articles").fetchall()
        return {row["url"] for row in rows}


def insert_articles_batch(records: List[dict]) -> int:
    if not records:
        return 0
    added = 0
    with db_conn() as conn:
        for record in records:
            cursor = conn.execute(_INSERT_SQL, record)
            if cursor.rowcount > 0:
                added += 1
        conn.commit()
    return added


def insert_article(data: dict) -> int:
    with db_conn() as conn:
        cursor = conn.execute(_INSERT_SQL, data)
        conn.commit()
        return cursor.rowcount


def _row_to_dict(row) -> dict:
    return dict(row)


def get_articles(
    genre=None,
    source=None,
    lean=None,
    is_rumour=None,
    is_transfer=None,
    is_breaking=None,
    ingestion_source=None,
    limit=50,
):
    query = "SELECT * FROM articles WHERE 1=1"
    params = []

    if genre is not None:
        query += " AND genre = ?"
        params.append(genre)
    if source is not None:
        query += " AND source = ?"
        params.append(source)
    if lean is not None:
        query += " AND lean = ?"
        params.append(lean)
    if is_rumour is not None:
        query += " AND is_rumour = ?"
        params.append(1 if is_rumour else 0)
    if is_transfer is not None:
        query += " AND is_transfer = ?"
        params.append(1 if is_transfer else 0)
    if is_breaking is not None:
        query += " AND is_breaking = ?"
        params.append(1 if is_breaking else 0)
    if ingestion_source is not None:
        query += " AND ingestion_source = ?"
        params.append(ingestion_source)

    query += " ORDER BY fetched_at DESC LIMIT ?"
    params.append(limit)

    with db_conn() as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_dict(r) for r in rows]


def search_articles(query: str, limit: int = 20) -> List[dict]:
    if len(query.strip()) < 3:
        return []

    fts_query = " ".join(f'"{token}"*' for token in query.strip().split() if token)
    if not fts_query:
        return []

    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT articles.*
            FROM articles
            JOIN articles_fts ON articles.id = articles_fts.rowid
            WHERE articles_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts_query, limit),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]


def get_trending():
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT *,
                (
                    (1.0 / MAX(1, CAST((julianday('now') - julianday(fetched_at)) * 1440 AS INTEGER))) * 0.5
                    + is_breaking * 0.3
                    + lean_confidence * 0.002
                ) AS trending_score
            FROM articles
            ORDER BY trending_score DESC
            LIMIT 5
            """
        ).fetchall()
        return [_row_to_dict(r) for r in rows]


def get_stats():
    rumour_clause = _rumour_keyword_clause()
    with db_conn() as conn:
        total = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
        rumours = conn.execute(
            f"SELECT COUNT(*) FROM articles WHERE is_rumour = 1 OR {rumour_clause}"
        ).fetchone()[0]
        transfers = conn.execute(
            "SELECT COUNT(*) FROM articles WHERE is_transfer = 1"
        ).fetchone()[0]
        rss_count = conn.execute(
            "SELECT COUNT(*) FROM articles WHERE ingestion_source = 'rss'"
        ).fetchone()[0]
        agent_count = conn.execute(
            "SELECT COUNT(*) FROM articles WHERE ingestion_source = 'agent'"
        ).fetchone()[0]
        lean_rows = conn.execute(
            "SELECT lean, COUNT(*) as cnt FROM articles GROUP BY lean"
        ).fetchall()
        genre_rows = conn.execute(
            "SELECT genre, COUNT(*) as cnt FROM articles GROUP BY genre ORDER BY cnt DESC"
        ).fetchall()

    lean_breakdown = {}
    if total > 0:
        for row in lean_rows:
            lean_breakdown[row["lean"]] = round(row["cnt"] / total * 100, 1)

    genres_breakdown = {row["genre"]: row["cnt"] for row in genre_rows}

    return {
        "total": total,
        "rumours": rumours,
        "transfers": transfers,
        "rss_count": rss_count,
        "agent_count": agent_count,
        "lean_breakdown": lean_breakdown,
        "genres_breakdown": genres_breakdown,
    }


def get_rumours():
    rumour_clause = _rumour_keyword_clause()
    with db_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM articles
            WHERE is_rumour = 1 OR {rumour_clause}
            ORDER BY fetched_at DESC
            LIMIT 100
            """
        ).fetchall()
        return [_row_to_dict(r) for r in rows]


def get_transfers():
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM articles WHERE is_transfer = 1 ORDER BY fetched_at DESC"
        ).fetchall()
        return [_row_to_dict(r) for r in rows]


def get_source_bias():
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT source, lean, COUNT(*) as cnt
            FROM articles
            GROUP BY source, lean
            ORDER BY source, cnt DESC
            """
        ).fetchall()

    result = {}
    for row in rows:
        source = row["source"]
        if source not in result:
            result[source] = {}
        result[source][row["lean"]] = row["cnt"]
    return result
