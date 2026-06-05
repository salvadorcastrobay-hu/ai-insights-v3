"""
Data fix: Prode mal extraído como competidor → neutralizar (Opción A).

20 filas competitive_signal tienen competitor_name = PRODE/PRODES/Prode, que
es un MÓDULO propio de Humand, no un competidor (falso positivo de extracción).

Fix (Opción A, reversible, no borra):
    competitor_name = NULL
    competitor_relationship = NULL
    module = 'prode'
(mantiene insight_type)

Efecto: dejan de contar como competidor (las vistas filtran competitor NULL)
y quedan taggeadas al módulo prode. No se inventa demanda (no se fuerzan a
pain/product_gap).

Usage:
    python migrations/2026_06_05_fix_prode_competitor.py            # dry-run (muestra las filas)
    python migrations/2026_06_05_fix_prode_competitor.py --apply    # ejecuta el UPDATE
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

WHERE = "insight_type = 'competitive_signal' AND competitor_name ILIKE '%prode%'"

SQL_SELECT = f"""
SELECT id, insight_subtype, competitor_name, competitor_relationship, module,
       left(summary, 100) AS summary
FROM transcript_insights
WHERE {WHERE}
ORDER BY id;
"""

SQL_UPDATE = f"""
UPDATE transcript_insights
SET competitor_name = NULL,
    competitor_relationship = NULL,
    module = 'prode'
WHERE {WHERE};
"""


def main() -> int:
    apply = "--apply" in sys.argv

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        cur.execute(SQL_SELECT)
        rows = cur.fetchall()
        print(f"\nFilas afectadas: {len(rows)}")
        for r in rows:
            print(f"  {r[0]} | {r[1]} | comp={r[2]} | rel={r[3]} | mod={r[4]} | {r[5]}")

        if not apply:
            print("\n(DRY-RUN) No se modificó nada. Corré con --apply para ejecutar el UPDATE.")
            return 0

        cur.execute(SQL_UPDATE)
        affected = cur.rowcount
        conn.commit()
        print(f"\n✓ UPDATE aplicado. {affected} filas actualizadas (competitor→NULL, module='prode').")
        print("Recordá refrescar la MV para que el Overview lo refleje:")
        print("  SELECT refresh_insights_mv();   -- o el próximo ingest")
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
