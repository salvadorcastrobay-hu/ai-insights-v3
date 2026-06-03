"""
Migration: SQL normalization layer (Phase 2 — Step 3c).

El dashboard normaliza region y competitor_name EN TYPESCRIPT al cargar
(normalizers.ts). La vista v_insights_dashboard tiene los valores crudos.
Para que las RPCs de agregación matcheen el dashboard, replicamos esa
normalización en SQL:

  - _normkey(text)            → mirror de normalizeKey (lower + sin acentos + collapse spaces)
  - _norm_region(text,text)   → mirror de normalizeRegion (alias map + country fallback → 6 regiones o NULL)
  - _norm_competitor(text)    → mirror de normalizeCompetitor (alias map, else passthrough)
  - _is_own_brand(text)       → mirror de isOwnBrand
  - _filter_insights_norm(f)  → como _filter_insights pero expone region/competitor
                                 normalizados Y filtra region por el valor normalizado.

Luego REEMPLAZA rpc_group_distinct / rpc_group_with_pct / rpc_revenue_by
para que lean de _filter_insights_norm (region/competitor ya normalizados)
y usen la columna is_own_brand en vez del check inline.

CRÍTICO mantener en sync con humand-insights-web/lib/data/normalizers.ts.

NO modifica data ni schema. Todas STABLE/IMMUTABLE. Idempotente.
Rollback: DROP FUNCTION ...

Usage:
    python migrations/2026_06_03b_sql_normalization.py --dry-run
    python migrations/2026_06_03b_sql_normalization.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


# ============================================================================
# _normkey — mirror de normalizeKey(): lower + strip accents + collapse spaces.
# Sin extensión unaccent (puede no estar disponible): translate() manual del
# set latino lower-case.
# ============================================================================

SQL_NORMKEY = r"""
CREATE OR REPLACE FUNCTION _normkey(v text)
RETURNS text
LANGUAGE sql IMMUTABLE
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


# ============================================================================
# _norm_region — mirror de normalizeRegion(value, country).
# 1) value: si ya es región oficial → devolver; si está en alias map → devolver.
# 2) country fallback → COUNTRY_TO_REGION.
# 3) sin match → NULL.
# Las keys de los CASE están pre-normalizadas con _normkey (accent-stripped).
# ============================================================================

SQL_NORM_REGION = r"""
CREATE OR REPLACE FUNCTION _norm_region(region text, country text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    cleaned text := regexp_replace(btrim(COALESCE(region, '')), '\s+', ' ', 'g');
    rkey text := _normkey(region);
    ckey text := _normkey(country);
    res text;
BEGIN
    -- 1a) región oficial exacta
    IF cleaned IN ('HISPAM','ANGLO AMERICA','APAC','Brazil','EMEA','MENA') THEN
        RETURN cleaned;
    END IF;

    -- 1b) alias map (REGION_ALIASES)
    res := CASE rkey
        WHEN 'latam' THEN 'HISPAM'
        WHEN 'hispam' THEN 'HISPAM'
        WHEN 'santa fe province' THEN 'HISPAM'
        WHEN 'mendoza' THEN 'HISPAM'
        WHEN 'mendoza province' THEN 'HISPAM'
        WHEN 'cordoba' THEN 'HISPAM'
        WHEN 'cordoba capital' THEN 'HISPAM'
        WHEN 'cordoba province' THEN 'HISPAM'
        WHEN 'mexico city' THEN 'HISPAM'
        WHEN 'ciudad de mexico' THEN 'HISPAM'
        WHEN 'ciudad de mexico cdmx' THEN 'HISPAM'
        WHEN 'madrid' THEN 'EMEA'
        WHEN 'community of madrid' THEN 'EMEA'
        WHEN 'espana' THEN 'EMEA'
        WHEN 'spain' THEN 'EMEA'
        WHEN 'emea' THEN 'EMEA'
        WHEN 'north america' THEN 'ANGLO AMERICA'
        WHEN 'namer' THEN 'ANGLO AMERICA'
        WHEN 'na region' THEN 'ANGLO AMERICA'
        WHEN 'anglo america' THEN 'ANGLO AMERICA'
        WHEN 'apac' THEN 'APAC'
        WHEN 'mena' THEN 'MENA'
        WHEN 'brasil' THEN 'Brazil'
        WHEN 'brazil' THEN 'Brazil'
        ELSE NULL
    END;
    IF res IS NOT NULL THEN RETURN res; END IF;

    -- 2) country fallback (COUNTRY_TO_REGION)
    res := CASE ckey
        WHEN 'argentina' THEN 'HISPAM'
        WHEN 'mexico' THEN 'HISPAM'
        WHEN 'colombia' THEN 'HISPAM'
        WHEN 'chile' THEN 'HISPAM'
        WHEN 'peru' THEN 'HISPAM'
        WHEN 'uruguay' THEN 'HISPAM'
        WHEN 'paraguay' THEN 'HISPAM'
        WHEN 'bolivia' THEN 'HISPAM'
        WHEN 'ecuador' THEN 'HISPAM'
        WHEN 'venezuela' THEN 'HISPAM'
        WHEN 'costa rica' THEN 'HISPAM'
        WHEN 'panama' THEN 'HISPAM'
        WHEN 'guatemala' THEN 'HISPAM'
        WHEN 'honduras' THEN 'HISPAM'
        WHEN 'el salvador' THEN 'HISPAM'
        WHEN 'nicaragua' THEN 'HISPAM'
        WHEN 'dominican republic' THEN 'HISPAM'
        WHEN 'republica dominicana' THEN 'HISPAM'
        WHEN 'cuba' THEN 'HISPAM'
        WHEN 'puerto rico' THEN 'HISPAM'
        WHEN 'brazil' THEN 'Brazil'
        WHEN 'brasil' THEN 'Brazil'
        WHEN 'united states' THEN 'ANGLO AMERICA'
        WHEN 'usa' THEN 'ANGLO AMERICA'
        WHEN 'us' THEN 'ANGLO AMERICA'
        WHEN 'united states of america' THEN 'ANGLO AMERICA'
        WHEN 'canada' THEN 'ANGLO AMERICA'
        WHEN 'spain' THEN 'EMEA'
        WHEN 'espana' THEN 'EMEA'
        WHEN 'france' THEN 'EMEA'
        WHEN 'germany' THEN 'EMEA'
        WHEN 'italy' THEN 'EMEA'
        WHEN 'italia' THEN 'EMEA'
        WHEN 'portugal' THEN 'EMEA'
        WHEN 'netherlands' THEN 'EMEA'
        WHEN 'belgium' THEN 'EMEA'
        WHEN 'switzerland' THEN 'EMEA'
        WHEN 'austria' THEN 'EMEA'
        WHEN 'sweden' THEN 'EMEA'
        WHEN 'norway' THEN 'EMEA'
        WHEN 'denmark' THEN 'EMEA'
        WHEN 'finland' THEN 'EMEA'
        WHEN 'poland' THEN 'EMEA'
        WHEN 'ireland' THEN 'EMEA'
        WHEN 'greece' THEN 'EMEA'
        WHEN 'czech republic' THEN 'EMEA'
        WHEN 'czechia' THEN 'EMEA'
        WHEN 'romania' THEN 'EMEA'
        WHEN 'hungary' THEN 'EMEA'
        WHEN 'united kingdom' THEN 'EMEA'
        WHEN 'uk' THEN 'EMEA'
        WHEN 'great britain' THEN 'EMEA'
        WHEN 'england' THEN 'EMEA'
        WHEN 'scotland' THEN 'EMEA'
        WHEN 'wales' THEN 'EMEA'
        WHEN 'northern ireland' THEN 'EMEA'
        WHEN 'bulgaria' THEN 'EMEA'
        WHEN 'croatia' THEN 'EMEA'
        WHEN 'slovakia' THEN 'EMEA'
        WHEN 'slovenia' THEN 'EMEA'
        WHEN 'estonia' THEN 'EMEA'
        WHEN 'latvia' THEN 'EMEA'
        WHEN 'lithuania' THEN 'EMEA'
        WHEN 'ukraine' THEN 'EMEA'
        WHEN 'serbia' THEN 'EMEA'
        WHEN 'south africa' THEN 'EMEA'
        WHEN 'nigeria' THEN 'EMEA'
        WHEN 'kenya' THEN 'EMEA'
        WHEN 'japan' THEN 'APAC'
        WHEN 'china' THEN 'APAC'
        WHEN 'india' THEN 'APAC'
        WHEN 'australia' THEN 'APAC'
        WHEN 'new zealand' THEN 'APAC'
        WHEN 'singapore' THEN 'APAC'
        WHEN 'thailand' THEN 'APAC'
        WHEN 'vietnam' THEN 'APAC'
        WHEN 'philippines' THEN 'APAC'
        WHEN 'indonesia' THEN 'APAC'
        WHEN 'malaysia' THEN 'APAC'
        WHEN 'south korea' THEN 'APAC'
        WHEN 'korea' THEN 'APAC'
        WHEN 'hong kong' THEN 'APAC'
        WHEN 'taiwan' THEN 'APAC'
        WHEN 'united arab emirates' THEN 'MENA'
        WHEN 'uae' THEN 'MENA'
        WHEN 'saudi arabia' THEN 'MENA'
        WHEN 'egypt' THEN 'MENA'
        WHEN 'israel' THEN 'MENA'
        WHEN 'turkey' THEN 'MENA'
        WHEN 'qatar' THEN 'MENA'
        WHEN 'kuwait' THEN 'MENA'
        WHEN 'bahrain' THEN 'MENA'
        WHEN 'oman' THEN 'MENA'
        WHEN 'jordan' THEN 'MENA'
        WHEN 'lebanon' THEN 'MENA'
        WHEN 'morocco' THEN 'MENA'
        WHEN 'tunisia' THEN 'MENA'
        WHEN 'algeria' THEN 'MENA'
        ELSE NULL
    END;
    RETURN res; -- NULL si no matchea (mirror del return null de TS)
END;
$$;
"""


# ============================================================================
# _norm_competitor — mirror de normalizeCompetitor (alias map, else passthrough).
# _is_own_brand — mirror de isOwnBrand.
# ============================================================================

SQL_NORM_COMPETITOR = r"""
CREATE OR REPLACE FUNCTION _norm_competitor(v text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    k text := _normkey(v);
BEGIN
    RETURN CASE k
        WHEN 'humand' THEN 'Humand'
        WHEN 'human' THEN 'Humand'
        WHEN 'human d' THEN 'Humand'
        WHEN 'book' THEN 'Buk'
        WHEN 'buk hr' THEN 'Buk'
        WHEN 'bukhr' THEN 'Buk'
        WHEN 'senior' THEN 'Senior'
        WHEN 'solides' THEN 'Sólides'
        WHEN 'solids' THEN 'Sólides'
        WHEN 'fids' THEN 'Feedz'
        WHEN 'feedz' THEN 'Feedz'
        WHEN 'totus' THEN 'Totvs'
        WHEN 'tots' THEN 'Totvs'
        WHEN 'totvs' THEN 'Totvs'
        ELSE v  -- passthrough del valor original (no de la key)
    END;
END;
$$;
"""

SQL_IS_OWN_BRAND = r"""
CREATE OR REPLACE FUNCTION _is_own_brand(v text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
    SELECT _normkey(v) IN ('humand','human','human d');
$$;
"""


# ============================================================================
# _filter_insights_norm — como _filter_insights pero:
#   - expone region/competitor_name NORMALIZADOS
#   - filtra region por el valor normalizado (no el crudo)
#   - agrega columna is_own_brand
# Devuelve solo las columnas que las RPCs agregan/agrupan.
# ============================================================================

SQL_FILTER_NORM = r"""
CREATE OR REPLACE FUNCTION _filter_insights_norm(f jsonb)
RETURNS TABLE(
    transcript_id text,
    deal_id text,
    amount numeric,
    call_date date,
    confidence numeric,
    insight_type text,
    insight_type_display text,
    insight_subtype_display text,
    region text,
    country text,
    segment text,
    industry text,
    deal_owner text,
    module_display text,
    module_status text,
    hr_category_display text,
    pain_theme text,
    feature_display text,
    deal_stage text,
    competitor_name text,
    competitor_relationship_display text,
    is_own_brand boolean
)
LANGUAGE sql STABLE
AS $$
    SELECT
        v.transcript_id::text,
        v.deal_id::text,
        v.amount::numeric,
        v.call_date::date,
        v.confidence::numeric,
        v.insight_type::text,
        v.insight_type_display::text,
        v.insight_subtype_display::text,
        _norm_region(v.region, v.country) AS region,
        v.country::text,
        v.segment::text,
        v.industry::text,
        v.deal_owner::text,
        v.module_display::text,
        v.module_status::text,
        v.hr_category_display::text,
        v.pain_theme::text,
        v.feature_display::text,
        v.deal_stage::text,
        _norm_competitor(v.competitor_name) AS competitor_name,
        v.competitor_relationship_display::text,
        _is_own_brand(v.competitor_name) AS is_own_brand
    FROM v_insights_dashboard v
    WHERE v.prompt_version = COALESCE(f->>'prompt_version', 'v3.0')
      AND (
        jsonb_array_length(COALESCE(f->'types', '[]'::jsonb)) = 0
        OR v.insight_type_display = ANY(SELECT jsonb_array_elements_text(f->'types'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'regions', '[]'::jsonb)) = 0
        OR _norm_region(v.region, v.country) = ANY(SELECT jsonb_array_elements_text(f->'regions'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'segments', '[]'::jsonb)) = 0
        OR v.segment = ANY(SELECT jsonb_array_elements_text(f->'segments'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'countries', '[]'::jsonb)) = 0
        OR v.country = ANY(SELECT jsonb_array_elements_text(f->'countries'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'industries', '[]'::jsonb)) = 0
        OR v.industry = ANY(SELECT jsonb_array_elements_text(f->'industries'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'owners', '[]'::jsonb)) = 0
        OR v.deal_owner = ANY(SELECT jsonb_array_elements_text(f->'owners'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'modules', '[]'::jsonb)) = 0
        OR v.module_display = ANY(SELECT jsonb_array_elements_text(f->'modules'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'categories', '[]'::jsonb)) = 0
        OR v.hr_category_display = ANY(SELECT jsonb_array_elements_text(f->'categories'))
      )
      AND (
        f->>'date_start' IS NULL OR v.call_date IS NULL
        OR v.call_date >= (f->>'date_start')::date
      )
      AND (
        f->>'date_end' IS NULL OR v.call_date IS NULL
        OR v.call_date <= (f->>'date_end')::date
      )
      AND (
        f->>'min_confidence' IS NULL OR v.confidence IS NULL
        OR v.confidence >= (f->>'min_confidence')::numeric
      );
$$;
"""


# ============================================================================
# Repuntar las RPCs genéricas a _filter_insights_norm.
# region/competitor ya vienen normalizados; own-brand via columna is_own_brand.
# ============================================================================

SQL_GROUP_DISTINCT_V2 = """
CREATE OR REPLACE FUNCTION rpc_group_distinct(
    f jsonb, dim text, scope text DEFAULT NULL,
    exclude_own_brand boolean DEFAULT false, n integer DEFAULT 15
)
RETURNS TABLE(name text, value bigint)
LANGUAGE plpgsql STABLE
AS $$
DECLARE col text := _assert_dim(dim);
BEGIN
    RETURN QUERY EXECUTE format($q$
        SELECT v AS name, COUNT(DISTINCT transcript_id)::bigint AS value
        FROM (
            SELECT transcript_id, NULLIF(btrim(%1$I::text), '') AS v
            FROM _filter_insights_norm($1) t
            WHERE ($2 IS NULL OR t.insight_type = $2)
              AND (NOT $3 OR t.is_own_brand = false)
        ) s
        WHERE v IS NOT NULL
        GROUP BY v ORDER BY value DESC, name ASC LIMIT $4
    $q$, col) USING f, scope, exclude_own_brand, n;
END;
$$;
"""

SQL_GROUP_WITH_PCT_V2 = """
CREATE OR REPLACE FUNCTION rpc_group_with_pct(
    f jsonb, dim text, total numeric, scope text DEFAULT NULL,
    exclude_own_brand boolean DEFAULT false, n integer DEFAULT 15
)
RETURNS TABLE(name text, value bigint, pct numeric)
LANGUAGE plpgsql STABLE
AS $$
DECLARE col text := _assert_dim(dim);
BEGIN
    RETURN QUERY EXECUTE format($q$
        SELECT v AS name,
               COUNT(DISTINCT transcript_id)::bigint AS value,
               CASE WHEN $5 > 0
                    THEN ROUND(100.0 * COUNT(DISTINCT transcript_id) / $5, 1)
                    ELSE 0 END AS pct
        FROM (
            SELECT transcript_id, NULLIF(btrim(%1$I::text), '') AS v
            FROM _filter_insights_norm($1) t
            WHERE ($2 IS NULL OR t.insight_type = $2)
              AND (NOT $3 OR t.is_own_brand = false)
        ) s
        WHERE v IS NOT NULL
        GROUP BY v ORDER BY value DESC, name ASC LIMIT $4
    $q$, col) USING f, scope, exclude_own_brand, n, total;
END;
$$;
"""

SQL_REVENUE_BY_V2 = """
CREATE OR REPLACE FUNCTION rpc_revenue_by(
    f jsonb, dim text, scope text DEFAULT NULL,
    exclude_own_brand boolean DEFAULT false, n integer DEFAULT 15
)
RETURNS TABLE(name text, value numeric)
LANGUAGE plpgsql STABLE
AS $$
DECLARE col text := _assert_dim(dim);
BEGIN
    RETURN QUERY EXECUTE format($q$
        WITH per_deal AS (
            SELECT DISTINCT ON (v, deal_id) v, deal_id, amount
            FROM (
                SELECT NULLIF(btrim(%1$I::text), '') AS v, deal_id, amount
                FROM _filter_insights_norm($1) t
                WHERE ($2 IS NULL OR t.insight_type = $2)
                  AND (NOT $3 OR t.is_own_brand = false)
            ) s
            WHERE v IS NOT NULL AND deal_id IS NOT NULL AND amount IS NOT NULL
            ORDER BY v, deal_id, amount DESC
        )
        SELECT v AS name, COALESCE(SUM(amount), 0)::numeric AS value
        FROM per_deal GROUP BY v ORDER BY value DESC, name ASC LIMIT $4
    $q$, col) USING f, scope, exclude_own_brand, n;
END;
$$;
"""

# rpc_sample_stats también debería respetar min_confidence + usar la norm view
# para consistencia (mismos counts). La re-creamos sobre _filter_insights_norm.
SQL_SAMPLE_STATS_V2 = """
CREATE OR REPLACE FUNCTION rpc_sample_stats(f jsonb)
RETURNS TABLE(
    unique_calls bigint, unique_deals bigint, insights_count bigint,
    period_start date, period_end date,
    avg_confidence numeric, high_confidence_pct numeric
)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (SELECT * FROM _filter_insights_norm(f))
    SELECT
        COUNT(DISTINCT transcript_id)::bigint,
        COUNT(DISTINCT deal_id) FILTER (WHERE deal_id IS NOT NULL)::bigint,
        COUNT(*)::bigint,
        MIN(call_date), MAX(call_date),
        ROUND(AVG(confidence) FILTER (WHERE confidence IS NOT NULL)::numeric, 4),
        CASE WHEN COUNT(*) FILTER (WHERE confidence IS NOT NULL) = 0 THEN NULL
             ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE confidence >= 0.7)
                  / NULLIF(COUNT(*) FILTER (WHERE confidence IS NOT NULL), 0), 1) END
    FROM filtered;
$$;
"""


SQL_GRANTS = """
GRANT EXECUTE ON FUNCTION _normkey(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION _norm_region(text, text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION _norm_competitor(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION _is_own_brand(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION _filter_insights_norm(jsonb) TO service_role, authenticated;
"""


STEPS = [
    ("_normkey", SQL_NORMKEY),
    ("_norm_region", SQL_NORM_REGION),
    ("_norm_competitor", SQL_NORM_COMPETITOR),
    ("_is_own_brand", SQL_IS_OWN_BRAND),
    ("_filter_insights_norm", SQL_FILTER_NORM),
    ("rpc_group_distinct v2", SQL_GROUP_DISTINCT_V2),
    ("rpc_group_with_pct v2", SQL_GROUP_WITH_PCT_V2),
    ("rpc_revenue_by v2", SQL_REVENUE_BY_V2),
    ("rpc_sample_stats v2", SQL_SAMPLE_STATS_V2),
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
        print("\n✓ Normalization layer + RPCs v2 created/updated.")

        f = '{"prompt_version":"v3.0"}'
        cur.execute(
            f"SELECT name, value FROM rpc_group_distinct('{f}'::jsonb, 'region', NULL, false, 10);"
        )
        print("\nSanity — rpc_group_distinct(region NORMALIZADO, top 10):")
        for name, value in cur.fetchall():
            print(f"  {name}: {value}")

        cur.execute(
            f"SELECT name, value FROM rpc_group_distinct('{f}'::jsonb, 'competitor_name', 'competitive_signal', true, 10);"
        )
        print("\nSanity — rpc_group_distinct(competitor NORMALIZADO, excl. own-brand, top 10):")
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
