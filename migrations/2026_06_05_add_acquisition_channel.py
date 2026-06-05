"""
Migration: agregar acquisition_channel a la MV normalizada.

Para mostrar "deals inbound vs total" en el Overview necesitamos el canal de
adquisición, que en TS se deriva de deal_source (raw_deals.properties) vía
deriveDealSource + normalizeAcquisitionChannel. Lo replicamos en SQL:

  - _acquisition_channel(props jsonb) → Inbound | Outbound | Partner / Referral | Otros
  - se agrega columna acquisition_channel a mv_insights_norm (join raw_deals)
  - _filter_insights_norm expone la columna + filtra por f->'channels'

CRÍTICO mantener en sync con lib/data/normalizers.ts (los sets de canales).

Usage:
    python migrations/2026_06_05_add_acquisition_channel.py --dry-run
    python migrations/2026_06_05_add_acquisition_channel.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


SQL_ACQ_FN = """
CREATE OR REPLACE FUNCTION _acquisition_channel(props jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
    p jsonb;
    src text;
    det text;
    v text;
    lv text;
BEGIN
    IF props IS NULL THEN RETURN 'Otros'; END IF;
    -- raw_deals.properties está doble-encodeada: jsonb cuyo valor es un string
    -- de JSON. Si es string, re-parseamos el JSON interno (igual que asObject()
    -- en TS hace JSON.parse). Si ya es objeto, lo usamos directo.
    IF jsonb_typeof(props) = 'string' THEN
        BEGIN
            p := (props #>> '{}')::jsonb;
        EXCEPTION WHEN others THEN
            RETURN 'Otros';
        END;
    ELSE
        p := props;
    END IF;
    src := COALESCE(
        NULLIF(btrim(p->>'origen_del_contacto__from_where_we_got_the_call_'), ''),
        NULLIF(btrim(p->>'deal_source__bdr_'), ''),
        NULLIF(btrim(p->>'sqo_source_channel'), ''),
        NULLIF(btrim(p->>'hs_analytics_source'), ''),
        NULLIF(btrim(p->>'hs_object_source_label'), '')
    );
    det := COALESCE(
        NULLIF(btrim(p->>'inbound_source'), ''),
        NULLIF(btrim(p->>'partner_name'), ''),
        NULLIF(btrim(p->>'hs_analytics_source_data_1'), ''),
        NULLIF(btrim(p->>'hs_analytics_latest_source_data_1'), '')
    );
    FOREACH v IN ARRAY ARRAY[src, det] LOOP
        IF v IS NULL THEN CONTINUE; END IF;
        lv := lower(btrim(v));
        IF lv IN ('marketing','inbound','event','prensa','webinar','google ads','meta ads',
                  'landing','linkedin','referrals','organic search','paid search','email marketing',
                  'organic social','paid social','direct traffic','offline sources','other campaigns',
                  'ai referrals') THEN
            RETURN 'Inbound';
        ELSIF lv IN ('bdr','ae','cx','external bdr','outbound partner') THEN
            RETURN 'Outbound';
        ELSIF lv IN ('partner','referral partner','business partner','alliance','hu referral',
                     'standard cx referral','hu coins admin panel') THEN
            RETURN 'Partner / Referral';
        END IF;
    END LOOP;
    RETURN 'Otros';
END;
$$;
"""

# Rebuild de la MV agregando acquisition_channel (join raw_deals por properties).
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
    public._acquisition_channel(d.properties) AS acquisition_channel
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
    is_own_brand boolean, acquisition_channel text
)
LANGUAGE sql STABLE
AS $$
    SELECT
        m.transcript_id, m.deal_id, m.amount, m.call_date, m.confidence,
        m.insight_type, m.insight_type_display, m.insight_subtype_display,
        m.region, m.country, m.segment, m.industry, m.deal_owner,
        m.module_display, m.module_status, m.hr_category_display, m.pain_theme,
        m.feature_display, m.deal_stage, m.competitor_name,
        m.competitor_relationship_display, m.is_own_brand, m.acquisition_channel
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

SQL_REFRESH = "REFRESH MATERIALIZED VIEW mv_insights_norm;"
SQL_GRANTS = "GRANT SELECT ON mv_insights_norm TO service_role, authenticated;"


STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '600s';"),
    ("_acquisition_channel", SQL_ACQ_FN),
    ("rebuild MV con acquisition_channel", SQL_CREATE_MV),
    ("indexes", SQL_INDEXES),
    ("_filter_insights_norm (+channels)", SQL_FILTER_NORM),
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
        print("\n✓ acquisition_channel agregado a la MV.")
        cur.execute(
            "SELECT acquisition_channel, COUNT(DISTINCT deal_id) "
            "FROM mv_insights_norm GROUP BY acquisition_channel ORDER BY 2 DESC;"
        )
        print("\nDeals únicos por canal:")
        for ch, n in cur.fetchall():
            print(f"  {ch}: {n}")
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
