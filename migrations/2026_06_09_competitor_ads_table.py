"""
Tabla competitor_ads: snapshots de avisos de competidores traídos de la
Facebook Ad Library vía ScrapeCreators (https://scrapecreators.com).

El monitoreo es on-demand: el endpoint /api/competitor-ads/refresh (web)
upsertea acá por (competitor, ad_archive_id); la página /competitor-ads
lee de esta tabla (carga instantánea, sin pegar a la API externa en cada
render).

first_seen_at / last_seen_at permiten ver desde cuándo está corriendo un
aviso y detectar nuevos vs recurrentes entre refreshes.

Usage:
    python migrations/2026_06_09_competitor_ads_table.py --dry-run
    python migrations/2026_06_09_competitor_ads_table.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
CREATE TABLE IF NOT EXISTS competitor_ads (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor      text NOT NULL,            -- nombre canónico (taxonomía)
    ad_archive_id   text NOT NULL,            -- id del aviso en Meta
    page_id         text,
    page_name       text,
    is_active       boolean,
    ad_start_date   timestamptz,
    ad_end_date     timestamptz,
    publisher_platform jsonb,                 -- ["FACEBOOK","INSTAGRAM",...]
    display_format  text,                     -- VIDEO | IMAGE | ...
    body_text       text,                     -- copy del aviso
    title           text,
    cta_text        text,
    cta_type        text,
    link_url        text,
    categories      jsonb,
    media           jsonb,                    -- {images:[...], videos:[...]}
    country         text,
    raw             jsonb,                    -- objeto completo por si sumamos campos
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    fetched_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (competitor, ad_archive_id)
);

CREATE INDEX IF NOT EXISTS competitor_ads_competitor_idx ON competitor_ads (competitor);
CREATE INDEX IF NOT EXISTS competitor_ads_active_idx ON competitor_ads (is_active);
CREATE INDEX IF NOT EXISTS competitor_ads_start_idx ON competitor_ads (ad_start_date DESC NULLS LAST);

GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_ads TO service_role, authenticated;
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
        print("✓ tabla competitor_ads creada.")
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
