import argparse
import json
import os
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from pathlib import Path

from .config import (
    DOMAINS,
    DEFAULT_MAX_PAGES,
    DEFAULT_MAX_DEPTH,
    DEFAULT_AUTO_INDEX_ENABLED,
    DEFAULT_AUTO_INDEX_INTERVAL_MINUTES,
    DEFAULT_AUTO_INDEX_STALE_HOURS,
)
from .crawler import crawl
from .search_index import get_connection, get_index_stats, init_db, reset_db, search
from .search_index import init_app_state, get_settings, save_settings, get_agents, save_agents


ROOT_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT_DIR / "renderer"


class NalandaHandler(SimpleHTTPRequestHandler):
    CRAWL_LOCK = Lock()
    STATE_LOCK = Lock()
    CRAWL_STATE = {
        "running": False,
        "indexed": 0,
        "queued": 0,
        "max_pages": DEFAULT_MAX_PAGES,
        "max_depth": DEFAULT_MAX_DEPTH,
        "last_url": "",
        "started_at": None,
        "finished_at": None,
        "error": "",
        "trigger": "manual",
    }
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def _send_json(self, status_code, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/health"):
            self._send_json(200, {"status": "ok"})
            return
        if self.path.startswith("/api/search"):
            self._handle_search()
            return
        if self.path.startswith("/api/domains"):
            self._send_json(200, {"domains": DOMAINS})
            return
        if self.path.startswith("/api/crawl-status"):
            self._handle_crawl_status()
            return
        if self.path.startswith("/api/settings"):
            self._handle_get_settings()
            return
        if self.path.startswith("/api/agents"):
            self._handle_get_agents()
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/crawl"):
            self._handle_crawl()
            return
        if self.path.startswith("/api/reset"):
            self._handle_reset()
            return
        if self.path.startswith("/api/settings"):
            self._handle_save_settings()
            return
        if self.path.startswith("/api/agents"):
            self._handle_save_agents()
            return
        self._send_json(404, {"error": "Not found"})

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _handle_search(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        query = params.get("q", [""])[0].strip()
        if not query:
            self._send_json(400, {"error": "Query required"})
            return

        conn = None
        try:
            conn = get_connection()
            init_db(conn)
            results = search(conn, query, limit=20)
            self._send_json(200, {"results": results})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
        finally:
            if conn is not None:
                conn.close()

    def _handle_crawl(self):
        payload = self._read_json_body()

        max_pages = int(payload.get("max_pages", DEFAULT_MAX_PAGES))
        max_depth = int(payload.get("max_depth", DEFAULT_MAX_DEPTH))

        started = self.start_crawl(max_pages=max_pages, max_depth=max_depth, trigger="manual")
        if not started:
            self._send_json(409, {"error": "Crawl already running"})
            return
        self._send_json(202, {"status": "started"})

    @classmethod
    def start_crawl(cls, max_pages, max_depth, trigger="manual"):
        if not cls.CRAWL_LOCK.acquire(blocking=False):
            return False

        with cls.STATE_LOCK:
            cls.CRAWL_STATE.update({
                "running": True,
                "indexed": 0,
                "queued": 0,
                "max_pages": max_pages,
                "max_depth": max_depth,
                "last_url": "",
                "started_at": time.time(),
                "finished_at": None,
                "error": "",
                "trigger": trigger,
            })

        thread = threading.Thread(
            target=cls._run_crawl,
            args=(max_pages, max_depth),
            daemon=True,
        )
        thread.start()
        return True

    @classmethod
    def _run_crawl(cls, max_pages, max_depth):
        def _progress(update):
            with cls.STATE_LOCK:
                cls.CRAWL_STATE.update(update)

        try:
            summary = crawl(
                DOMAINS,
                max_pages=max_pages,
                max_depth=max_depth,
                progress_cb=_progress
            )
            with cls.STATE_LOCK:
                cls.CRAWL_STATE.update({
                    "running": False,
                    "indexed": summary.get("indexed", 0),
                    "finished_at": time.time()
                })
        except Exception as exc:
            with cls.STATE_LOCK:
                cls.CRAWL_STATE.update({
                    "running": False,
                    "error": str(exc),
                    "finished_at": time.time()
                })
        finally:
            cls.CRAWL_LOCK.release()

    def _handle_crawl_status(self):
        with self.STATE_LOCK:
            self._send_json(200, dict(self.CRAWL_STATE))

    def _handle_reset(self):
        if self.CRAWL_LOCK.locked():
            self._send_json(409, {"error": "Cannot reset while crawl is running"})
            return

        reset_db()
        with self.STATE_LOCK:
            self.CRAWL_STATE.update({
                "running": False,
                "indexed": 0,
                "queued": 0,
                "last_url": "",
                "started_at": None,
                "finished_at": None,
                "error": ""
            })
        self._send_json(200, {"status": "reset"})

    def _handle_get_settings(self):
        conn = None
        try:
            conn = get_connection()
            init_app_state(conn)
            self._send_json(200, {"settings": get_settings(conn)})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
        finally:
            if conn is not None:
                conn.close()

    def _handle_save_settings(self):
        conn = None
        try:
            payload = self._read_json_body()
            if not isinstance(payload, dict):
                self._send_json(400, {"error": "Invalid payload"})
                return

            conn = get_connection()
            init_app_state(conn)
            updated = save_settings(conn, payload)
            self._send_json(200, {"settings": updated})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
        finally:
            if conn is not None:
                conn.close()

    def _handle_get_agents(self):
        conn = None
        try:
            conn = get_connection()
            init_app_state(conn)
            self._send_json(200, {"agents": get_agents(conn)})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
        finally:
            if conn is not None:
                conn.close()

    def _handle_save_agents(self):
        conn = None
        try:
            payload = self._read_json_body()
            agents = payload.get("agents") if isinstance(payload, dict) else None
            if not isinstance(agents, list):
                self._send_json(400, {"error": "Invalid agents payload"})
                return

            conn = get_connection()
            init_app_state(conn)
            saved = save_agents(conn, agents)
            self._send_json(200, {"agents": saved})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
        finally:
            if conn is not None:
                conn.close()


def main():
    parser = argparse.ArgumentParser(description="Nalanda Search server")
    parser.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    parser.add_argument("--crawl", action="store_true", help="Run a crawl before serving")
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES)
    parser.add_argument("--max-depth", type=int, default=DEFAULT_MAX_DEPTH)
    parser.add_argument(
        "--auto-index",
        action=argparse.BooleanOptionalAction,
        default=DEFAULT_AUTO_INDEX_ENABLED,
        help="Enable/disable automatic indexing in the background",
    )
    parser.add_argument(
        "--auto-index-interval-minutes",
        type=int,
        default=DEFAULT_AUTO_INDEX_INTERVAL_MINUTES,
        help="How often to check whether auto-index should run",
    )
    parser.add_argument(
        "--auto-index-stale-hours",
        type=float,
        default=DEFAULT_AUTO_INDEX_STALE_HOURS,
        help="Re-index when data is older than this many hours",
    )
    parser.add_argument(
        "--auto-index-max-pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help="Max pages per automatic indexing run",
    )
    parser.add_argument(
        "--auto-index-max-depth",
        type=int,
        default=DEFAULT_MAX_DEPTH,
        help="Max crawl depth per automatic indexing run",
    )
    args = parser.parse_args()

    if args.crawl:
        crawl(DOMAINS, max_pages=args.max_pages, max_depth=args.max_depth)

    def auto_index_loop():
        interval_seconds = max(60, int(args.auto_index_interval_minutes * 60))
        while True:
            if NalandaHandler.CRAWL_LOCK.locked():
                time.sleep(interval_seconds)
                continue

            conn = None
            try:
                conn = get_connection()
                init_db(conn)
                stats = get_index_stats(conn)
                page_count = stats["page_count"]
                age_hours = stats["age_hours"]

                needs_index = page_count == 0 or age_hours is None or age_hours >= args.auto_index_stale_hours
                if needs_index:
                    NalandaHandler.start_crawl(
                        max_pages=args.auto_index_max_pages,
                        max_depth=args.auto_index_max_depth,
                        trigger="auto",
                    )
            except Exception:
                pass
            finally:
                if conn is not None:
                    conn.close()

            time.sleep(interval_seconds)

    server = ThreadingHTTPServer((args.host, args.port), NalandaHandler)
    if args.auto_index:
        threading.Thread(target=auto_index_loop, daemon=True).start()
    print(f"Nalanda Search running on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
