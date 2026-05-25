import sqlite3
from typing import List

DB_PATH = "newslens.db"
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


def _rumour_keyword_clause() -> str:
    conditions = [f"LOWER(title) LIKE '%{kw}%'" for kw in RUMOUR_KEYWORDS]
    return "(" + " OR ".join(conditions) + ")"


def get_conn():
    if DB_PATH == ":memory:":
        conn = sqlite3.connect(_MEMORY_URI, uri=True, check_same_thread=False)
    else:
        conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    try:
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
        conn.commit()
    finally:
        conn.close()


def url_exists(url: str) -> bool:
    conn = get_conn()
    try:
        row = conn.execute("SELECT 1 FROM articles WHERE url = ?", (url,)).fetchone()
        return row is not None
    finally:
        conn.close()


def get_existing_urls() -> set:
    conn = get_conn()
    try:
        rows = conn.execute("SELECT url FROM articles").fetchall()
        return {row["url"] for row in rows}
    finally:
        conn.close()


def insert_articles_batch(records: List[dict]) -> int:
    if not records:
        return 0
    conn = get_conn()
    try:
        conn.executemany(
            """
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
            """,
            records,
        )
        conn.commit()
        return conn.total_changes
    except Exception as e:
        print(f"[DB] insert_articles_batch error: {e}")
        return 0
    finally:
        conn.close()


def insert_article(data: dict):
    conn = get_conn()
    try:
        conn.execute(
            """
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
            """,
            data,
        )
        conn.commit()
    except Exception as e:
        print(f"[DB] insert_article error: {e}")
    finally:
        conn.close()


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

    conn = get_conn()
    try:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_trending():
    conn = get_conn()
    try:
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
    finally:
        conn.close()


def get_stats():
    conn = get_conn()
    rumour_clause = _rumour_keyword_clause()
    try:
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
    finally:
        conn.close()

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
    conn = get_conn()
    try:
        rows = conn.execute(
            f"""
            SELECT * FROM articles
            WHERE is_rumour = 1 OR {rumour_clause}
            ORDER BY fetched_at DESC
            LIMIT 100
            """
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_transfers():
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM articles WHERE is_transfer = 1 ORDER BY fetched_at DESC"
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_source_bias():
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT source, lean, COUNT(*) as cnt
            FROM articles
            GROUP BY source, lean
            ORDER BY source, cnt DESC
            """
        ).fetchall()
    finally:
        conn.close()

    result = {}
    for row in rows:
        source = row["source"]
        if source not in result:
            result[source] = {}
        result[source][row["lean"]] = row["cnt"]
    return result
