import os
import re
import threading

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

DB_LOCK = threading.Lock()


def get_connection():
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for PostgreSQL and no local DB fallback is enabled.")

    return psycopg.connect(
        database_url,
        row_factory=dict_row,
        connect_timeout=10,
    )


def init_db(conn):
    with DB_LOCK:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pages (
                id BIGSERIAL PRIMARY KEY,
                url TEXT UNIQUE NOT NULL,
                title TEXT,
                content TEXT,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                search_vector tsvector GENERATED ALWAYS AS (
                    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(content, '')), 'B')
                ) STORED
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_pages_search_vector
            ON pages USING GIN (search_vector)
            """
        )
        conn.commit()


def init_app_state(conn):
    with DB_LOCK:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                id SMALLINT PRIMARY KEY,
                settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                agents JSONB NOT NULL DEFAULT '[]'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            INSERT INTO app_state (id, settings, agents)
            VALUES (1, '{}'::jsonb, '[]'::jsonb)
            ON CONFLICT (id) DO NOTHING
            """
        )
        conn.commit()


def get_settings(conn):
    with DB_LOCK:
        row = conn.execute("SELECT settings FROM app_state WHERE id = 1").fetchone()
    if not row:
        return {}
    return dict(row["settings"] or {})


def save_settings(conn, partial):
    with DB_LOCK:
        conn.execute(
            """
            UPDATE app_state
            SET settings = coalesce(settings, '{}'::jsonb) || %s::jsonb,
                updated_at = now()
            WHERE id = 1
            """,
            (Json(partial),),
        )
        conn.commit()
    return get_settings(conn)


def get_agents(conn):
    with DB_LOCK:
        row = conn.execute("SELECT agents FROM app_state WHERE id = 1").fetchone()
    if not row:
        return []
    agents = row["agents"] or []
    return list(agents)


def save_agents(conn, agents):
    with DB_LOCK:
        conn.execute(
            """
            UPDATE app_state
            SET agents = %s::jsonb,
                updated_at = now()
            WHERE id = 1
            """,
            (Json(agents),),
        )
        conn.commit()
    return get_agents(conn)


def _fts_query(text):
    tokens = re.findall(r"[a-zA-Z0-9]+", text.lower())
    if not tokens:
        return ""
    return " OR ".join(tokens)


def upsert_page(conn, url, title, content):
    with DB_LOCK:
        conn.execute(
            """
            INSERT INTO pages (url, title, content, fetched_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT(url) DO UPDATE SET
                title = excluded.title,
                content = excluded.content,
                fetched_at = excluded.fetched_at
            """,
            (url, title, content)
        )
        conn.commit()


def search(conn, query, limit=20):
    normalized_query = _fts_query(query)
    if not normalized_query:
        return []

    ts_query = normalized_query.replace(" OR ", " | ")

    with DB_LOCK:
        rows = conn.execute(
            """
            SELECT url,
                   title,
                   ts_headline(
                       'english',
                       coalesce(content, ''),
                       to_tsquery('english', %s),
                       'StartSel=<mark>,StopSel=</mark>,MaxWords=14,MinWords=6,ShortWord=2'
                   ) AS snippet,
                   ts_rank_cd(search_vector, to_tsquery('english', %s)) AS rank
            FROM pages
            WHERE search_vector @@ to_tsquery('english', %s)
            ORDER BY rank DESC
            LIMIT %s
            """,
            (ts_query, ts_query, ts_query, limit)
        ).fetchall()

    results = []
    for row in rows:
        results.append({
            "url": row["url"],
            "title": row["title"] or row["url"],
            "snippet": row["snippet"] or "",
            "rank": row["rank"]
        })

    return results


def get_index_stats(conn):
    with DB_LOCK:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS page_count,
                EXTRACT(EPOCH FROM (now() - MAX(fetched_at))) / 3600.0 AS age_hours
            FROM pages
            """
        ).fetchone()

    if not row:
        return {"page_count": 0, "age_hours": None}

    return {
        "page_count": int(row["page_count"] or 0),
        "age_hours": float(row["age_hours"]) if row["age_hours"] is not None else None,
    }


def reset_db():
    conn = get_connection()
    with DB_LOCK:
        init_db(conn)
        conn.execute("TRUNCATE TABLE pages RESTART IDENTITY")
        conn.commit()
    conn.close()
