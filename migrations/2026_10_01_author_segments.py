"""
author_role e is_top_voice: quién firma el post.

POR QUÉ: un post de un CEO y uno de una analista con el mismo hook no rinden por
lo mismo — el primero trae la autoridad del cargo. Sin el rol, la síntesis
atribuye al copy lo que era del firmante. Se usa para segmentar, no para el
ranking.

Los valores se calculan en código (lib/content/author-segment.ts, regex sobre la
bio) y los escribe refreshAuthorSegments en cada corrida de discovery.

Rollback:
    ALTER TABLE content_authors DROP COLUMN author_role, DROP COLUMN is_top_voice;

Usage:
    python3 migrations/2026_10_01_author_segments.py --dry-run
    python3 migrations/2026_10_01_author_segments.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
ALTER TABLE content_authors
    ADD COLUMN IF NOT EXISTS author_role text,
    ADD COLUMN IF NOT EXISTS is_top_voice boolean NOT NULL DEFAULT false;
"""

STEPS = [("author_role e is_top_voice en content_authors", SQL)]


def main() -> int:
    if "--dry-run" in sys.argv:
        for label, sql in STEPS:
            print(f"-- ── {label} " + "─" * max(0, 50 - len(label)))
            print(sql)
        return 0

    import config  # noqa
    import psycopg2  # noqa

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SET statement_timeout = '60s';")
        for index, (label, sql) in enumerate(STEPS, start=1):
            print(f"  [{index}/{len(STEPS)}] {label}...")
            cur.execute(sql)
        conn.commit()
        print("✓ listo.")
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Falló (rollback): {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
