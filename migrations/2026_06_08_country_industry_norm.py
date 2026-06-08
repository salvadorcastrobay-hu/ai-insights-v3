"""
Consolida país e industria (toque liviano):
  - _norm_country(text)   → mirror de normalizeCountry (Brasil/Brazil→Brasil,
                            Mexico→México, Panama→Panamá, USA/United States→
                            Estados Unidos, etc.). No mapeado → passthrough.
  - _norm_industry(text)  → mirror de normalizeIndustry. Mergea solo misma
                            industria (Financial Services/FINANCIAL_SERVICES,
                            Real State→Real Estate, etc.) y prettifica los enums
                            UPPER_SNAKE de HubSpot. No mapeado snake → initcap.

Rebuild de mv_insights_norm aplicando ambas a las columnas country/industry, y
recrea _filter_insights_norm (con filtros validated + clients vigentes).

CRÍTICO: mantener en sync con humand-insights-web/lib/data/normalizers.ts.

Usage:
    python migrations/2026_06_08_country_industry_norm.py --dry-run
    python migrations/2026_06_08_country_industry_norm.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


# _normkey: recreado self-contained (lower + sin acentos + collapse spaces).
SQL_NORMKEY = r"""
CREATE OR REPLACE FUNCTION public._normkey(v text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT regexp_replace(
        btrim(
            translate(
                lower(COALESCE(v, '')),
                'áàäâãéèëêíìïîóòöôõúùüûñç',
                'aaaaaeeeeiiiiooooouuuunc'
            )
        ),
        '\s+', ' ', 'g'
    );
$$;
"""

SQL_NORM_COUNTRY = r"""
CREATE OR REPLACE FUNCTION public._norm_country(v text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE k text := public._normkey(v);
BEGIN
    IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
    RETURN CASE k
        WHEN 'brasil' THEN 'Brasil'
        WHEN 'brazil' THEN 'Brasil'
        WHEN 'mexico' THEN 'México'
        WHEN 'peru' THEN 'Perú'
        WHEN 'panama' THEN 'Panamá'
        WHEN 'espana' THEN 'España'
        WHEN 'spain' THEN 'España'
        WHEN 'republica dominicana' THEN 'República Dominicana'
        WHEN 'venezuela' THEN 'Venezuela'
        WHEN 'venezuela, bolivarian republic of' THEN 'Venezuela'
        WHEN 'usa' THEN 'Estados Unidos'
        WHEN 'united states' THEN 'Estados Unidos'
        WHEN 'united states of america' THEN 'Estados Unidos'
        WHEN 'canada' THEN 'Canadá'
        ELSE btrim(v)
    END;
END;
$$;
"""

SQL_NORM_INDUSTRY = r"""
CREATE OR REPLACE FUNCTION public._norm_industry(v text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE k text := public._normkey(v); res text;
BEGIN
    IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
    res := CASE k
        -- Merges (misma industria, distinta escritura)
        WHEN 'financial services' THEN 'Financial services'
        WHEN 'financial_services' THEN 'Financial services'
        WHEN 'banking' THEN 'Banking'
        WHEN 'software companies & it services' THEN 'Software Companies & IT services'
        WHEN 'computer_software' THEN 'Software Companies & IT services'
        WHEN 'information_technology_and_services' THEN 'Software Companies & IT services'
        WHEN 'information technology and services' THEN 'Software Companies & IT services'
        WHEN 'it services and it consulting' THEN 'Software Companies & IT services'
        WHEN 'computer_networking' THEN 'Software Companies & IT services'
        WHEN 'pharmaceuticals' THEN 'Pharmaceuticals'
        WHEN 'pharmaceutical manufacturing' THEN 'Pharmaceuticals'
        WHEN 'healthcare' THEN 'Healthcare'
        WHEN 'hospitals and health care' THEN 'Healthcare'
        WHEN 'hospital_health_care' THEN 'Healthcare'
        WHEN 'telecomunications' THEN 'Telecommunications'
        WHEN 'telecommunications' THEN 'Telecommunications'
        WHEN 'wireless' THEN 'Telecommunications'
        WHEN 'automotive' THEN 'Automotive'
        WHEN 'retail' THEN 'Retail'
        WHEN 'construction' THEN 'Construction'
        WHEN 'insurance' THEN 'Insurance'
        WHEN 'restaurants' THEN 'Restaurants'
        WHEN 'real state' THEN 'Real Estate'
        WHEN 'real_estate' THEN 'Real Estate'
        WHEN 'mining' THEN 'Mining'
        WHEN 'mining_metals' THEN 'Mining'
        WHEN 'chemicals/quimicas' THEN 'Chemicals/Químicas'
        WHEN 'chemicals' THEN 'Chemicals/Químicas'
        WHEN 'agriculture' THEN 'Agriculture'
        WHEN 'farming' THEN 'Agriculture'
        WHEN 'gambling & casinos' THEN 'Gambling & Casinos'
        WHEN 'gambling_casinos' THEN 'Gambling & Casinos'
        WHEN 'nonprofit organizations' THEN 'Nonprofit Organizations'
        WHEN 'non_profit_organization_management' THEN 'Nonprofit Organizations'
        WHEN 'transportation & logistics' THEN 'Transportation & Logistics'
        WHEN 'transportation_trucking_railroad' THEN 'Transportation & Logistics'
        WHEN 'transportation/trucking/railroad' THEN 'Transportation & Logistics'
        WHEN 'transportation, logistics, supply chain and storage' THEN 'Transportation & Logistics'
        WHEN 'logistics_and_supply_chain' THEN 'Transportation & Logistics'
        WHEN 'consumer goods' THEN 'Consumer Goods'
        WHEN 'consumer_goods' THEN 'Consumer Goods'
        WHEN 'legal & accounting services' THEN 'Legal & Accounting services'
        WHEN 'legal_services' THEN 'Legal & Accounting services'
        WHEN 'accounting' THEN 'Legal & Accounting services'
        WHEN 'hr/staffing services' THEN 'HR/Staffing Services'
        WHEN 'human_resources' THEN 'HR/Staffing Services'
        WHEN 'manufacturing' THEN 'Manufacturing'
        WHEN 'mechanical_or_industrial_engineering' THEN 'Manufacturing'
        WHEN 'consulting services' THEN 'Consulting Services'
        WHEN 'business consulting and services' THEN 'Consulting Services'
        WHEN 'oil & energy' THEN 'Oil & Energy'
        WHEN 'oil_energy' THEN 'Oil & Energy'
        WHEN 'security services' THEN 'Security Services'
        WHEN 'security_and_investigations' THEN 'Security Services'
        WHEN 'hospitality & tourism' THEN 'Hospitality & Tourism'
        WHEN 'hospitality' THEN 'Hospitality & Tourism'
        WHEN 'media & entertainment' THEN 'Media & Entertainment'
        WHEN 'entertainment' THEN 'Media & Entertainment'
        WHEN 'management consulting' THEN 'Management Consulting'
        WHEN 'management_consulting' THEN 'Management Consulting'
        WHEN 'food_beverages' THEN 'Food & Beverages'
        WHEN 'food_production' THEN 'Food & Beverages'
        WHEN 'food and beverage manufacturing' THEN 'Food & Beverages'
        WHEN 'renewables_environment' THEN 'Renewables & Environment'
        WHEN 'renewable energy semiconductor manufacturing' THEN 'Renewables & Environment'
        -- Solo renombrar (enum → legible, quedan separadas)
        WHEN 'consumer_services' THEN 'Consumer Services'
        WHEN 'individual_family_services' THEN 'Individual & Family Services'
        WHEN 'investment_management' THEN 'Investment Management'
        WHEN 'professional_training_coaching' THEN 'Professional Training & Coaching'
        WHEN 'research' THEN 'Research'
        WHEN 'civil_engineering' THEN 'Civil Engineering'
        WHEN 'building_materials' THEN 'Building Materials'
        WHEN 'apparel_fashion' THEN 'Apparel & Fashion'
        WHEN 'sporting_goods' THEN 'Sporting Goods'
        WHEN 'marketing_and_advertising' THEN 'Marketing & Advertising'
        WHEN 'graphic_design' THEN 'Graphic Design'
        WHEN 'publishing' THEN 'Publishing'
        WHEN 'printing' THEN 'Printing'
        WHEN 'public_relations_and_communications' THEN 'Public Relations & Communications'
        WHEN 'higher_education' THEN 'Higher Education'
        WHEN 'education_management' THEN 'Education Management'
        WHEN 'primary_secondary_education' THEN 'Primary/Secondary Education'
        WHEN 'fishery' THEN 'Fishery'
        WHEN 'paper_forest_products' THEN 'Paper & Forest Products'
        WHEN 'industrial_automation' THEN 'Industrial Automation'
        WHEN 'public_safety' THEN 'Public Safety'
        WHEN 'international_affairs' THEN 'International Affairs'
        WHEN 'airlines_aviation' THEN 'Airlines & Aviation'
        WHEN 'events_services' THEN 'Events Services'
        WHEN 'leisure_travel_tourism' THEN 'Leisure, Travel & Tourism'
        WHEN 'health_wellness_and_fitness' THEN 'Health, Wellness & Fitness'
        ELSE NULL
    END;
    IF res IS NOT NULL THEN RETURN res; END IF;
    -- Enums sin mapear (snake_case) → prettify; el resto pasa tal cual.
    IF position('_' in v) > 0 THEN
        RETURN initcap(regexp_replace(replace(lower(v), '_', ' '), '\s+', ' ', 'g'));
    END IF;
    RETURN btrim(v);
END;
$$;
"""

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
    public._norm_country(v.country) AS country,
    v.segment::text                AS segment,
    public._norm_industry(v.industry) AS industry,
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
CREATE INDEX IF NOT EXISTS mv_insights_norm_country_idx ON mv_insights_norm (country);
CREATE INDEX IF NOT EXISTS mv_insights_norm_industry_idx ON mv_insights_norm (industry);
CREATE INDEX IF NOT EXISTS mv_insights_norm_channel_idx ON mv_insights_norm (acquisition_channel);
CREATE INDEX IF NOT EXISTS mv_insights_norm_validated_idx ON mv_insights_norm (is_validated);
"""

# _filter_insights_norm completo: incluye filtros validated + clients vigentes.
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
      AND (f->>'clients' IS NULL OR f->>'clients' <> 'true' OR lower(m.deal_stage) LIKE '%won%')
      AND (f->>'date_start' IS NULL OR m.call_date IS NULL OR m.call_date >= (f->>'date_start')::date)
      AND (f->>'date_end' IS NULL OR m.call_date IS NULL OR m.call_date <= (f->>'date_end')::date)
      AND (f->>'min_confidence' IS NULL OR m.confidence IS NULL OR m.confidence >= (f->>'min_confidence')::numeric);
$$;
"""

SQL_GRANTS = """
GRANT EXECUTE ON FUNCTION public._normkey(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public._norm_country(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public._norm_industry(text) TO service_role, authenticated;
GRANT SELECT ON mv_insights_norm TO service_role, authenticated;
NOTIFY pgrst, 'reload schema';
"""

STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '600s';"),
    ("_normkey", SQL_NORMKEY),
    ("_norm_country", SQL_NORM_COUNTRY),
    ("_norm_industry", SQL_NORM_INDUSTRY),
    ("rebuild MV (country/industry norm)", SQL_CREATE_MV),
    ("indexes", SQL_INDEXES),
    ("_filter_insights_norm (validated + clients)", SQL_FILTER_NORM),
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
        print("\n✓ País + industria consolidados en la MV.")
        cur.execute("SELECT COUNT(DISTINCT country), COUNT(DISTINCT industry) FROM mv_insights_norm;")
        c, ind = cur.fetchone()
        print(f"  países distintos: {c} | industrias distintas: {ind}")
        print("\n  Top países:")
        cur.execute(
            "SELECT country, COUNT(*) FROM mv_insights_norm WHERE prompt_version='v3.0' "
            "GROUP BY country ORDER BY 2 DESC LIMIT 12;"
        )
        for name, n in cur.fetchall():
            print(f"    {name}: {n}")
        print("\n  Top industrias:")
        cur.execute(
            "SELECT industry, COUNT(*) FROM mv_insights_norm WHERE prompt_version='v3.0' "
            "GROUP BY industry ORDER BY 2 DESC LIMIT 12;"
        )
        for name, n in cur.fetchall():
            print(f"    {name}: {n}")
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
