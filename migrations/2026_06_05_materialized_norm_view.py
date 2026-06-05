"""
Migration: materialized view normalizada (Phase 2 — Step 3d / perf fix).

PROBLEMA: _filter_insights_norm corría _norm_region/_norm_competitor (plpgsql,
por fila) sobre v_insights_dashboard (162K filas + joins pesados) en CADA
query. El Overview dispara ~11 RPCs en paralelo → 11 full scans con
normalización por fila → statement timeout en Supabase.

FIX: materializamos la vista YA normalizada en `mv_insights_norm`, con
índices. La normalización corre UNA vez (en el refresh), no por query.
_filter_insights_norm pasa a leer de la MV (columnas planas, sin funciones
por fila) → cada RPC vuela.

Refresh: correr refresh_insights_mv() después de cada ingest (la data solo
cambia ahí). Idempotente. La MV se puebla al crearse.

Rollback:
    DROP MATERIALIZED VIEW mv_insights_norm CASCADE;

Usage:
    python migrations/2026_06_05_materialized_norm_view.py --dry-run
    python migrations/2026_06_05_materialized_norm_view.py
"""
from __future__ import annotations

import importlib.util
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_f21c():
    """Carga el módulo de F2.1c (nombre empieza con dígito → no se puede
    importar normal) para reusar las definiciones EXACTAS de _normkey y
    _norm_region (evita transcribir mal el CASE gigante)."""
    path = os.path.join(os.path.dirname(__file__), "2026_06_03b_sql_normalization.py")
    spec = importlib.util.spec_from_file_location("_f21c", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_F21C = _load_f21c()
SQL_NORMKEY = _F21C.SQL_NORMKEY
SQL_NORM_REGION = _F21C.SQL_NORM_REGION


# Re-creamos las funciones de normalización con llamadas a _normkey
# SCHEMA-CALIFICADAS (public._normkey) + SET search_path. Motivo: _is_own_brand
# es LANGUAGE sql → Postgres la inlinea al crear la MV y resuelve _normkey
# SIN el search_path de sesión → fallaba con "function _normkey does not exist".
# Calificar elimina la dependencia del search_path en cualquier contexto
# (creación de MV, refresh desde cron, etc.). Idempotente (CREATE OR REPLACE).
SQL_FIX_FUNCS = """
CREATE OR REPLACE FUNCTION _is_own_brand(v text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT public._normkey(v) IN ('humand','human','human d');
$$;

CREATE OR REPLACE FUNCTION _norm_competitor(v text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE k text := public._normkey(v);
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
        ELSE v
    END;
END;
$$;
"""

# La MV materializa v_insights_dashboard con region/competitor normalizados.
# Incluye `id` (PK del insight) para poder refrescar CONCURRENTLY.
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
    public._is_own_brand(v.competitor_name) AS is_own_brand
FROM v_insights_dashboard v;
"""

SQL_INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS mv_insights_norm_id_uidx ON mv_insights_norm (id);
CREATE INDEX IF NOT EXISTS mv_insights_norm_pv_type_idx ON mv_insights_norm (prompt_version, insight_type);
CREATE INDEX IF NOT EXISTS mv_insights_norm_date_idx ON mv_insights_norm (call_date);
CREATE INDEX IF NOT EXISTS mv_insights_norm_pv_date_idx ON mv_insights_norm (prompt_version, call_date);
CREATE INDEX IF NOT EXISTS mv_insights_norm_region_idx ON mv_insights_norm (region);
"""

# _filter_insights_norm ahora lee de la MV (columnas ya normalizadas, sin
# funciones por fila). Misma firma/columnas que antes → las RPCs no cambian.
SQL_FILTER_NORM_MV = """
CREATE OR REPLACE FUNCTION _filter_insights_norm(f jsonb)
RETURNS TABLE(
    transcript_id text, deal_id text, amount numeric, call_date date,
    confidence numeric, insight_type text, insight_type_display text,
    insight_subtype_display text, region text, country text, segment text,
    industry text, deal_owner text, module_display text, module_status text,
    hr_category_display text, pain_theme text, feature_display text,
    deal_stage text, competitor_name text, competitor_relationship_display text,
    is_own_brand boolean
)
LANGUAGE sql STABLE
AS $$
    SELECT
        m.transcript_id, m.deal_id, m.amount, m.call_date, m.confidence,
        m.insight_type, m.insight_type_display, m.insight_subtype_display,
        m.region, m.country, m.segment, m.industry, m.deal_owner,
        m.module_display, m.module_status, m.hr_category_display, m.pain_theme,
        m.feature_display, m.deal_stage, m.competitor_name,
        m.competitor_relationship_display, m.is_own_brand
    FROM mv_insights_norm m
    WHERE m.prompt_version = COALESCE(f->>'prompt_version', 'v3.0')
      AND (
        jsonb_array_length(COALESCE(f->'types', '[]'::jsonb)) = 0
        OR m.insight_type_display = ANY(SELECT jsonb_array_elements_text(f->'types'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'regions', '[]'::jsonb)) = 0
        OR m.region = ANY(SELECT jsonb_array_elements_text(f->'regions'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'segments', '[]'::jsonb)) = 0
        OR m.segment = ANY(SELECT jsonb_array_elements_text(f->'segments'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'countries', '[]'::jsonb)) = 0
        OR m.country = ANY(SELECT jsonb_array_elements_text(f->'countries'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'industries', '[]'::jsonb)) = 0
        OR m.industry = ANY(SELECT jsonb_array_elements_text(f->'industries'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'owners', '[]'::jsonb)) = 0
        OR m.deal_owner = ANY(SELECT jsonb_array_elements_text(f->'owners'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'modules', '[]'::jsonb)) = 0
        OR m.module_display = ANY(SELECT jsonb_array_elements_text(f->'modules'))
      )
      AND (
        jsonb_array_length(COALESCE(f->'categories', '[]'::jsonb)) = 0
        OR m.hr_category_display = ANY(SELECT jsonb_array_elements_text(f->'categories'))
      )
      AND (f->>'date_start' IS NULL OR m.call_date IS NULL OR m.call_date >= (f->>'date_start')::date)
      AND (f->>'date_end' IS NULL OR m.call_date IS NULL OR m.call_date <= (f->>'date_end')::date)
      AND (f->>'min_confidence' IS NULL OR m.confidence IS NULL OR m.confidence >= (f->>'min_confidence')::numeric);
$$;
"""

# Función de refresh para llamar post-ingest. CONCURRENTLY no bloquea lecturas
# (requiere el unique index en id).
SQL_REFRESH_FN = """
CREATE OR REPLACE FUNCTION refresh_insights_mv()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_insights_norm;
END;
$$;
"""

SQL_GRANTS = """
GRANT SELECT ON mv_insights_norm TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION refresh_insights_mv() TO service_role;
"""


STEPS = [
    # search_path: la sesión de migración puede no incluir 'public', y al crear
    # la MV Postgres inlinea _is_own_brand → necesita resolver _normkey. Sin
    # esto falla con "function _normkey does not exist".
    # statement_timeout: la materialización inicial (162K filas + normalización
    # por fila) corre una única vez acá y puede pasar el límite default.
    ("set search_path + statement_timeout for this session",
     "SET search_path TO public; SET statement_timeout = '600s';"),
    # Self-contained: re-creamos _normkey y _norm_region en public (en F2.1c
    # pudieron quedar en otro schema → de ahí "function _normkey does not exist").
    ("recreate _normkey (public)", SQL_NORMKEY),
    ("recreate _norm_region (public)", SQL_NORM_REGION),
    ("recreate _is_own_brand / _norm_competitor (schema-qualified)", SQL_FIX_FUNCS),
    ("create materialized view mv_insights_norm", SQL_CREATE_MV),
    ("indexes", SQL_INDEXES),
    ("_filter_insights_norm → MV", SQL_FILTER_NORM_MV),
    ("refresh_insights_mv()", SQL_REFRESH_FN),
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
        print("\n✓ Materialized view + indexes + _filter_insights_norm(MV) listos.")

        cur.execute("SELECT COUNT(*) FROM mv_insights_norm;")
        print(f"\nFilas en mv_insights_norm: {cur.fetchone()[0]}")

        f = '{"prompt_version":"v3.0"}'
        import time
        t0 = time.time()
        cur.execute(
            f"SELECT name, value FROM rpc_group_distinct('{f}'::jsonb, 'region', NULL, false, 8);"
        )
        rows = cur.fetchall()
        dt = (time.time() - t0) * 1000
        print(f"\nrpc_group_distinct(region) en {dt:.0f}ms:")
        for name, value in rows:
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
