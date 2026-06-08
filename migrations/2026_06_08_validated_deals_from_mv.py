"""
Reescribe rpc_validated_deals para leer is_validated de la MV (indexado) en
vez de joinear raw_deals + _deal_prop (plpgsql) por fila.

Causa del incidente: la versión con join a raw_deals (86K) era carísima y, con
~15 RPCs en paralelo en el Overview (validado default ON), saturaba la DB →
timeouts en cascada en TODAS las RPCs.

Usage:
    python migrations/2026_06_08_validated_deals_from_mv.py --dry-run
    python migrations/2026_06_08_validated_deals_from_mv.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
CREATE OR REPLACE FUNCTION rpc_validated_deals(f jsonb)
RETURNS bigint
LANGUAGE sql STABLE
AS $$
    SELECT COUNT(DISTINCT deal_id)::bigint
    FROM _filter_insights_norm(f)
    WHERE deal_id IS NOT NULL AND is_validated = true;
$$;
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
        cur.execute("SET statement_timeout = '120s';")
        cur.execute(SQL)
        conn.commit()
        print("✓ rpc_validated_deals ahora lee de la MV (rápido).")
        import time
        t0 = time.time()
        cur.execute("SELECT rpc_validated_deals('{\"prompt_version\":\"v3.0\"}'::jsonb);")
        v = cur.fetchone()[0]
        print(f"  {v} deals validados en {(time.time()-t0)*1000:.0f}ms")
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Falló: {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
