"""
Rebuild MV con columnas extra + RPCs bespoke de competitive-intelligence.

Agrega a mv_insights_norm 5 columnas crudas que necesitan las migraciones de
las páginas restantes (competitive, product-intel, product-gaps):
  company_name, deal_name, gap_priority, feature_name, competitor_relationship (raw)

Y crea 2 RPCs bespoke de competitive-intelligence:
  - rpc_competitive_kpis(f): relevantCompetitors, dealsWithSignal, totalDeals, compRevenue
  - rpc_migration_rows(f): tabla de deals migrando-desde/usando-actualmente

Idempotente. Una sola rebuild de MV para no repetir. Lee de v_insights_dashboard.

Usage:
    python migrations/2026_06_05_mv_extra_cols_and_competitive.py --dry-run
    python migrations/2026_06_05_mv_extra_cols_and_competitive.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


SQL_CREATE_MV = """
DROP MATERIALIZED VIEW IF EXISTS mv_insights_norm CASCADE;
CREATE MATERIALIZED VIEW mv_insights_norm AS
SELECT
    v.id,
    v.transcript_id::text          AS transcript_id,
    v.deal_id::text                AS deal_id,
    v.amount::numeric              AS amount,
    v.call_date::date              AS call_date,
    v.confidence::numeric          AS confidence,
    v.prompt_version,
    v.insight_type::text           AS insight_type,
    v.insight_type_display::text   AS insight_type_display,
    v.insight_subtype_display::text AS insight_subtype_display,
    public._norm_region(v.region, v.country) AS region,
    v.country::text                AS country,
    v.segment::text                AS segment,
    v.industry::text               AS industry,
    v.deal_owner::text             AS deal_owner,
    v.module_display::text         AS module_display,
    v.module_status::text          AS module_status,
    v.hr_category_display::text    AS hr_category_display,
    v.pain_theme::text             AS pain_theme,
    v.feature_display::text        AS feature_display,
    v.deal_stage::text             AS deal_stage,
    public._norm_competitor(v.competitor_name) AS competitor_name,
    v.competitor_relationship_display::text AS competitor_relationship_display,
    public._is_own_brand(v.competitor_name) AS is_own_brand,
    public._acquisition_channel(d.properties) AS acquisition_channel,
    -- columnas extra para migraciones de páginas
    v.company_name::text           AS company_name,
    v.deal_name::text              AS deal_name,
    v.gap_priority::text           AS gap_priority,
    v.feature_name::text           AS feature_name,
    v.competitor_relationship::text AS competitor_relationship
FROM v_insights_dashboard v
LEFT JOIN raw_deals d ON d.deal_id = v.deal_id;
"""

SQL_INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS mv_insights_norm_id_uidx ON mv_insights_norm (id);
CREATE INDEX IF NOT EXISTS mv_insights_norm_pv_type_idx ON mv_insights_norm (prompt_version, insight_type);
CREATE INDEX IF NOT EXISTS mv_insights_norm_date_idx ON mv_insights_norm (call_date);
CREATE INDEX IF NOT EXISTS mv_insights_norm_pv_date_idx ON mv_insights_norm (prompt_version, call_date);
CREATE INDEX IF NOT EXISTS mv_insights_norm_region_idx ON mv_insights_norm (region);
CREATE INDEX IF NOT EXISTS mv_insights_norm_channel_idx ON mv_insights_norm (acquisition_channel);
"""

SQL_FILTER_NORM = """
DROP FUNCTION IF EXISTS _filter_insights_norm(jsonb);
CREATE OR REPLACE FUNCTION _filter_insights_norm(f jsonb)
RETURNS TABLE(
    transcript_id text, deal_id text, amount numeric, call_date date,
    confidence numeric, insight_type text, insight_type_display text,
    insight_subtype_display text, region text, country text, segment text,
    industry text, deal_owner text, module_display text, module_status text,
    hr_category_display text, pain_theme text, feature_display text,
    deal_stage text, competitor_name text, competitor_relationship_display text,
    is_own_brand boolean, acquisition_channel text,
    company_name text, deal_name text, gap_priority text, feature_name text,
    competitor_relationship text
)
LANGUAGE sql STABLE
AS $$
    SELECT
        m.transcript_id, m.deal_id, m.amount, m.call_date, m.confidence,
        m.insight_type, m.insight_type_display, m.insight_subtype_display,
        m.region, m.country, m.segment, m.industry, m.deal_owner,
        m.module_display, m.module_status, m.hr_category_display, m.pain_theme,
        m.feature_display, m.deal_stage, m.competitor_name,
        m.competitor_relationship_display, m.is_own_brand, m.acquisition_channel,
        m.company_name, m.deal_name, m.gap_priority, m.feature_name,
        m.competitor_relationship
    FROM mv_insights_norm m
    WHERE m.prompt_version = COALESCE(f->>'prompt_version', 'v3.0')
      AND (jsonb_array_length(COALESCE(f->'types', '[]'::jsonb)) = 0
           OR m.insight_type_display = ANY(SELECT jsonb_array_elements_text(f->'types')))
      AND (jsonb_array_length(COALESCE(f->'regions', '[]'::jsonb)) = 0
           OR m.region = ANY(SELECT jsonb_array_elements_text(f->'regions')))
      AND (jsonb_array_length(COALESCE(f->'segments', '[]'::jsonb)) = 0
           OR m.segment = ANY(SELECT jsonb_array_elements_text(f->'segments')))
      AND (jsonb_array_length(COALESCE(f->'countries', '[]'::jsonb)) = 0
           OR m.country = ANY(SELECT jsonb_array_elements_text(f->'countries')))
      AND (jsonb_array_length(COALESCE(f->'industries', '[]'::jsonb)) = 0
           OR m.industry = ANY(SELECT jsonb_array_elements_text(f->'industries')))
      AND (jsonb_array_length(COALESCE(f->'owners', '[]'::jsonb)) = 0
           OR m.deal_owner = ANY(SELECT jsonb_array_elements_text(f->'owners')))
      AND (jsonb_array_length(COALESCE(f->'modules', '[]'::jsonb)) = 0
           OR m.module_display = ANY(SELECT jsonb_array_elements_text(f->'modules')))
      AND (jsonb_array_length(COALESCE(f->'categories', '[]'::jsonb)) = 0
           OR m.hr_category_display = ANY(SELECT jsonb_array_elements_text(f->'categories')))
      AND (jsonb_array_length(COALESCE(f->'channels', '[]'::jsonb)) = 0
           OR m.acquisition_channel = ANY(SELECT jsonb_array_elements_text(f->'channels')))
      AND (f->>'date_start' IS NULL OR m.call_date IS NULL OR m.call_date >= (f->>'date_start')::date)
      AND (f->>'date_end' IS NULL OR m.call_date IS NULL OR m.call_date <= (f->>'date_end')::date)
      AND (f->>'min_confidence' IS NULL OR m.confidence IS NULL OR m.confidence >= (f->>'min_confidence')::numeric);
$$;
"""

# Relaciones "fuertes" (raw + display) — mirror de competitive-intelligence-data.ts
STRONG_RAW = "'currently_using','evaluating','migrating_from','migrating_to','replaced','previously_used'"
STRONG_DISP = "'Usa actualmente','Evaluando','Migrando desde','Uso anterior','Descartado'"
MIG_RAW = "'migrating_from','currently_using'"
MIG_DISP = "'Migrando desde','Usa actualmente'"

SQL_COMPETITIVE_KPIS = f"""
CREATE OR REPLACE FUNCTION rpc_competitive_kpis(f jsonb)
RETURNS TABLE(
    relevant_competitors bigint, deals_with_signal bigint,
    total_deals bigint, comp_revenue numeric
)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (SELECT * FROM _filter_insights_norm(f)),
    comp AS (
        SELECT * FROM filtered
        WHERE insight_type = 'competitive_signal' AND COALESCE(is_own_brand, false) = false
    ),
    comp_deals AS (
        SELECT DISTINCT ON (deal_id) deal_id, amount FROM comp
        WHERE deal_id IS NOT NULL ORDER BY deal_id, amount DESC NULLS LAST
    )
    SELECT
        (SELECT COUNT(DISTINCT competitor_name) FROM comp
         WHERE competitor_relationship IN ({STRONG_RAW})
            OR competitor_relationship_display IN ({STRONG_DISP}))::bigint,
        (SELECT COUNT(DISTINCT deal_id) FROM comp WHERE deal_id IS NOT NULL)::bigint,
        (SELECT COUNT(DISTINCT deal_id) FROM filtered WHERE deal_id IS NOT NULL)::bigint,
        COALESCE((SELECT SUM(amount) FROM comp_deals WHERE amount IS NOT NULL), 0)::numeric;
$$;
"""

SQL_MIGRATION_ROWS = f"""
CREATE OR REPLACE FUNCTION rpc_migration_rows(f jsonb)
RETURNS TABLE(
    id text, company text, competitor text, relationship text, industry text,
    country text, segment text, revenue numeric, stage text, owner text, deal text
)
LANGUAGE sql STABLE
AS $$
    WITH comp AS (
        SELECT * FROM _filter_insights_norm(f)
        WHERE insight_type = 'competitive_signal'
          AND COALESCE(is_own_brand, false) = false
          AND (competitor_relationship IN ({MIG_RAW})
               OR competitor_relationship_display IN ({MIG_DISP}))
    ),
    deduped AS (
        SELECT DISTINCT ON (deal_id, competitor_name) *
        FROM comp ORDER BY deal_id, competitor_name, amount DESC NULLS LAST
    )
    SELECT
        transcript_id AS id,
        COALESCE(company_name, '—') AS company,
        COALESCE(competitor_name, '—') AS competitor,
        COALESCE(competitor_relationship_display, competitor_relationship, '—') AS relationship,
        COALESCE(industry, '—') AS industry,
        COALESCE(country, '—') AS country,
        COALESCE(segment, '—') AS segment,
        COALESCE(amount, 0)::numeric AS revenue,
        COALESCE(deal_stage, '—') AS stage,
        COALESCE(deal_owner, '—') AS owner,
        COALESCE(deal_name, '—') AS deal
    FROM deduped
    ORDER BY revenue DESC;
$$;
"""

SQL_GRANTS = """
GRANT SELECT ON mv_insights_norm TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_competitive_kpis(jsonb) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION rpc_migration_rows(jsonb) TO service_role, authenticated;
"""

STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '600s';"),
    ("rebuild MV (+5 cols)", SQL_CREATE_MV),
    ("indexes", SQL_INDEXES),
    ("_filter_insights_norm (+5 cols)", SQL_FILTER_NORM),
    ("rpc_competitive_kpis", SQL_COMPETITIVE_KPIS),
    ("rpc_migration_rows", SQL_MIGRATION_ROWS),
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
        print("\n✓ MV rebuild + RPCs de competitive listos.")
        f = "'{\"prompt_version\":\"v3.0\"}'::jsonb"
        cur.execute(f"SELECT * FROM rpc_competitive_kpis({f});")
        row = cur.fetchone()
        cols = [d[0] for d in cur.description]
        print("\nSanity — rpc_competitive_kpis:")
        for k, v in zip(cols, row):
            print(f"  {k}: {v}")
        cur.execute(f"SELECT competitor, company, revenue FROM rpc_migration_rows({f}) LIMIT 5;")
        print("\nSanity — rpc_migration_rows (top 5 por revenue):")
        for r in cur.fetchall():
            print(f"  {r[0]} @ {r[1]}: ${r[2]:,.0f}")
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
