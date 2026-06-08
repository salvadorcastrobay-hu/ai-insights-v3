"""
Agrega alias de competidores: BUC→Buk, Césame→Sesame (Sesame HR).

Mantener en sync con COMPETITOR_ALIASES en lib/data/normalizers.ts.
Recrea _norm_competitor y refresca la MV para que el dashboard los muestre
ya mergeados.

Usage:
    python migrations/2026_06_05_competitor_aliases.py --dry-run
    python migrations/2026_06_05_competitor_aliases.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL_NORM_COMPETITOR = """
CREATE OR REPLACE FUNCTION _norm_competitor(v text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE k text := public._normkey(v);
BEGIN
    RETURN CASE k
        WHEN 'humand' THEN 'Humand'
        WHEN 'human' THEN 'Humand'
        WHEN 'human d' THEN 'Humand'
        WHEN 'book' THEN 'Buk'
        WHEN 'buk hr' THEN 'Buk'
        WHEN 'bukhr' THEN 'Buk'
        WHEN 'buc' THEN 'Buk'
        WHEN 'senior' THEN 'Senior'
        WHEN 'solides' THEN 'Sólides'
        WHEN 'solids' THEN 'Sólides'
        WHEN 'fids' THEN 'Feedz'
        WHEN 'feedz' THEN 'Feedz'
        WHEN 'totus' THEN 'Totvs'
        WHEN 'tots' THEN 'Totvs'
        WHEN 'totvs' THEN 'Totvs'
        WHEN 'sesame' THEN 'Sesame'
        WHEN 'cesame' THEN 'Sesame'
        WHEN 'sesame hr' THEN 'Sesame'
        ELSE v
    END;
END;
$$;
"""

STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '600s';"),
    ("_norm_competitor (+ alias)", SQL_NORM_COMPETITOR),
    # CONCURRENTLY no puede correr en transacción → la corremos aparte (autocommit).
]


def main() -> int:
    if "--dry-run" in sys.argv:
        for label, sql in STEPS:
            print(f"\n── {label} ──\n{sql}")
        print("\n── refresh ──\nREFRESH MATERIALIZED VIEW CONCURRENTLY mv_insights_norm;")
        return 0

    import config  # noqa
    import psycopg2  # noqa

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        for i, (label, sql) in enumerate(STEPS, 1):
            print(f"[{i}/{len(STEPS)}] {label}...")
            cur.execute(sql)
        conn.commit()
        print("✓ _norm_competitor actualizada.")
    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Falló (rollback): {exc}", file=sys.stderr)
        cur.close()
        conn.close()
        return 1
    cur.close()
    conn.close()

    # Refresh CONCURRENTLY en conexión autocommit (fuera de transacción).
    conn2 = psycopg2.connect(**params, connect_timeout=15)
    conn2.autocommit = True
    cur2 = conn2.cursor()
    try:
        print("Refrescando MV (CONCURRENTLY)...")
        cur2.execute("SET statement_timeout = '600s';")
        cur2.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_insights_norm;")
        print("✓ MV refrescada. Buk y Sesame ya quedan mergeados.")
        cur2.execute(
            "SELECT competitor_name, COUNT(*) FROM mv_insights_norm "
            "WHERE competitor_name IN ('Buk','Sesame') GROUP BY 1;"
        )
        for name, n in cur2.fetchall():
            print(f"  {name}: {n} filas")
        return 0
    except Exception as exc:
        print(f"\n✗ Refresh falló: {exc}", file=sys.stderr)
        return 1
    finally:
        cur2.close()
        conn2.close()


if __name__ == "__main__":
    sys.exit(main())
