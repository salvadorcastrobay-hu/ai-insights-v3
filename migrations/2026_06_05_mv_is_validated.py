"""
Rebuild MV agregando is_validated (first_meeting_status='Validated') +
filtro `validated` en _filter_insights_norm. Habilita el toggle "Solo demos
validadas" en el Overview, performante (booleano precomputado, sin escanear
raw_deals por query).

Usage:
    python migrations/2026_06_05_mv_is_validated.py --dry-run
    python migrations/2026_06_05_mv_is_validated.py
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
    v.company_name::text           AS company_name,
    v.deal_name::text              AS deal_name,
    v.gap_priority::text           AS gap_priority,
    v.feature_name::text           AS feature_name,
    v.competitor_relationship::text AS competitor_relationship,
    (public._deal_prop(d.properties, 'first_meeting_status') = 'Validated') AS is_validated
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
CREATE INDEX IF NOT EXISTS mv_insights_norm_validated_idx ON mv_insights_norm (is_validated);
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
    competitor_relationship text, is_validated boolean
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
        m.competitor_relationship, m.is_validated
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
      AND (f->>'validated' IS NULL OR f->>'validated' <> 'true' OR m.is_validated = true)
      AND (f->>'date_start' IS NULL OR m.call_date IS NULL OR m.call_date >= (f->>'date_start')::date)
      AND (f->>'date_end' IS NULL OR m.call_date IS NULL OR m.call_date <= (f->>'date_end')::date)
      AND (f->>'min_confidence' IS NULL OR m.confidence IS NULL OR m.confidence >= (f->>'min_confidence')::numeric);
$$;
"""

SQL_GRANTS = "GRANT SELECT ON mv_insights_norm TO service_role, authenticated;"

STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '600s';"),
    ("rebuild MV (+is_validated)", SQL_CREATE_MV),
    ("indexes", SQL_INDEXES),
    ("_filter_insights_norm (+validated filter)", SQL_FILTER_NORM),
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
        print("\n✓ MV con is_validated + filtro validated listo.")
        cur.execute("SELECT COUNT(*) FILTER (WHERE is_validated), COUNT(*) FROM mv_insights_norm;")
        v, t = cur.fetchone()
        print(f"Filas validadas: {v} / {t}")
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
