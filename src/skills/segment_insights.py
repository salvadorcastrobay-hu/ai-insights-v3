"""
Skill: Insights del segmento.

Funciones puras que consultan v_insights_dashboard para agregar insights
estructurados de un segmento de mercado. Sin estado, sin Streamlit.
"""
from __future__ import annotations

import os
import re
import sys
import time
from dataclasses import dataclass, field
from urllib.parse import quote_plus

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from src.skills.competitor_normalization import (
    is_own_brand_competitor,
    normalize_competitor_name,
)
from src.skills.market_filters import build_region_filter_clause


load_dotenv()


# ---------------------------------------------------------------------------
# Conexión DB (privada, mismo patrón que pipeline_stats.py)
# ---------------------------------------------------------------------------

def _get_secret_optional(key: str) -> str | None:
    val = os.environ.get(key)
    if val:
        return val
    try:
        import streamlit as st
        return st.secrets[key]
    except Exception:
        return None


def _build_db_url() -> str | None:
    supabase_url = (_get_secret_optional("SUPABASE_URL") or "").strip()
    db_password = (_get_secret_optional("SUPABASE_DB_PASSWORD") or "").strip()
    if not supabase_url or not db_password:
        return None
    match = re.search(r"https://([^.]+)\.supabase\.co", supabase_url)
    if not match:
        return None
    project_ref = match.group(1)
    host = (_get_secret_optional("SUPABASE_DB_HOST") or "aws-0-us-west-2.pooler.supabase.com").strip()
    port = (_get_secret_optional("SUPABASE_DB_PORT") or "6543").strip()
    db_name = (_get_secret_optional("SUPABASE_DB_NAME") or "postgres").strip()
    user = (_get_secret_optional("SUPABASE_DB_USER") or f"postgres.{project_ref}").strip()
    return f"postgresql://{quote_plus(user)}:{quote_plus(db_password)}@{host}:{port}/{db_name}"


def _get_db_connection():
    database_url = _get_secret_optional("DATABASE_URL") or _build_db_url()
    if not database_url:
        raise RuntimeError("Falta configurar DATABASE_URL o SUPABASE_URL + SUPABASE_DB_PASSWORD.")
    database_url = re.sub(r"[?&]sslmode=[^&]*", "", database_url)
    sep = "&" if "?" in database_url else "?"
    database_url = f"{database_url}{sep}sslmode=require"
    last_err = None
    for attempt in range(3):
        try:
            conn = psycopg2.connect(database_url)
            conn.set_session(readonly=True, autocommit=True)
            return conn
        except psycopg2.OperationalError as e:
            last_err = e
            if attempt < 2:
                time.sleep(1)
    raise last_err


# ---------------------------------------------------------------------------
# Modelos de datos
# ---------------------------------------------------------------------------

@dataclass
class SegmentInsights:
    """Insights estructurados para un segmento de mercado dado."""
    top_pains: list[dict] = field(default_factory=list)
    top_faqs: list[dict] = field(default_factory=list)
    top_modules: list[dict] = field(default_factory=list)
    competitors: list[dict] = field(default_factory=list)
    top_gaps: list[dict] = field(default_factory=list)
    competitor_ads: list[dict] = field(default_factory=list)
    sample_size: int = 0
    insight_volume: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers privados
# ---------------------------------------------------------------------------

def _build_insight_where(filters: dict) -> tuple[str, list]:
    """
    Construye WHERE clause parameterizado para v_insights_dashboard.
    Retorna (clause_str, params_list).
    """
    column_map = {
        "industry":   "industry",
        "country":    "country",
        "segment":    "segment",
        "deal_stage": "deal_stage",
    }
    parts = []
    params = []
    for key, col in column_map.items():
        val = filters.get(key)
        if val:
            if isinstance(val, list):
                clauses = [f"{col} ILIKE %s" for _ in val]
                parts.append(f"({' OR '.join(clauses)})")
                params.extend([f"%{item}%" for item in val])
            else:
                parts.append(f"{col} ILIKE %s")
                params.append(f"%{val}%")
    region_clause, region_params = build_region_filter_clause("region", filters.get("region"))
    if region_clause:
        parts.append(region_clause)
        params.extend(region_params)
    start_date = filters.get("start_date")
    if start_date:
        parts.append("call_date >= %s")
        params.append(start_date)
    end_date = filters.get("end_date")
    if end_date:
        parts.append("call_date <= %s")
        params.append(end_date)
    clause = " AND ".join(parts) if parts else "1=1"
    return clause, params


def _get_top_pains(cur, where: str, params: list, n: int) -> list[dict]:
    """Retorna los N principales pain points del segmento con quote de ejemplo."""
    # Step 1: aggregation
    sql_agg = f"""
        SELECT COALESCE(insight_subtype_display, insight_subtype) AS subtype_display,
               pain_theme,
               COUNT(*) AS count,
               COUNT(DISTINCT deal_id) AS deal_count
        FROM v_insights_dashboard
        WHERE insight_type = 'pain' AND {where}
        GROUP BY subtype_display, pain_theme
        ORDER BY count DESC
        LIMIT %s
    """
    cur.execute(sql_agg, params + [n])
    rows = [dict(r) for r in cur.fetchall()]
    if not rows:
        return []

    # Step 2: one example quote per subtype (separate query, merged in Python)
    subtypes = [r["subtype_display"] for r in rows]
    placeholders = ",".join(["%s"] * len(subtypes))
    sql_quotes = f"""
        SELECT COALESCE(insight_subtype_display, insight_subtype) AS subtype_display,
               verbatim_quote
        FROM v_insights_dashboard
        WHERE insight_type = 'pain'
          AND COALESCE(insight_subtype_display, insight_subtype) IN ({placeholders})
          AND verbatim_quote IS NOT NULL
          AND {where}
        ORDER BY call_date DESC
        LIMIT 200
    """
    cur.execute(sql_quotes, subtypes + params)
    quote_map: dict[str, str] = {}
    for qr in cur.fetchall():
        key = qr["subtype_display"]
        if key not in quote_map:
            quote_map[key] = qr["verbatim_quote"]

    for row in rows:
        row["example_quote"] = quote_map.get(row["subtype_display"], "")
    return rows


def _get_top_faqs(cur, where: str, params: list, n: int) -> list[dict]:
    """Retorna las N preguntas frecuentes más repetidas del segmento."""
    sql = f"""
        SELECT COALESCE(insight_subtype_display, faq_topic, insight_subtype) AS subtype_display,
               COUNT(*) AS count
        FROM v_insights_dashboard
        WHERE insight_type = 'faq' AND {where}
        GROUP BY subtype_display
        ORDER BY count DESC
        LIMIT %s
    """
    cur.execute(sql, params + [n])
    return [dict(r) for r in cur.fetchall()]


def _get_top_modules(cur, where: str, params: list, n: int) -> list[dict]:
    """Retorna los N módulos más solicitados (vía product_gap) del segmento."""
    sql = f"""
        SELECT COALESCE(module_display, module) AS module_display,
               COALESCE(hr_category_display, '') AS hr_category,
               COUNT(*) AS count,
               SUM(CASE WHEN gap_priority = 'dealbreaker' THEN 1 ELSE 0 END) AS dealbreaker_count
        FROM v_insights_dashboard
        WHERE insight_type = 'product_gap'
          AND module IS NOT NULL
          AND {where}
        GROUP BY COALESCE(module_display, module), COALESCE(hr_category_display, '')
        ORDER BY count DESC
        LIMIT %s
    """
    cur.execute(sql, params + [n])
    return [dict(r) for r in cur.fetchall()]


def _get_competitors(cur, where: str, params: list) -> list[dict]:
    """Retorna todos los competidores mencionados en el segmento, ordenados por frecuencia."""
    sql = f"""
        SELECT MIN(TRIM(competitor_name)) AS competitor_name,
               COALESCE(competitor_relationship_display, competitor_relationship, 'Mencionado') AS relationship_display,
               COUNT(*) AS count
        FROM v_insights_dashboard
        WHERE insight_type = 'competitive_signal'
          AND competitor_name IS NOT NULL
          AND {where}
        GROUP BY LOWER(TRIM(competitor_name)),
                 COALESCE(competitor_relationship_display, competitor_relationship, 'Mencionado')
        ORDER BY count DESC
        LIMIT 200
    """
    cur.execute(sql, params)

    aggregated: dict[str, dict] = {}
    for row in cur.fetchall():
        raw_name = row.get("competitor_name")
        canonical_name = normalize_competitor_name(raw_name)
        if not canonical_name or is_own_brand_competitor(canonical_name):
            continue

        bucket = aggregated.setdefault(
            canonical_name,
            {
                "competitor_name": canonical_name,
                "relationship_display": set(),
                "count": 0,
            },
        )
        relationship = row.get("relationship_display")
        if relationship:
            bucket["relationship_display"].add(relationship)
        bucket["count"] += int(row.get("count") or 0)

    normalized_rows = []
    for competitor_name, data in aggregated.items():
        normalized_rows.append(
            {
                "competitor_name": competitor_name,
                "relationship_display": ", ".join(sorted(data["relationship_display"])),
                "count": data["count"],
            }
        )

    normalized_rows.sort(key=lambda item: (-item["count"], item["competitor_name"]))
    return normalized_rows[:20]


def _get_top_gaps(cur, where: str, params: list, n: int) -> list[dict]:
    """Retorna los N feature gaps más frecuentes, priorizando dealbreakers."""
    sql = f"""
        SELECT COALESCE(feature_display, feature_name, 'Sin nombre') AS feature_display,
               COUNT(*) AS count,
               SUM(CASE WHEN COALESCE(gap_priority, 'nice_to_have') = 'dealbreaker' THEN 1 ELSE 0 END) AS dealbreaker_count,
               SUM(CASE WHEN COALESCE(gap_priority, 'nice_to_have') = 'must_have' THEN 1 ELSE 0 END) AS must_have_count,
               MAX(gap_description) AS example_description
        FROM v_insights_dashboard
        WHERE insight_type = 'product_gap'
          AND {where}
        GROUP BY COALESCE(feature_display, feature_name, 'Sin nombre')
        ORDER BY
          CASE
            WHEN SUM(CASE WHEN COALESCE(gap_priority, 'nice_to_have') = 'dealbreaker' THEN 1 ELSE 0 END) > 0 THEN 1
            WHEN SUM(CASE WHEN COALESCE(gap_priority, 'nice_to_have') = 'must_have' THEN 1 ELSE 0 END) > 0 THEN 2
            ELSE 3
          END,
          count DESC
        LIMIT %s
    """
    cur.execute(sql, params + [n])
    rows = [dict(r) for r in cur.fetchall()]
    for row in rows:
        if int(row.get("dealbreaker_count", 0) or 0) > 0:
            row["priority"] = "dealbreaker"
        elif int(row.get("must_have_count", 0) or 0) > 0:
            row["priority"] = "must_have"
        else:
            row["priority"] = "nice_to_have"
    return rows


def _get_sample_size(cur, where: str, params: list) -> int:
    """Cuenta la cantidad de transcripts únicos en el segmento."""
    cur.execute(
        f"SELECT COUNT(DISTINCT transcript_id) AS n FROM v_insights_dashboard WHERE {where}",
        params,
    )
    row = cur.fetchone()
    return int(row["n"] or 0)


def _get_insight_volume(cur, where: str, params: list) -> dict:
    """Retorna el volumen de insights por tipo para el segmento."""
    cur.execute(
        f"SELECT insight_type, COUNT(*) AS n FROM v_insights_dashboard WHERE {where} GROUP BY insight_type",
        params,
    )
    return {r["insight_type"]: int(r["n"]) for r in cur.fetchall()}


def _get_competitor_ads(cur, segment_pain_labels: list[str], n: int = 5) -> list[dict]:
    """
    Retorna ads de competidores cuyos ángulos atacan los mismos pains del segmento.

    Para cada competidor devuelve:
      - competitor, source, ads_analyzed
      - angles: lista de ángulos que intersectan con segment_pain_labels
        (label, description, weight, related_pains, example_copies)
    Ordenado por suma de weight de los ángulos matching, limitado a n competidores.
    """
    if not segment_pain_labels:
        return []

    # Normalizar a minúsculas para matching case-insensitive.
    pain_set = [p.lower() for p in segment_pain_labels]

    sql = """
        SELECT
            cai.competitor,
            cai.source,
            (cai.payload->>'ads_analyzed')::int AS ads_analyzed,
            jsonb_agg(
                jsonb_build_object(
                    'label',         angle->>'label',
                    'description',   angle->>'description',
                    'weight',        (angle->>'weight')::float,
                    'related_pains', angle->'related_pains',
                    'example_copies', angle->'example_copies'
                )
                ORDER BY (angle->>'weight')::float DESC
            ) AS angles,
            SUM((angle->>'weight')::float) AS total_weight
        FROM competitor_ad_insights cai,
             jsonb_array_elements(cai.payload->'angles') AS angle
        WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(angle->'related_pains') AS rp
            WHERE LOWER(rp) = ANY(%s)
        )
        GROUP BY cai.competitor, cai.source, cai.payload->>'ads_analyzed'
        ORDER BY total_weight DESC
        LIMIT %s
    """
    cur.execute(sql, [pain_set, n])
    rows = []
    for r in cur.fetchall():
        angles = r.get("angles") or []
        if isinstance(angles, str):
            import json
            angles = json.loads(angles)
        rows.append({
            "competitor": r["competitor"],
            "source": r["source"],
            "ads_analyzed": r["ads_analyzed"] or 0,
            "angles": angles,
        })
    return rows


# ---------------------------------------------------------------------------
# Función pública
# ---------------------------------------------------------------------------

def get_segment_insights(
    filters: dict,
    n_pains: int = 7,
    n_faqs: int = 5,
    n_modules: int = 8,
    n_gaps: int = 5,
) -> SegmentInsights:
    """
    Consulta v_insights_dashboard y retorna insights estructurados del segmento.

    Args:
        filters:   dict con claves opcionales:
                   industry, country, region, segment, deal_stage, start_date, end_date.
        n_pains:   Cantidad de pain points a retornar.
        n_faqs:    Cantidad de FAQs a retornar.
        n_modules: Cantidad de módulos a retornar.
        n_gaps:    Cantidad de feature gaps a retornar.

    Returns:
        SegmentInsights con todos los datos agregados del segmento.
    """
    where, params = _build_insight_where(filters)

    conn = None
    try:
        conn = _get_db_connection()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET statement_timeout = '15s'")

            def safe(label: str, fn, default):
                try:
                    return fn()
                except Exception as e:
                    print(f"[segment_insights] Error en {label}: {e}", file=sys.stderr)
                    return default

            sample_size = safe("sample_size", lambda: _get_sample_size(cur, where, params), 0)
            insight_volume = safe("insight_volume", lambda: _get_insight_volume(cur, where, params), {})
            top_pains = safe("top_pains", lambda: _get_top_pains(cur, where, params, n_pains), [])
            top_faqs = safe("top_faqs", lambda: _get_top_faqs(cur, where, params, n_faqs), [])
            top_modules = safe("top_modules", lambda: _get_top_modules(cur, where, params, n_modules), [])
            competitors = safe("competitors", lambda: _get_competitors(cur, where, params), [])
            top_gaps = safe("top_gaps", lambda: _get_top_gaps(cur, where, params, n_gaps), [])
            pain_labels = [p.get("subtype_display", "") for p in top_pains if p.get("subtype_display")]
            competitor_ads = safe("competitor_ads", lambda: _get_competitor_ads(cur, pain_labels), [])

        return SegmentInsights(
            top_pains=top_pains,
            top_faqs=top_faqs,
            top_modules=top_modules,
            competitors=competitors,
            top_gaps=top_gaps,
            competitor_ads=competitor_ads,
            sample_size=sample_size,
            insight_volume=insight_volume,
        )

    except Exception as e:
        print(f"[segment_insights] Error al consultar insights: {e}", file=sys.stderr)
        return SegmentInsights()

    finally:
        if conn:
            conn.close()
