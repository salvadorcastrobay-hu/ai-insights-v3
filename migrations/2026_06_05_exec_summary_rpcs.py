"""
RPCs bespoke para migrar /executive-summary a RPC.

Replican las piezas no-genéricas de executive-summary-data.ts:
  - rpc_kpis_norm(f)            → totalCalls, dealsMatched, revenue, insightsPerCall (norm)
  - rpc_module_demand(f)        → distinct transcripts por módulo (pain+product_gap)
  - rpc_top_breakdowns(...)     → genérico: top-N primario × breakdown secundario
  - rpc_pain_theme_siblings(f)  → top 2 pains → tema dominante → subtipos hermanos
  - rpc_faq_module_breakdown(f) → co-ocurrencia: por top topic FAQ, módulos del transcript
  - rpc_faq_module_heat(f)      → heatmap co-ocurrencia módulo × topic FAQ

Additivo (solo CREATE FUNCTION), STABLE, lee de _filter_insights_norm.

Usage:
    python migrations/2026_06_05_exec_summary_rpcs.py --dry-run
    python migrations/2026_06_05_exec_summary_rpcs.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


SQL_KPIS_NORM = """
CREATE OR REPLACE FUNCTION rpc_kpis_norm(f jsonb)
RETURNS TABLE(total_calls bigint, deals_matched bigint, revenue numeric, insights_per_call numeric)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (SELECT * FROM _filter_insights_norm(f)),
    deals AS (
        SELECT DISTINCT ON (deal_id) deal_id, amount FROM filtered
        WHERE deal_id IS NOT NULL ORDER BY deal_id, amount DESC NULLS LAST
    )
    SELECT
        COUNT(DISTINCT transcript_id)::bigint,
        COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL)::bigint,
        COALESCE((SELECT SUM(amount) FROM deals WHERE amount IS NOT NULL), 0)::numeric,
        CASE WHEN COUNT(DISTINCT transcript_id) = 0 THEN 0
             ELSE ROUND(COUNT(*)::numeric / COUNT(DISTINCT transcript_id), 2) END
    FROM filtered;
$$;
"""

# módulos demandados: distinct transcripts por module_display sobre pain+product_gap
SQL_MODULE_DEMAND = """
CREATE OR REPLACE FUNCTION rpc_module_demand(f jsonb, n integer DEFAULT 12)
RETURNS TABLE(name text, value bigint)
LANGUAGE sql STABLE
AS $$
    SELECT module_display AS name, COUNT(DISTINCT transcript_id)::bigint AS value
    FROM _filter_insights_norm(f)
    WHERE insight_type IN ('pain','product_gap')
      AND NULLIF(btrim(module_display), '') IS NOT NULL
    GROUP BY module_display
    ORDER BY value DESC, name ASC
    LIMIT n;
$$;
"""

# genérico: top-N valores de primary_dim, y para cada uno top-M de breakdown_dim
# (ambos por distinct transcript). Devuelve jsonb [{name, data:[{name,value}]}].
SQL_TOP_BREAKDOWNS = """
CREATE OR REPLACE FUNCTION rpc_top_breakdowns(
    f jsonb, primary_dim text, breakdown_dim text, scope text DEFAULT NULL,
    top_primary integer DEFAULT 2, top_breakdown integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    pcol text := _assert_dim(primary_dim);
    bcol text := _assert_dim(breakdown_dim);
    result jsonb;
BEGIN
    EXECUTE format($q$
        WITH base AS (
            SELECT transcript_id,
                   NULLIF(btrim(%1$I::text), '') AS pv,
                   NULLIF(btrim(%2$I::text), '') AS bv
            FROM _filter_insights_norm($1) t
            WHERE ($2 IS NULL OR t.insight_type = $2)
        ),
        prim AS (
            SELECT pv, ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT transcript_id) DESC, pv ASC) rn
            FROM base WHERE pv IS NOT NULL GROUP BY pv
        ),
        psel AS (SELECT pv, rn FROM prim WHERE rn <= $3),
        bd AS (
            SELECT b.pv, b.bv, COUNT(DISTINCT b.transcript_id) v,
                   ROW_NUMBER() OVER (PARTITION BY b.pv ORDER BY COUNT(DISTINCT b.transcript_id) DESC, b.bv ASC) brn
            FROM base b JOIN psel p ON p.pv = b.pv
            WHERE b.bv IS NOT NULL
            GROUP BY b.pv, b.bv
        )
        SELECT COALESCE(jsonb_agg(obj ORDER BY rn), '[]'::jsonb)
        FROM (
            SELECT p.rn, jsonb_build_object(
                'name', p.pv,
                'data', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object('name', bd.bv, 'value', bd.v) ORDER BY bd.brn)
                    FROM bd WHERE bd.pv = p.pv AND bd.brn <= $4
                ), '[]'::jsonb)
            ) AS obj
            FROM psel p
        ) z
    $q$, pcol, bcol) INTO result USING f, scope, top_primary, top_breakdown;
    RETURN result;
END;
$$;
"""

# pain theme siblings: para los top-N pains, el tema dominante de cada uno y
# los subtipos hermanos en ese tema (excluyendo el pain mismo).
SQL_PAIN_THEME_SIBLINGS = """
CREATE OR REPLACE FUNCTION rpc_pain_theme_siblings(f jsonb, top_n integer DEFAULT 2)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    WITH pains AS (
        SELECT transcript_id, insight_subtype_display AS pain, pain_theme AS theme
        FROM _filter_insights_norm(f)
        WHERE insight_type = 'pain'
          AND NULLIF(btrim(insight_subtype_display), '') IS NOT NULL
    ),
    top_pains AS (
        SELECT pain, ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT transcript_id) DESC, pain ASC) rn
        FROM pains GROUP BY pain
    ),
    sel AS (SELECT pain, rn FROM top_pains WHERE rn <= top_n),
    dom_theme AS (  -- tema más común de cada top pain
        SELECT s.pain, s.rn, p.theme,
               ROW_NUMBER() OVER (PARTITION BY s.pain ORDER BY COUNT(*) DESC, p.theme ASC) trn
        FROM sel s JOIN pains p ON p.pain = s.pain
        WHERE p.theme IS NOT NULL
        GROUP BY s.pain, s.rn, p.theme
    ),
    chosen AS (SELECT pain, rn, theme FROM dom_theme WHERE trn = 1),
    siblings AS (  -- subtipos hermanos en ese tema, != el pain
        SELECT c.pain, c.rn, p.pain AS sibling, COUNT(DISTINCT p.transcript_id) v,
               ROW_NUMBER() OVER (PARTITION BY c.pain ORDER BY COUNT(DISTINCT p.transcript_id) DESC, p.pain ASC) srn
        FROM chosen c JOIN pains p ON p.theme = c.theme AND p.pain <> c.pain
        GROUP BY c.pain, c.rn, p.pain
    )
    SELECT COALESCE(jsonb_agg(obj ORDER BY rn), '[]'::jsonb)
    FROM (
        SELECT c.rn, jsonb_build_object(
            'name', c.pain || ' · tema: ' || c.theme,
            'data', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', s.sibling, 'value', s.v) ORDER BY s.srn)
                FROM siblings s WHERE s.pain = c.pain AND s.srn <= 6
            ), '[]'::jsonb)
        ) AS obj
        FROM chosen c
    ) z;
$$;
"""

# co-ocurrencia FAQ topic → módulos (en los transcripts que mencionan el topic)
SQL_FAQ_MODULE_BREAKDOWN = """
CREATE OR REPLACE FUNCTION rpc_faq_module_breakdown(f jsonb, top_topics integer DEFAULT 2)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    WITH faq AS (
        SELECT DISTINCT transcript_id, insight_subtype_display AS topic
        FROM _filter_insights_norm(f)
        WHERE insight_type = 'faq' AND NULLIF(btrim(insight_subtype_display), '') IS NOT NULL
    ),
    tmods AS (
        SELECT DISTINCT transcript_id, module_display
        FROM _filter_insights_norm(f)
        WHERE NULLIF(btrim(module_display), '') IS NOT NULL
    ),
    topic_rank AS (
        SELECT topic, ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT transcript_id) DESC, topic ASC) rn
        FROM faq GROUP BY topic
    ),
    sel AS (SELECT topic, rn FROM topic_rank WHERE rn <= top_topics),
    co AS (
        SELECT s.topic, s.rn, m.module_display, COUNT(DISTINCT m.transcript_id) v,
               ROW_NUMBER() OVER (PARTITION BY s.topic ORDER BY COUNT(DISTINCT m.transcript_id) DESC, m.module_display ASC) mrn
        FROM sel s JOIN faq fq ON fq.topic = s.topic JOIN tmods m ON m.transcript_id = fq.transcript_id
        GROUP BY s.topic, s.rn, m.module_display
    )
    SELECT COALESCE(jsonb_agg(obj ORDER BY rn), '[]'::jsonb)
    FROM (
        SELECT s.rn, jsonb_build_object(
            'name', s.topic,
            'data', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', co.module_display, 'value', co.v) ORDER BY co.mrn)
                FROM co WHERE co.topic = s.topic AND co.mrn <= 6
            ), '[]'::jsonb)
        ) AS obj
        FROM sel s
    ) z;
$$;
"""

# heatmap co-ocurrencia: módulos (filas) × topics FAQ (cols), valor = transcripts
SQL_FAQ_MODULE_HEAT = """
CREATE OR REPLACE FUNCTION rpc_faq_module_heat(f jsonb, top_modules integer DEFAULT 10, top_topics integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE result jsonb;
BEGIN
    EXECUTE $q$
        WITH faq AS (
            SELECT DISTINCT transcript_id, insight_subtype_display AS topic
            FROM _filter_insights_norm($1)
            WHERE insight_type = 'faq' AND NULLIF(btrim(insight_subtype_display), '') IS NOT NULL
        ),
        tmods AS (
            SELECT DISTINCT transcript_id, module_display AS m
            FROM _filter_insights_norm($1)
            WHERE NULLIF(btrim(module_display), '') IS NOT NULL
        ),
        co AS (
            SELECT m.m, fq.topic, fq.transcript_id
            FROM faq fq JOIN tmods m ON m.transcript_id = fq.transcript_id
        ),
        topic_order AS (
            SELECT topic, ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT transcript_id) DESC, topic ASC) cn
            FROM faq GROUP BY topic
        ),
        tsel AS (SELECT topic, cn FROM topic_order WHERE cn <= $3),
        mod_order AS (
            SELECT m, ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT transcript_id) DESC, m ASC) rn
            FROM co JOIN tsel ON tsel.topic = co.topic GROUP BY m
        ),
        msel AS (SELECT m, rn FROM mod_order WHERE rn <= $2),
        cells AS (
            SELECT co.m, co.topic, COUNT(DISTINCT co.transcript_id) v
            FROM co JOIN msel ON msel.m = co.m JOIN tsel ON tsel.topic = co.topic
            GROUP BY co.m, co.topic
        )
        SELECT jsonb_build_object(
            'rowLabels', (SELECT COALESCE(jsonb_agg(m ORDER BY rn), '[]'::jsonb) FROM msel),
            'colLabels', (SELECT COALESCE(jsonb_agg(topic ORDER BY cn), '[]'::jsonb) FROM tsel),
            'values', (
                SELECT COALESCE(jsonb_agg(arr ORDER BY rn), '[]'::jsonb)
                FROM (
                    SELECT r.rn, (
                        SELECT COALESCE(jsonb_agg(COALESCE(c.v, 0) ORDER BY t.cn), '[]'::jsonb)
                        FROM tsel t LEFT JOIN cells c ON c.m = r.m AND c.topic = t.topic
                    ) AS arr
                    FROM msel r
                ) z
            )
        )
    $q$ INTO result USING f, top_modules, top_topics;
    RETURN result;
END;
$$;
"""

SQL_GRANTS = """
GRANT EXECUTE ON FUNCTION rpc_kpis_norm(jsonb) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_module_demand(jsonb, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_top_breakdowns(jsonb, text, text, text, integer, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_pain_theme_siblings(jsonb, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_faq_module_breakdown(jsonb, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_faq_module_heat(jsonb, integer, integer) TO service_role, authenticated;
NOTIFY pgrst, 'reload schema';
"""

STEPS = [
    ("rpc_kpis_norm", SQL_KPIS_NORM),
    ("rpc_module_demand", SQL_MODULE_DEMAND),
    ("rpc_top_breakdowns", SQL_TOP_BREAKDOWNS),
    ("rpc_pain_theme_siblings", SQL_PAIN_THEME_SIBLINGS),
    ("rpc_faq_module_breakdown", SQL_FAQ_MODULE_BREAKDOWN),
    ("rpc_faq_module_heat", SQL_FAQ_MODULE_HEAT),
    ("grants + reload", SQL_GRANTS),
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
        print("\n✓ RPCs de executive-summary listas.")
        f = "'{\"prompt_version\":\"v3.0\"}'::jsonb"
        cur.execute(f"SELECT * FROM rpc_kpis_norm({f});")
        row = cur.fetchone()
        cols = [d[0] for d in cur.description]
        print("\nSanity — rpc_kpis_norm:")
        for k, v in zip(cols, row):
            print(f"  {k}: {v}")
        cur.execute(f"SELECT name, value FROM rpc_module_demand({f}, 5);")
        print("\nSanity — rpc_module_demand (top 5):")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[1]}")
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
