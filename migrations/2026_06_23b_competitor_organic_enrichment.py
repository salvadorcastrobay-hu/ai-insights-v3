"""
Enriquecimiento para contenido orgánico de Instagram de competidores.

Agrega:
  - media archivada por post (images/videos)
  - perfiles orgánicos por competidor / marca propia
  - snapshots históricos de métricas públicas por post

Usage:
    python migrations/2026_06_23b_competitor_organic_enrichment.py --dry-run
    python migrations/2026_06_23b_competitor_organic_enrichment.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
ALTER TABLE competitor_organic_posts
    ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '{"images":[],"videos":[]}'::jsonb;

CREATE TABLE IF NOT EXISTS competitor_organic_profiles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor      text NOT NULL UNIQUE,
    handle          text NOT NULL,
    is_own_brand    boolean NOT NULL DEFAULT false,
    profile_url     text,
    full_name       text,
    biography       text,
    website         text,
    followers_count int,
    following_count int,
    posts_count     int,
    avatar_url      text,
    raw             jsonb,
    fetched_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cop_handle_idx ON competitor_organic_profiles (handle);
CREATE INDEX IF NOT EXISTS cop_own_brand_idx ON competitor_organic_profiles (is_own_brand);

CREATE TABLE IF NOT EXISTS competitor_organic_metric_snapshots (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor      text NOT NULL,
    post_id         text NOT NULL,
    snapshot_at     timestamptz NOT NULL DEFAULT now(),
    likes_count     int,
    comments_count  int,
    video_views     int,
    followers_count int,
    engagement_rate numeric,
    raw             jsonb
);

CREATE INDEX IF NOT EXISTS coms_competitor_post_idx
    ON competitor_organic_metric_snapshots (competitor, post_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS coms_snapshot_at_idx
    ON competitor_organic_metric_snapshots (snapshot_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_organic_profiles TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_organic_metric_snapshots TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
"""


def main() -> int:
    if "--dry-run" in sys.argv:
        print(SQL)
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
        cur.execute(SQL)
        conn.commit()
        print("✓ competitor organic enrichment listo.")
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
