"""
RPCs bespoke para migrar /regional-gtm a RPC (sin loadInsights).

Las agregaciones genéricas (group_distinct, stack, heatmap) ya existen. Faltan
3 específicas de regional-gtm, que replican la lógica de regional-gtm-data.ts:

  - rpc_pipeline_grid(f)         → seg×región: revenue (sum amount por deal único) + deals
  - rpc_pain_region_pct(f)       → top 3 pains por región como % de las demos de esa región
  - rpc_competitors_by_country(f)→ país×competidor: menciones + relación más frecuente

Todas STABLE (read-only), leen de _filter_insights_norm (MV normalizada).
Additivo: solo CREATE FUNCTION. No toca pages ni data. Idempotente.

Usage:
    python migrations/2026_06_05_regional_gtm_rpcs.py --dry-run
    python migrations/2026_06_05_regional_gtm_rpcs.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


# seg×región: 1 monto por deal único (dedupe por deal_id), luego sum + count.
SQL_PIPELINE_GRID = """
CREATE OR REPLACE FUNCTION rpc_pipeline_grid(f jsonb)
RETURNS TABLE(segment text, region text, revenue numeric, deals bigint)
LANGUAGE sql STABLE
AS $$
    WITH deals AS (
        SELECT DISTINCT ON (deal_id) deal_id, segment, region, amount
        FROM _filter_insights_norm(f)
        WHERE deal_id IS NOT NULL AND region IS NOT NULL
        ORDER BY deal_id
    )
    SELECT segment, region,
           COALESCE(SUM(amount), 0)::numeric AS revenue,
           COUNT(*)::bigint AS deals
    FROM deals
    WHERE segment IS NOT NULL AND region IS NOT NULL
    GROUP BY segment, region;
$$;
"""

# top 3 pains por región como % de las demos (transcripts) de esa región.
SQL_PAIN_REGION_PCT = """
CREATE OR REPLACE FUNCTION rpc_pain_region_pct(f jsonb)
RETURNS TABLE(region text, pain text, demos bigint, pct numeric)
LANGUAGE sql STABLE
AS $$
    WITH pains AS (
        SELECT region, insight_subtype_display AS pain, transcript_id
        FROM _filter_insights_norm(f)
        WHERE insight_type = 'pain'
          AND region IS NOT NULL
          AND transcript_id IS NOT NULL
          AND insight_subtype_display IS NOT NULL
    ),
    region_demos AS (
        SELECT region, COUNT(DISTINCT transcript_id) AS rd FROM pains GROUP BY region
    ),
    pain_demos AS (
        SELECT region, pain, COUNT(DISTINCT transcript_id) AS pd FROM pains GROUP BY region, pain
    ),
    ranked AS (
        SELECT region, pain, pd,
               ROW_NUMBER() OVER (PARTITION BY region ORDER BY pd DESC, pain ASC) AS rn
        FROM pain_demos
    )
    SELECT r.region, r.pain, r.pd::bigint AS demos,
           ROUND(100.0 * r.pd / NULLIF(rd.rd, 0), 1) AS pct
    FROM ranked r
    JOIN region_demos rd USING (region)
    WHERE r.rn <= 3;
$$;
"""

# país×competidor: menciones (filas) + relación display más frecuente.
SQL_COMPETITORS_BY_COUNTRY = """
CREATE OR REPLACE FUNCTION rpc_competitors_by_country(f jsonb)
RETURNS TABLE(country text, competitor text, mentions bigint, top_relationship text)
LANGUAGE sql STABLE
AS $$
    WITH comp AS (
        SELECT country, competitor_name, competitor_relationship_display
        FROM _filter_insights_norm(f)
        WHERE insight_type = 'competitive_signal'
          AND COALESCE(is_own_brand, false) = false
          AND country IS NOT NULL
          AND competitor_name IS NOT NULL
    ),
    counts AS (
        SELECT country, competitor_name, COUNT(*)::bigint AS mentions
        FROM comp GROUP BY country, competitor_name
    ),
    rel AS (
        SELECT country, competitor_name, competitor_relationship_display,
               ROW_NUMBER() OVER (
                 PARTITION BY country, competitor_name
                 ORDER BY COUNT(*) DESC, competitor_relationship_display ASC
               ) AS rn
        FROM comp
        WHERE competitor_relationship_display IS NOT NULL
        GROUP BY country, competitor_name, competitor_relationship_display
    )
    SELECT c.country, c.competitor_name AS competitor, c.mentions,
           COALESCE(r.competitor_relationship_display, '—') AS top_relationship
    FROM counts c
    LEFT JOIN rel r
      ON r.country = c.country AND r.competitor_name = c.competitor_name AND r.rn = 1;
$$;
"""

SQL_GRANTS = """
GRANT EXECUTE ON FUNCTION rpc_pipeline_grid(jsonb) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_pain_region_pct(jsonb) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_competitors_by_country(jsonb) TO service_role, authenticated;
"""

STEPS = [
    ("rpc_pipeline_grid", SQL_PIPELINE_GRID),
    ("rpc_pain_region_pct", SQL_PAIN_REGION_PCT),
    ("rpc_competitors_by_country", SQL_COMPETITORS_BY_COUNTRY),
    ("grants", SQL_GRANTS),
]


def main() -> int:
    if "--dry-run" in sys.argv:
        for label, sql in STEPS:
            print(f"\n── {label} ──\n{sql}")
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
        print("\n✓ RPCs de regional-gtm creadas.")

        f = "'{\"prompt_version\":\"v3.0\"}'::jsonb"
        cur.execute(
            f"SELECT region, pain, demos, pct FROM rpc_pain_region_pct({f}) "
            "WHERE region = 'HISPAM' ORDER BY pct DESC;"
        )
        print("\nSanity — top pains HISPAM (rpc_pain_region_pct):")
        for r in cur.fetchall():
            print(f"  {r[1]}: {r[3]}% ({r[2]} demos)")

        cur.execute(
            f"SELECT segment, region, revenue, deals FROM rpc_pipeline_grid({f}) "
            "ORDER BY revenue DESC LIMIT 5;"
        )
        print("\nSanity — top celdas pipeline (rpc_pipeline_grid):")
        for r in cur.fetchall():
            print(f"  {r[0]} × {r[1]}: ${r[2]:,.0f} · {r[3]} deals")
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
