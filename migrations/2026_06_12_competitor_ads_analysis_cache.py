"""
Cache de análisis por aviso para competitor_ads.

  - competitor_ads.analysis (jsonb): resultado del análisis por aviso —
    { creative_text, goal, content_type, related_pains }. Se computa UNA vez
    por aviso (transcripción/OCR del creativo + clasificación) y se reusa en
    los refresh siguientes. Así un refresh repetido no re-gasta tokens: solo
    procesa los avisos nuevos.

Usage:
    python migrations/2026_06_12_competitor_ads_analysis_cache.py --dry-run
    python migrations/2026_06_12_competitor_ads_analysis_cache.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
ALTER TABLE competitor_ads ADD COLUMN IF NOT EXISTS analysis jsonb;
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
        print("✓ competitor_ads.analysis listo.")
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
