import argparse
import sqlite3
from pathlib import Path

from server.search_index import get_connection, init_db, upsert_page


def migrate(sqlite_path: Path, batch_size: int = 500):
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite file not found: {sqlite_path}")

    src = sqlite3.connect(str(sqlite_path))
    src.row_factory = sqlite3.Row

    dst = get_connection()
    init_db(dst)

    total = 0
    migrated = 0

    try:
        total_row = src.execute("SELECT COUNT(*) AS count FROM pages").fetchone()
        total = int(total_row["count"] or 0)

        cursor = src.execute("SELECT url, title, content FROM pages ORDER BY id")

        buffer = []
        for row in cursor:
            buffer.append((row["url"], row["title"], row["content"]))

            if len(buffer) >= batch_size:
                for url, title, content in buffer:
                    upsert_page(dst, url, title, content)
                    migrated += 1
                buffer.clear()
                print(f"Migrated {migrated}/{total}")

        if buffer:
            for url, title, content in buffer:
                upsert_page(dst, url, title, content)
                migrated += 1
            print(f"Migrated {migrated}/{total}")

    finally:
        src.close()
        dst.close()

    return total, migrated


def main():
    parser = argparse.ArgumentParser(description="Migrate SQLite pages table to PostgreSQL")
    parser.add_argument(
        "--sqlite-path",
        default="server/data/nalanda.db",
        help="Path to existing SQLite DB file",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Batch size for migration progress logging",
    )
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite_path)
    total, migrated = migrate(sqlite_path, batch_size=args.batch_size)
    print(f"Done. Migrated {migrated} of {total} rows.")


if __name__ == "__main__":
    main()
