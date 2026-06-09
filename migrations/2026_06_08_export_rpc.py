"""
rpc_export_insights(f jsonb): devuelve TODAS las columnas que necesita el CSV
export, filtrando sobre v_insights_dashboard (no la MV, que no tiene las
columnas de texto: summary, verbatim_quote, gap_description, etc.).

Aplica los MISMOS filtros que _filter_insights_norm + validated (via
first_meeting_status) + clients (deal_stage). Normaliza region/country/
industry/competitor con las _norm_* y deriva deal_source/acquisition_channel
igual que el path JS (deriveDealSource / normalizeAcquisitionChannel).

La route /api/export/csv la consume con un cursor de Postgres (streaming) →
no carga las ~150K filas a memoria de Node (evita OOM en Railway) y respeta
el filtro de validadas.

Usage:
    python migrations/2026_06_08_export_rpc.py --dry-run
    python migrations/2026_06_08_export_rpc.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
CREATE OR REPLACE FUNCTION rpc_export_insights(f jsonb)
RETURNS TABLE(
    id text, transcript_id text, deal_id text, deal_name text, company_name text,
    region text, country text, segment text, industry text, deal_stage text,
    deal_owner text, call_date date, amount numeric, insight_type text,
    insight_subtype text, module text, summary text, verbatim_quote text,
    confidence numeric, competitor_name text, competitor_relationship text,
    feature_name text, gap_description text, gap_priority text,
    insight_type_display text, insight_subtype_display text, module_display text,
    module_status text, hr_category_display text, pain_theme text, pain_scope text,
    feature_display text, feature_is_seed boolean, competitor_relationship_display text,
    deal_source text, deal_source_detail text, inbound_source text, partner_name text,
    acquisition_channel text, is_own_brand_competitor boolean
)
LANGUAGE sql STABLE
AS $$
    SELECT
        v.id::text, v.transcript_id::text, v.deal_id::text, v.deal_name::text, v.company_name::text,
        public._norm_region(v.region, v.country) AS region,
        public._norm_country(v.country) AS country,
        v.segment::text,
        public._norm_industry(v.industry) AS industry,
        v.deal_stage::text, v.deal_owner::text, v.call_date::date, v.amount::numeric,
        v.insight_type::text, v.insight_subtype::text, v.module::text, v.summary::text,
        v.verbatim_quote::text, v.confidence::numeric,
        public._norm_competitor(v.competitor_name) AS competitor_name,
        v.competitor_relationship::text, v.feature_name::text, v.gap_description::text,
        v.gap_priority::text, v.insight_type_display::text, v.insight_subtype_display::text,
        v.module_display::text, v.module_status::text, v.hr_category_display::text,
        v.pain_theme::text, v.pain_scope::text, v.feature_display::text,
        v.feature_is_seed::boolean, v.competitor_relationship_display::text,
        COALESCE(
            NULLIF(TRIM(public._deal_prop(d.properties, 'origen_del_contacto__from_where_we_got_the_call_')), ''),
            NULLIF(TRIM(public._deal_prop(d.properties, 'deal_source__bdr_')), ''),
            NULLIF(TRIM(public._deal_prop(d.properties, 'sqo_source_channel')), ''),
            NULLIF(TRIM(public._deal_prop(d.properties, 'hs_analytics_source')), ''),
            NULLIF(TRIM(public._deal_prop(d.properties, 'hs_object_source_label')), '')
        ) AS deal_source,
        COALESCE(
            NULLIF(TRIM(public._deal_prop(d.properties, 'inbound_source')), ''),
            NULLIF(TRIM(public._deal_prop(d.properties, 'partner_name')), ''),
            NULLIF(TRIM(public._deal_prop(d.properties, 'hs_analytics_source_data_1')), ''),
            NULLIF(TRIM(public._deal_prop(d.properties, 'hs_analytics_latest_source_data_1')), '')
        ) AS deal_source_detail,
        NULLIF(TRIM(public._deal_prop(d.properties, 'inbound_source')), '') AS inbound_source,
        NULLIF(TRIM(public._deal_prop(d.properties, 'partner_name')), '') AS partner_name,
        public._acquisition_channel(d.properties) AS acquisition_channel,
        public._is_own_brand(v.competitor_name) AS is_own_brand_competitor
    FROM v_insights_dashboard v
    LEFT JOIN raw_deals d ON d.deal_id = v.deal_id
    WHERE v.prompt_version = COALESCE(f->>'prompt_version', 'v3.0')
      AND (jsonb_array_length(COALESCE(f->'types', '[]'::jsonb)) = 0
           OR v.insight_type_display = ANY(SELECT jsonb_array_elements_text(f->'types')))
      AND (jsonb_array_length(COALESCE(f->'regions', '[]'::jsonb)) = 0
           OR public._norm_region(v.region, v.country) = ANY(SELECT jsonb_array_elements_text(f->'regions')))
      AND (jsonb_array_length(COALESCE(f->'segments', '[]'::jsonb)) = 0
           OR v.segment = ANY(SELECT jsonb_array_elements_text(f->'segments')))
      AND (jsonb_array_length(COALESCE(f->'countries', '[]'::jsonb)) = 0
           OR public._norm_country(v.country) = ANY(SELECT jsonb_array_elements_text(f->'countries')))
      AND (jsonb_array_length(COALESCE(f->'industries', '[]'::jsonb)) = 0
           OR public._norm_industry(v.industry) = ANY(SELECT jsonb_array_elements_text(f->'industries')))
      AND (jsonb_array_length(COALESCE(f->'owners', '[]'::jsonb)) = 0
           OR v.deal_owner = ANY(SELECT jsonb_array_elements_text(f->'owners')))
      AND (jsonb_array_length(COALESCE(f->'modules', '[]'::jsonb)) = 0
           OR v.module_display = ANY(SELECT jsonb_array_elements_text(f->'modules')))
      AND (jsonb_array_length(COALESCE(f->'categories', '[]'::jsonb)) = 0
           OR v.hr_category_display = ANY(SELECT jsonb_array_elements_text(f->'categories')))
      AND (jsonb_array_length(COALESCE(f->'channels', '[]'::jsonb)) = 0
           OR public._acquisition_channel(d.properties) = ANY(SELECT jsonb_array_elements_text(f->'channels')))
      AND (f->>'validated' IS NULL OR f->>'validated' <> 'true'
           OR public._deal_prop(d.properties, 'first_meeting_status') = 'Validated')
      AND (f->>'clients' IS NULL OR f->>'clients' <> 'true' OR lower(v.deal_stage) LIKE '%won%')
      AND (f->>'date_start' IS NULL OR v.call_date IS NULL OR v.call_date >= (f->>'date_start')::date)
      AND (f->>'date_end' IS NULL OR v.call_date IS NULL OR v.call_date <= (f->>'date_end')::date)
      AND (f->>'min_confidence' IS NULL OR v.confidence IS NULL OR v.confidence >= (f->>'min_confidence')::numeric);
$$;

GRANT EXECUTE ON FUNCTION rpc_export_insights(jsonb) TO service_role, authenticated;
NOTIFY pgrst, 'reload schema';
"""


def main() -> int:
    if "--dry-run" in sys.argv:
        print(SQL)
        return 0
    import config  # noqa
    import psycopg2  # noqa

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SET statement_timeout = '120s';")
        cur.execute(SQL)
        conn.commit()
        print("✓ rpc_export_insights creada.")
        cur.execute("SELECT COUNT(*) FROM rpc_export_insights('{\"prompt_version\":\"v3.0\",\"validated\":\"true\"}'::jsonb);")
        print(f"  filas export (validadas): {cur.fetchone()[0]}")
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
