"""
Tablas para contenido orgánico de Instagram de competidores.
Fuente: Apify apify/instagram-scraper.

competitor_organic_posts — posts individuales (análisis IA cacheado por post).
competitor_organic_insights — síntesis agregada por competidor (frecuencia,
    pilares, patrones de posting, posts destacados).

Usage:
    python migrations/2026_06_23_competitor_organic_posts.py --dry-run
    python migrations/2026_06_23_competitor_organic_posts.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
CREATE TABLE IF NOT EXISTS competitor_organic_posts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor          text NOT NULL,
    post_id             text NOT NULL,           -- Instagram shortCode
    post_url            text,
    format              text,                    -- image | video | sidecar | reel
    caption             text,
    caption_length      int,
    hashtags            jsonb NOT NULL DEFAULT '[]',   -- string[]
    mentions            jsonb NOT NULL DEFAULT '[]',   -- string[]
    posted_at           timestamptz,
    duration_secs       float,
    likes_count         int,
    comments_count      int,
    video_views         int,
    is_pinned           boolean NOT NULL DEFAULT false,
    is_paid_partnership boolean NOT NULL DEFAULT false,
    display_url         text,
    recent_comments     jsonb NOT NULL DEFAULT '[]',   -- {text, timestamp}[]
    analysis            jsonb,                  -- cache: content_type, objective, has_cta, cta_type
    raw                 jsonb,
    fetched_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (competitor, post_id)
);

CREATE INDEX IF NOT EXISTS corp_competitor_idx  ON competitor_organic_posts (competitor);
CREATE INDEX IF NOT EXISTS corp_posted_at_idx   ON competitor_organic_posts (posted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS corp_format_idx      ON competitor_organic_posts (format);

GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_organic_posts TO service_role, authenticated;

CREATE TABLE IF NOT EXISTS competitor_organic_insights (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor      text NOT NULL UNIQUE,
    payload         jsonb NOT NULL,
    model           text,
    generated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_organic_insights TO service_role, authenticated;

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
        print("✓ competitor_organic_posts + competitor_organic_insights creadas.")
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
