"""
Multi-fuente + análisis IA para el monitoreo de ads de competidores:

  - competitor_ads.source: distingue 'meta_ads' | 'linkedin_ads' | 'google_ads'.
    Default 'meta_ads' para las filas existentes. La unique key pasa a
    (source, competitor, ad_archive_id) para no colisionar entre fuentes.
  - competitor_ads.collation_id: id de campaña de Meta (agrupa variantes del
    mismo aviso) — para dedupe en análisis/display.
  - competitor_ad_insights: salida del análisis IA por (competitor, source):
    ángulos de mensaje, dolores mapeados a nuestra taxonomía, tipos de oferta.

Usage:
    python migrations/2026_06_10_competitor_ads_multisource_ai.py --dry-run
    python migrations/2026_06_10_competitor_ads_multisource_ai.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
ALTER TABLE competitor_ads ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'meta_ads';
ALTER TABLE competitor_ads ADD COLUMN IF NOT EXISTS collation_id text;

-- Repointar la unique key para incluir source (Meta/LinkedIn/Google pueden
-- compartir ad ids en teoría; además deja crecer por fuente).
ALTER TABLE competitor_ads DROP CONSTRAINT IF EXISTS competitor_ads_competitor_ad_archive_id_key;
DROP INDEX IF EXISTS competitor_ads_src_comp_ad_uidx;
CREATE UNIQUE INDEX competitor_ads_src_comp_ad_uidx
    ON competitor_ads (source, competitor, ad_archive_id);

CREATE INDEX IF NOT EXISTS competitor_ads_source_idx ON competitor_ads (source);
CREATE INDEX IF NOT EXISTS competitor_ads_collation_idx ON competitor_ads (collation_id);

CREATE TABLE IF NOT EXISTS competitor_ad_insights (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor    text NOT NULL,
    source        text NOT NULL DEFAULT 'meta_ads',
    payload       jsonb NOT NULL,        -- { angles:[...], offer_types:[...], summary, ads_analyzed }
    model         text,
    generated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (competitor, source)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_ad_insights TO service_role, authenticated;
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
        print("✓ multi-source + competitor_ad_insights listos.")
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
