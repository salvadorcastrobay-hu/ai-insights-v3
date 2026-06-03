"""
Migration: pivot aggregation RPCs (Phase 2 — Step 3b).

RPCs de pivot que espejan buildHeatMap / stackBy / monthlyInsightTrend de
dashboard-aggregations.ts. Operan sobre _filter_insights_norm (region/
competitor ya normalizados). Devuelven jsonb con la misma shape que los
helpers JS para que las pages las consuman directo.

  - rpc_heatmap(f, row_dim, col_dim, scope, exclude_own_brand, n_rows, n_cols)
      → { rowLabels[], colLabels[], values[][] }  (distinct transcripts por celda)
  - rpc_stack(f, y_dim, stack_dim, scope, exclude_own_brand, top_n, top_stack_n)
      → { data[{name, <stack>: rawcount, ...}], stackKeys[] }  (con bucket "Otros")
  - rpc_monthly_trend(f, scope)
      → [{ month, <insight_type_display>: rawcount, ... }]

OJO de fidelidad con TS:
  - heatmap usa distinct transcript_id por celda (igual que buildHeatMap).
  - stack usa COUNT(*) raw rows (igual que stackBy, NO distinct) + bucket "Otros".
  - monthly_trend usa COUNT(*) raw rows por insight_type_display.

NO modifica data ni schema. STABLE. Idempotente. Rollback: DROP FUNCTION.

Usage:
    python migrations/2026_06_03c_pivot_rpcs.py --dry-run
    python migrations/2026_06_03c_pivot_rpcs.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


SQL_HEATMAP = """
CREATE OR REPLACE FUNCTION rpc_heatmap(
    f jsonb, row_dim text, col_dim text, scope text DEFAULT NULL,
    exclude_own_brand boolean DEFAULT false, n_rows int DEFAULT 15, n_cols int DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    rcol text := _assert_dim(row_dim);
    ccol text := _assert_dim(col_dim);
    result jsonb;
BEGIN
    EXECUTE format($q$
        WITH base AS (
            SELECT transcript_id,
                   NULLIF(btrim(%1$I::text), '') AS rv,
                   NULLIF(btrim(%2$I::text), '') AS cv
            FROM _filter_insights_norm($1) t
            WHERE ($2 IS NULL OR t.insight_type = $2)
              AND (NOT $3 OR t.is_own_brand = false)
        ),
        row_order AS (
            SELECT rv,
                   ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT transcript_id) DESC, rv ASC) rn
            FROM base WHERE rv IS NOT NULL GROUP BY rv
        ),
        col_order AS (
            SELECT cv,
                   ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT transcript_id) DESC, cv ASC) cn
            FROM base WHERE cv IS NOT NULL GROUP BY cv
        ),
        rsel AS (SELECT rv, rn FROM row_order WHERE rn <= $4),
        csel AS (SELECT cv, cn FROM col_order WHERE cn <= $5),
        cells AS (
            SELECT b.rv, b.cv, COUNT(DISTINCT b.transcript_id) val
            FROM base b
            JOIN rsel r ON r.rv = b.rv
            JOIN csel c ON c.cv = b.cv
            GROUP BY b.rv, b.cv
        )
        SELECT jsonb_build_object(
            'rowLabels', (SELECT COALESCE(jsonb_agg(rv ORDER BY rn), '[]'::jsonb) FROM rsel),
            'colLabels', (SELECT COALESCE(jsonb_agg(cv ORDER BY cn), '[]'::jsonb) FROM csel),
            'values', (
                SELECT COALESCE(jsonb_agg(row_arr ORDER BY rn), '[]'::jsonb)
                FROM (
                    SELECT r.rn,
                        (SELECT COALESCE(jsonb_agg(COALESCE(cell.val, 0) ORDER BY c.cn), '[]'::jsonb)
                         FROM csel c
                         LEFT JOIN cells cell ON cell.rv = r.rv AND cell.cv = c.cv
                        ) AS row_arr
                    FROM rsel r
                ) z
            )
        )
    $q$, rcol, ccol) INTO result USING f, scope, exclude_own_brand, n_rows, n_cols;
    RETURN result;
END;
$$;
"""


SQL_STACK = """
CREATE OR REPLACE FUNCTION rpc_stack(
    f jsonb, y_dim text, stack_dim text, scope text DEFAULT NULL,
    exclude_own_brand boolean DEFAULT false, top_n int DEFAULT 10, top_stack_n int DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    ycol text := _assert_dim(y_dim);
    scol text := _assert_dim(stack_dim);
    result jsonb;
BEGIN
    EXECUTE format($q$
        WITH base AS (
            SELECT transcript_id,
                   NULLIF(btrim(%1$I::text), '') AS yv,
                   NULLIF(btrim(%2$I::text), '') AS sv
            FROM _filter_insights_norm($1) t
            WHERE ($2 IS NULL OR t.insight_type = $2)
              AND (NOT $3 OR t.is_own_brand = false)
        ),
        y_order AS (
            SELECT yv, ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT transcript_id) DESC, yv ASC) rn
            FROM base WHERE yv IS NOT NULL GROUP BY yv
        ),
        ysel AS (SELECT yv, rn FROM y_order WHERE rn <= $4),
        stack_rows AS (
            SELECT b.yv, b.sv
            FROM base b JOIN ysel y ON y.yv = b.yv
            WHERE b.sv IS NOT NULL
        ),
        stack_totals AS (
            SELECT sv, ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, sv ASC) sn
            FROM stack_rows GROUP BY sv
        ),
        top_stacks AS (SELECT sv, sn FROM stack_totals WHERE sn <= $5),
        has_other AS (
            SELECT (SELECT COUNT(*) FROM stack_totals) > (SELECT COUNT(*) FROM top_stacks) AS ho
        ),
        bucketed AS (
            SELECT sr.yv, COALESCE(ts.sv, 'Otros') AS bucket
            FROM stack_rows sr
            LEFT JOIN top_stacks ts ON ts.sv = sr.sv
        ),
        cell AS (
            SELECT yv, bucket, COUNT(*) c FROM bucketed GROUP BY yv, bucket
        )
        SELECT jsonb_build_object(
            'data', (
                SELECT COALESCE(jsonb_agg(obj ORDER BY rn), '[]'::jsonb)
                FROM (
                    SELECT y.rn,
                        (jsonb_build_object('name', y.yv)
                         || COALESCE((SELECT jsonb_object_agg(bucket, c) FROM cell WHERE cell.yv = y.yv), '{}'::jsonb)
                        ) AS obj
                    FROM ysel y
                ) z
            ),
            'stackKeys', (
                (SELECT COALESCE(jsonb_agg(sv ORDER BY sn), '[]'::jsonb) FROM top_stacks)
                || CASE WHEN (SELECT ho FROM has_other) THEN '["Otros"]'::jsonb ELSE '[]'::jsonb END
            )
        )
    $q$, ycol, scol) INTO result USING f, scope, exclude_own_brand, top_n, top_stack_n;
    RETURN result;
END;
$$;
"""


SQL_MONTHLY_TREND = """
CREATE OR REPLACE FUNCTION rpc_monthly_trend(f jsonb, scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    WITH base AS (
        SELECT to_char(call_date, 'YYYY-MM') AS month, insight_type_display AS t
        FROM _filter_insights_norm(f)
        WHERE call_date IS NOT NULL
          AND (scope IS NULL OR insight_type = scope)
          AND insight_type_display IS NOT NULL
    ),
    per AS (SELECT month, t, COUNT(*) c FROM base GROUP BY month, t)
    SELECT COALESCE(jsonb_agg(obj ORDER BY month), '[]'::jsonb)
    FROM (
        SELECT month, jsonb_build_object('month', month) || jsonb_object_agg(t, c) AS obj
        FROM per GROUP BY month
    ) z;
$$;
"""


SQL_GRANTS = """
GRANT EXECUTE ON FUNCTION rpc_heatmap(jsonb, text, text, text, boolean, int, int) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_stack(jsonb, text, text, text, boolean, int, int) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_monthly_trend(jsonb, text) TO service_role, authenticated;
"""


STEPS = [
    ("rpc_heatmap", SQL_HEATMAP),
    ("rpc_stack", SQL_STACK),
    ("rpc_monthly_trend", SQL_MONTHLY_TREND),
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
        print("\n✓ Pivot RPCs created/updated.")

        f = '{"prompt_version":"v3.0"}'
        # Heatmap: pain subtype × region (mismo que el de regional-gtm)
        cur.execute(
            f"SELECT rpc_heatmap('{f}'::jsonb, 'insight_subtype_display', 'region', 'pain', false, 5, 6);"
        )
        hm = cur.fetchone()[0]
        print("\nSanity — rpc_heatmap(pain subtype × region, 5×6):")
        print(f"  rowLabels: {hm.get('rowLabels')}")
        print(f"  colLabels: {hm.get('colLabels')}")
        print(f"  values:    {hm.get('values')}")

        # Stack: competitor × relationship (excl own-brand)
        cur.execute(
            f"SELECT rpc_stack('{f}'::jsonb, 'competitor_name', 'competitor_relationship_display', 'competitive_signal', true, 5, 4);"
        )
        st = cur.fetchone()[0]
        print("\nSanity — rpc_stack(competitor × relationship, top5×4):")
        print(f"  stackKeys: {st.get('stackKeys')}")
        print(f"  data[0]:   {st.get('data')[0] if st.get('data') else None}")
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
