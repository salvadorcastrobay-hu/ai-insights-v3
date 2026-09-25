"""
Lo contable de cada post, y versionado del análisis antes de reclasificar.

TRES COSAS:

1. `content_posts.features` (jsonb): lo que se puede contar sin LLM —formato
   real, placas del carrusel, primera línea, emojis, links, collab, lead
   magnet, hora local—. Lo calcula `computeFeatures` (post-features.ts) en la
   ingesta; el backfill lo completa para lo viejo.

2. `content_posts.analysis_version` (text): el clasificador suma `cta_type` y
   `timeliness`, y deja de cortar el caption en 1200 caracteres (en 229 posts
   de LinkedIn el CTA quedó null porque estaba al final). Con dos versiones
   conviviendo, un agregado tiene que poder saber cuál es cuál.

3. `content_posts_analysis_archive`: el CLAUDE.md del repo pide no pisar
   insights sin versionar primero. El backfill copia acá el análisis anterior
   antes de reclasificar, con su modelo y su fecha. Sin RLS abierta: solo la
   service role lo lee, igual que el resto de las tablas content_*.

Rollback:
    DROP TABLE content_posts_analysis_archive;
    ALTER TABLE content_posts
      DROP COLUMN features,
      DROP COLUMN analysis_version;

Usage:
    python3 migrations/2026_09_23_post_features.py --dry-run
    python3 migrations/2026_09_23_post_features.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL_COLUMNS = """
ALTER TABLE content_posts
    ADD COLUMN IF NOT EXISTS features         jsonb,
    ADD COLUMN IF NOT EXISTS analysis_version text;
"""

SQL_ARCHIVE = """
CREATE TABLE IF NOT EXISTS content_posts_analysis_archive (
    id               bigserial PRIMARY KEY,
    platform         text        NOT NULL,
    post_id          text        NOT NULL,
    analysis         jsonb       NOT NULL,
    analysis_model   text,
    analysis_version text,
    analyzed_at      timestamptz,
    archived_at      timestamptz NOT NULL DEFAULT now(),
    reason           text
);

CREATE INDEX IF NOT EXISTS cpaa_post_idx
    ON content_posts_analysis_archive (platform, post_id);

ALTER TABLE content_posts_analysis_archive ENABLE ROW LEVEL SECURITY;
"""

STEPS = [
    ("features y analysis_version en content_posts", SQL_COLUMNS),
    ("content_posts_analysis_archive", SQL_ARCHIVE),
]


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
