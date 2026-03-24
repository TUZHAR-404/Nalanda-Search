import time
import urllib.parse
import urllib.request
from collections import deque
from html.parser import HTMLParser

from .config import USER_AGENT
from .search_index import get_connection, init_db, upsert_page


class HTMLContentParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._in_script = False
        self._in_style = False
        self._in_title = False
        self.title = ""
        self.text_parts = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self._in_script = True
        elif tag == "style":
            self._in_style = True
        elif tag == "title":
            self._in_title = True

        if tag == "a":
            for key, value in attrs:
                if key == "href" and value:
                    self.links.append(value)

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_script = False
        elif tag == "style":
            self._in_style = False
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._in_script and not self._in_style:
            text = data.strip()
            if text:
                self.text_parts.append(text)


def _normalize_url(url):
    parsed = urllib.parse.urlparse(url)
    if not parsed.scheme:
        return None
    cleaned = parsed._replace(fragment="")
    return cleaned.geturl()


def _allowed_domain(host, domain):
    if host == domain:
        return True
    return host.endswith("." + domain)


def _fetch_html(url, timeout=10):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type", "")
        if "text/html" not in content_type:
            return None
        content = response.read()
        if len(content) > 2_000_000:
            return None
        return content.decode("utf-8", errors="ignore")


def crawl(domains, max_pages=200, max_depth=2, progress_cb=None):
    conn = get_connection()
    try:
        init_db(conn)

        queue = deque()
        visited = set()
        for domain in domains:
            queue.append((f"https://{domain}/", 0, domain))

        indexed = 0
        started = time.time()

        while queue and indexed < max_pages:
            url, depth, domain = queue.popleft()
            normalized = _normalize_url(url)
            if not normalized or normalized in visited:
                continue

            parsed = urllib.parse.urlparse(normalized)
            if not parsed.netloc:
                continue
            if not _allowed_domain(parsed.netloc, domain):
                continue

            visited.add(normalized)

            try:
                html = _fetch_html(normalized)
            except Exception:
                continue

            if not html:
                continue

            parser = HTMLContentParser()
            parser.feed(html)
            title = parser.title.strip() or normalized
            content = " ".join(parser.text_parts)
            if len(content) > 100_000:
                content = content[:100_000]

            upsert_page(conn, normalized, title, content)
            indexed += 1

            if progress_cb:
                progress_cb({
                    "indexed": indexed,
                    "queued": len(queue),
                    "last_url": normalized
                })

            if depth < max_depth:
                for link in parser.links:
                    absolute = urllib.parse.urljoin(normalized, link)
                    normalized_link = _normalize_url(absolute)
                    if not normalized_link or normalized_link in visited:
                        continue
                    queue.append((normalized_link, depth + 1, domain))

            time.sleep(0.2)

        duration = time.time() - started
        return {
            "indexed": indexed,
            "elapsed_seconds": round(duration, 2)
        }
    finally:
        conn.close()
