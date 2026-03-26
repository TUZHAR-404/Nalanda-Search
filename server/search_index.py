import os
import re
import threading
import json
import sqlite3
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

DB_LOCK = threading.Lock()


def _is_sqlite(conn):
    return isinstance(conn, sqlite3.Connection)


def get_connection():
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        db_path = Path(__file__).resolve().parent / "data" / "nalanda.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    return psycopg.connect(
        database_url,
        row_factory=dict_row,
        connect_timeout=10,
    )


def init_db(conn):
    if _is_sqlite(conn):
        with DB_LOCK:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS pages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT UNIQUE NOT NULL,
                    title TEXT,
                    content TEXT,
                    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.commit()
        return

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
    if _is_sqlite(conn):
        with DB_LOCK:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                    id INTEGER PRIMARY KEY,
                    settings TEXT NOT NULL DEFAULT '{}',
                    agents TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO app_state (id, settings, agents)
                VALUES (1, '{}', '[]')
                """
            )
            conn.commit()
        return

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
    if _is_sqlite(conn):
        raw = row["settings"] or "{}"
        try:
            return dict(json.loads(raw))
        except Exception:
            return {}
    return dict(row["settings"] or {})


def save_settings(conn, partial):
    if _is_sqlite(conn):
        current = get_settings(conn)
        merged = dict(current)
        merged.update(partial or {})
        with DB_LOCK:
            conn.execute(
                """
                UPDATE app_state
                SET settings = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
                """,
                (json.dumps(merged),),
            )
            conn.commit()
        return merged

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
    if _is_sqlite(conn):
        raw = row["agents"] or "[]"
        try:
            agents = json.loads(raw)
            return list(agents) if isinstance(agents, list) else []
        except Exception:
            return []
    agents = row["agents"] or []
    return list(agents)


def save_agents(conn, agents):
    if _is_sqlite(conn):
        payload = agents if isinstance(agents, list) else []
        with DB_LOCK:
            conn.execute(
                """
                UPDATE app_state
                SET agents = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
                """,
                (json.dumps(payload),),
            )
            conn.commit()
        return payload

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

    if _is_sqlite(conn):
        tokens = [t for t in re.findall(r"[a-zA-Z0-9]+", query.lower()) if t]
        if not tokens:
            return []

        like_clauses = []
        params = []
        for token in tokens:
            like_clauses.append("(lower(coalesce(title, '')) LIKE ? OR lower(coalesce(content, '')) LIKE ?)")
            wild = f"%{token}%"
            params.extend([wild, wild])

        sql = f"""
            SELECT url, title, content
            FROM pages
            WHERE {' OR '.join(like_clauses)}
            ORDER BY fetched_at DESC
            LIMIT ?
        """
        params.append(limit)

        with DB_LOCK:
            rows = conn.execute(sql, params).fetchall()

        results = []
        for row in rows:
            content = row["content"] or ""
            lowered = content.lower()
            idx = -1
            matched = ""
            for token in tokens:
                pos = lowered.find(token)
                if pos != -1:
                    idx = pos
                    matched = token
                    break
            if idx == -1:
                snippet = content[:160]
            else:
                start = max(0, idx - 60)
                end = min(len(content), idx + 100)
                snippet = content[start:end]
                if matched:
                    snippet = re.sub(
                        re.escape(matched),
                        f"<mark>{matched}</mark>",
                        snippet,
                        flags=re.IGNORECASE,
                    )

            rank = 0.0
            haystack = f"{(row['title'] or '')} {content}".lower()
            for token in tokens:
                rank += haystack.count(token)

            results.append({
                "url": row["url"],
                "title": row["title"] or row["url"],
                "snippet": snippet,
                "rank": float(rank),
            })

        return sorted(results, key=lambda r: r["rank"], reverse=True)

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
    if _is_sqlite(conn):
        with DB_LOCK:
            row = conn.execute(
                """
                SELECT
                    COUNT(*) AS page_count,
                    (julianday('now') - julianday(MAX(fetched_at))) * 24.0 AS age_hours
                FROM pages
                """
            ).fetchone()

        if not row:
            return {"page_count": 0, "age_hours": None}

        return {
            "page_count": int(row["page_count"] or 0),
            "age_hours": float(row["age_hours"]) if row["age_hours"] is not None else None,
        }

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
        if _is_sqlite(conn):
            conn.execute("DELETE FROM pages")
            conn.execute("DELETE FROM sqlite_sequence WHERE name = 'pages'")
        else:
            conn.execute("TRUNCATE TABLE pages RESTART IDENTITY")
        conn.commit()
    conn.close()
