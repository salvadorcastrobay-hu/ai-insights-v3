"""
Migration: server-side aggregation RPC functions (Phase 2 — Step 1 + POC).

Crea funciones SQL STABLE (read-only) en Supabase para que las pages del
dashboard pidan agregaciones ya computadas en Postgres en vez de cargar
30K+ rows a Node y agregar en JS.

Esto NO modifica data ni schema:
  - Solo CREATE OR REPLACE FUNCTION (idempotente, re-ejecutable).
  - Las funciones son STABLE → garantía de read-only.
  - Sin INSERT/UPDATE/DELETE/ALTER en ninguna tabla existente.

Rollback: DROP FUNCTION <nombre>;

Usage:
    python migrations/2026_06_01_rpc_functions.py              # apply
    python migrations/2026_06_01_rpc_functions.py --dry-run    # print SQL only
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


# ============================================================================
# Helper interno: aplica filtros del dashboard a una query.
# ============================================================================
#
# Los filtros vienen desde el frontend como JSONB con esta shape:
#   {
#     "types": ["pain", "competitive_signal"],
#     "regions": ["HISPAM", "Brazil"],
#     "segments": ["Enterprise (>1000 employees)"],
#     "countries": [...], "industries": [...], "owners": [...],
#     "modules": [...], "categories": [...], "channels": [...],
#     "sources": [...], "date_start": "2026-01-01", "date_end": "2026-05-31",
#     "prompt_version": "v3.0"
#   }
#
# Cualquier campo vacío/null no se aplica (no filtra). Esto matchea
# exactamente la lógica de applyFilters() en TypeScript.
# ============================================================================

SQL_HELPER = """
CREATE OR REPLACE FUNCTION _filter_insights(f jsonb)
RETURNS SETOF v_insights_dashboard
LANGUAGE sql STABLE
AS $$
    SELECT *
    FROM v_insights_dashboard
    WHERE prompt_version = COALESCE(f->>'prompt_version', 'v3.0')
      AND (
        jsonb_array_length(COALESCE(f->'types', '[]'::jsonb)) = 0
        OR insight_type_display = ANY(SELECT jsonb_array_elements_text(f->'types'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'regions', '[]'::jsonb)) = 0
        OR region = ANY(SELECT jsonb_array_elements_text(f->'regions'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'segments', '[]'::jsonb)) = 0
        OR segment = ANY(SELECT jsonb_array_elements_text(f->'segments'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'countries', '[]'::jsonb)) = 0
        OR country = ANY(SELECT jsonb_array_elements_text(f->'countries'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'industries', '[]'::jsonb)) = 0
        OR industry = ANY(SELECT jsonb_array_elements_text(f->'industries'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'owners', '[]'::jsonb)) = 0
        OR deal_owner = ANY(SELECT jsonb_array_elements_text(f->'owners'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'modules', '[]'::jsonb)) = 0
        OR module_display = ANY(SELECT jsonb_array_elements_text(f->'modules'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'categories', '[]'::jsonb)) = 0
        OR hr_category_display = ANY(SELECT jsonb_array_elements_text(f->'categories'))
      )
      AND (
        f->>'date_start' IS NULL OR call_date IS NULL
        OR call_date >= (f->>'date_start')::date
      )
      AND (
        f->>'date_end' IS NULL OR call_date IS NULL
        OR call_date <= (f->>'date_end')::date
      );
$$;
"""


# ============================================================================
# RPC #1 — get_kpis: KPIs top de Executive Summary.
# ============================================================================

SQL_GET_KPIS = """
CREATE OR REPLACE FUNCTION get_kpis(f jsonb)
RETURNS TABLE(
    total_insights bigint,
    total_calls bigint,
    deals_matched bigint,
    revenue_usd numeric,
    insights_per_call numeric
)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (
        SELECT * FROM _filter_insights(f)
    ),
    deals_with_amount AS (
        -- Para revenue: 1 monto por deal único (evita doble-conteo cuando
        -- un deal tiene N insights). Usa la primera ocurrencia no-null.
        SELECT DISTINCT ON (deal_id) deal_id, amount
        FROM filtered
        WHERE deal_id IS NOT NULL
        ORDER BY deal_id, amount DESC NULLS LAST
    )
    SELECT
        COUNT(*)::bigint AS total_insights,
        COUNT(DISTINCT transcript_id)::bigint AS total_calls,
        COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL)::bigint AS deals_matched,
        COALESCE((SELECT SUM(amount) FROM deals_with_amount WHERE amount IS NOT NULL), 0)::numeric AS revenue_usd,
        CASE
            WHEN COUNT(DISTINCT transcript_id) = 0 THEN 0
            ELSE ROUND(COUNT(*)::numeric / COUNT(DISTINCT transcript_id), 2)
        END AS insights_per_call
    FROM filtered;
$$;
"""


# ============================================================================
# Permisos: dar acceso de ejecución a service_role y authenticated.
# ============================================================================

SQL_GRANTS = """
GRANT EXECUTE ON FUNCTION _filter_insights(jsonb) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION get_kpis(jsonb) TO service_role, authenticated;
"""


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    all_sql = [SQL_HELPER, SQL_GET_KPIS, SQL_GRANTS]

    if dry_run:
        print("=" * 60)
        print("DRY RUN — printing SQL, NOT executing")
        print("=" * 60)
        for sql in all_sql:
            print(sql)
            print("\n" + "─" * 60 + "\n")
        return 0

    # Imports diferidos para que --dry-run no requiera psycopg2/config.
    import config  # noqa: E402
    import psycopg2  # noqa: E402

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        for i, sql in enumerate(all_sql, 1):
            label = ["_filter_insights helper", "get_kpis", "grants"][i - 1]
            print(f"[{i}/{len(all_sql)}] Applying: {label}...")
            cur.execute(sql)
        conn.commit()
        print("\n✓ All RPCs created/updated.")

        # Sanity check
        cur.execute("SELECT * FROM get_kpis('{\"prompt_version\":\"v3.0\"}'::jsonb);")
        row = cur.fetchone()
        cols = [d[0] for d in cur.description]
        print("\nSanity check — get_kpis() returns:")
        for k, v in zip(cols, row):
            print(f"  {k}: {v}")
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Migration failed (rolled back): {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
