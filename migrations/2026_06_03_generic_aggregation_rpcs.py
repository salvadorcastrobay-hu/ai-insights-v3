"""
Migration: generic server-side aggregation RPCs (Phase 2 — Step 3).

Agrega RPCs genéricas que espejan los helpers de dashboard-aggregations.ts,
para que las pages pidan agregaciones ya computadas en Postgres en vez de
cargar ~150K rows a Node (causa del OOM en Railway).

Esta tanda incluye las funciones de ALTA CONFIANZA (SQL simple, fácil de
validar):
  - rpc_sample_stats   → DataQualityFooter (todas las pages)
  - rpc_group_distinct → top N por distinct transcript (la mayoría de bar charts)
  - rpc_group_with_pct → idem + % sobre un total
  - rpc_revenue_by     → suma de amount por deal único, agrupado por dim

heatmap/stack/trend van en una migración aparte (lógica de pivot — se
validan número por número antes de wirearlas).

NO modifica data ni schema:
  - Solo CREATE OR REPLACE FUNCTION (idempotente, re-ejecutable).
  - Todas STABLE → read-only.
  - Dims validadas contra whitelist (_assert_dim) → no SQL injection.

Rollback: DROP FUNCTION <nombre>;

Usage:
    python migrations/2026_06_03_generic_aggregation_rpcs.py            # apply
    python migrations/2026_06_03_generic_aggregation_rpcs.py --dry-run  # print SQL
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


# ============================================================================
# Whitelist de dimensiones: previene SQL injection en las RPCs que toman un
# nombre de columna como parámetro (EXECUTE format). Solo columnas reales de
# v_insights_dashboard que el dashboard agrupa.
# ============================================================================

SQL_ASSERT_DIM = """
CREATE OR REPLACE FUNCTION _assert_dim(dim text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
    IF dim NOT IN (
        'insight_type_display','insight_subtype_display','region','country',
        'segment','industry','deal_owner','module_display','hr_category_display',
        'acquisition_channel','deal_source','pain_theme','feature_display',
        'competitor_name','competitor_relationship_display','deal_stage','module_status'
    ) THEN
        RAISE EXCEPTION 'Invalid dimension: %', dim;
    END IF;
    RETURN dim;
END;
$$;
"""


# ============================================================================
# rpc_sample_stats — métricas del DataQualityFooter (todas las pages).
# Espeja computeSampleStats() en lib/data/sample-stats.ts.
# ============================================================================

SQL_SAMPLE_STATS = """
CREATE OR REPLACE FUNCTION rpc_sample_stats(f jsonb)
RETURNS TABLE(
    unique_calls bigint,
    unique_deals bigint,
    insights_count bigint,
    period_start date,
    period_end date,
    avg_confidence numeric,
    high_confidence_pct numeric
)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (SELECT * FROM _filter_insights(f))
    SELECT
        COUNT(DISTINCT transcript_id)::bigint AS unique_calls,
        COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL)::bigint AS unique_deals,
        COUNT(*)::bigint AS insights_count,
        MIN(call_date) AS period_start,
        MAX(call_date) AS period_end,
        ROUND(AVG(confidence) FILTER (WHERE confidence IS NOT NULL)::numeric, 4) AS avg_confidence,
        CASE
            WHEN COUNT(*) FILTER (WHERE confidence IS NOT NULL) = 0 THEN NULL
            ELSE ROUND(
                100.0 * COUNT(*) FILTER (WHERE confidence >= 0.7)
                / NULLIF(COUNT(*) FILTER (WHERE confidence IS NOT NULL), 0), 1)
        END AS high_confidence_pct
    FROM filtered;
$$;
"""


# ============================================================================
# rpc_group_distinct — top N labels por # de transcripts distintos.
# Espeja groupDistinctTranscripts(). scope = insight_type opcional;
# exclude_own_brand para competitive_signal.
# ============================================================================

SQL_GROUP_DISTINCT = """
CREATE OR REPLACE FUNCTION rpc_group_distinct(
    f jsonb,
    dim text,
    scope text DEFAULT NULL,
    exclude_own_brand boolean DEFAULT false,
    n integer DEFAULT 15
)
RETURNS TABLE(name text, value bigint)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    col text := _assert_dim(dim);
BEGIN
    RETURN QUERY EXECUTE format($q$
        SELECT v AS name, COUNT(DISTINCT transcript_id)::bigint AS value
        FROM (
            SELECT transcript_id, NULLIF(btrim(%1$I::text), '') AS v
            FROM _filter_insights($1) t
            WHERE ($2 IS NULL OR t.insight_type = $2)
              AND (NOT $3 OR COALESCE(lower(btrim(t.competitor_name)), '') NOT IN ('humand','human','human d'))
        ) s
        WHERE v IS NOT NULL
        GROUP BY v
        ORDER BY value DESC, name ASC
        LIMIT $4
    $q$, col)
    USING f, scope, exclude_own_brand, n;
END;
$$;
"""


# ============================================================================
# rpc_group_with_pct — igual a group_distinct pero agrega pct sobre un total
# pasado por el caller (totalTranscripts o distinct deals). Espeja
# groupWithPct()/painsWithPct().
# ============================================================================

SQL_GROUP_WITH_PCT = """
CREATE OR REPLACE FUNCTION rpc_group_with_pct(
    f jsonb,
    dim text,
    total numeric,
    scope text DEFAULT NULL,
    exclude_own_brand boolean DEFAULT false,
    n integer DEFAULT 15
)
RETURNS TABLE(name text, value bigint, pct numeric)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    col text := _assert_dim(dim);
BEGIN
    RETURN QUERY EXECUTE format($q$
        SELECT v AS name,
               COUNT(DISTINCT transcript_id)::bigint AS value,
               CASE WHEN $5 > 0
                    THEN ROUND(100.0 * COUNT(DISTINCT transcript_id) / $5, 1)
                    ELSE 0 END AS pct
        FROM (
            SELECT transcript_id, NULLIF(btrim(%1$I::text), '') AS v
            FROM _filter_insights($1) t
            WHERE ($2 IS NULL OR t.insight_type = $2)
              AND (NOT $3 OR COALESCE(lower(btrim(t.competitor_name)), '') NOT IN ('humand','human','human d'))
        ) s
        WHERE v IS NOT NULL
        GROUP BY v
        ORDER BY value DESC, name ASC
        LIMIT $4
    $q$, col)
    USING f, scope, exclude_own_brand, n, total;
END;
$$;
"""


# ============================================================================
# rpc_revenue_by — suma de amount por deal único, agrupado por dim. Espeja
# revenueByFeature/revenueByFriction (dedupe deal::dim, suma amount).
# ============================================================================

SQL_REVENUE_BY = """
CREATE OR REPLACE FUNCTION rpc_revenue_by(
    f jsonb,
    dim text,
    scope text DEFAULT NULL,
    exclude_own_brand boolean DEFAULT false,
    n integer DEFAULT 15
)
RETURNS TABLE(name text, value numeric)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    col text := _assert_dim(dim);
BEGIN
    RETURN QUERY EXECUTE format($q$
        WITH per_deal AS (
            -- una fila por (dim, deal) con su amount (evita doble-conteo de
            -- un mismo deal que tiene N insights del mismo dim).
            SELECT DISTINCT ON (v, deal_id) v, deal_id, amount
            FROM (
                SELECT NULLIF(btrim(%1$I::text), '') AS v, deal_id, amount
                FROM _filter_insights($1) t
                WHERE ($2 IS NULL OR t.insight_type = $2)
                  AND (NOT $3 OR COALESCE(lower(btrim(t.competitor_name)), '') NOT IN ('humand','human','human d'))
            ) s
            WHERE v IS NOT NULL AND deal_id IS NOT NULL AND amount IS NOT NULL
            ORDER BY v, deal_id, amount DESC
        )
        SELECT v AS name, COALESCE(SUM(amount), 0)::numeric AS value
        FROM per_deal
        GROUP BY v
        ORDER BY value DESC, name ASC
        LIMIT $4
    $q$, col)
    USING f, scope, exclude_own_brand, n;
END;
$$;
"""


SQL_GRANTS = """
GRANT EXECUTE ON FUNCTION _assert_dim(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_sample_stats(jsonb) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_group_distinct(jsonb, text, text, boolean, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_group_with_pct(jsonb, text, numeric, text, boolean, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_revenue_by(jsonb, text, text, boolean, integer) TO service_role, authenticated;
"""


STEPS = [
    ("_assert_dim whitelist", SQL_ASSERT_DIM),
    ("rpc_sample_stats", SQL_SAMPLE_STATS),
    ("rpc_group_distinct", SQL_GROUP_DISTINCT),
    ("rpc_group_with_pct", SQL_GROUP_WITH_PCT),
    ("rpc_revenue_by", SQL_REVENUE_BY),
    ("grants", SQL_GRANTS),
]


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    if dry_run:
        print("=" * 60)
        print("DRY RUN — printing SQL, NOT executing")
        print("=" * 60)
        for label, sql in STEPS:
            print(f"\n── {label} ──")
            print(sql)
        return 0

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        for i, (label, sql) in enumerate(STEPS, 1):
            print(f"[{i}/{len(STEPS)}] Applying: {label}...")
            cur.execute(sql)
        conn.commit()
        print("\n✓ All generic RPCs created/updated.")

        # Sanity checks
        f = '{"prompt_version":"v3.0"}'
        cur.execute(f"SELECT * FROM rpc_sample_stats('{f}'::jsonb);")
        row = cur.fetchone()
        cols = [d[0] for d in cur.description]
        print("\nSanity — rpc_sample_stats():")
        for k, v in zip(cols, row):
            print(f"  {k}: {v}")

        # Usamos 'segment' (no se normaliza en TS → matchea el dashboard 1:1).
        # OJO: 'region' y 'competitor_name' SÍ se normalizan en TS, así que
        # agruparlos crudo NO matchea — eso se resuelve en F2.1c (columnas
        # normalizadas en la vista).
        cur.execute(
            f"SELECT name, value FROM rpc_group_distinct('{f}'::jsonb, 'segment', NULL, false, 8);"
        )
        print("\nSanity — rpc_group_distinct(segment, top 8):")
        for name, value in cur.fetchall():
            print(f"  {name}: {value}")
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
