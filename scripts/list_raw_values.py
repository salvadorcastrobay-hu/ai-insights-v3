"""
Read-only. Lista los valores crudos de `country` e `industry` en la MV
(mv_insights_norm), con cuántos insights tiene cada uno, para armar los
mapeos de consolidación (Brasil/Brazil, industrias, etc.).

No modifica nada. Solo SELECT.

Usage:
    source .venv/bin/activate
    python scripts/list_raw_values.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def main() -> int:
    import config  # noqa
    import psycopg2  # noqa

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...\n")
    conn = psycopg2.connect(**params, connect_timeout=15)
    cur = conn.cursor()
    try:
        cur.execute("SET statement_timeout = '60s';")

        for label, col in [("PAÍSES (country)", "country"), ("INDUSTRIAS (industry)", "industry")]:
            print(f"===== {label} =====")
            cur.execute(
                f"""
                SELECT COALESCE(NULLIF(TRIM({col}), ''), '(vacío)') AS val,
                       COUNT(*) AS insights,
                       COUNT(DISTINCT deal_id) AS deals
                FROM mv_insights_norm
                WHERE prompt_version = 'v3.0'
                GROUP BY 1
                ORDER BY insights DESC;
                """
            )
            rows = cur.fetchall()
            width = max((len(r[0]) for r in rows), default=10)
            print(f"  {'valor'.ljust(width)}  {'insights':>9}  {'deals':>7}")
            for val, insights, deals in rows:
                print(f"  {val.ljust(width)}  {insights:>9}  {deals:>7}")
            print(f"  → {len(rows)} valores distintos\n")
        return 0
    except Exception as exc:
        print(f"\n✗ Falló: {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
