"""
Skill: Estadísticas de pipeline.

Funciones puras que consultan raw_deals para describir la composición
del pipeline de ventas por segmento. Sin estado, sin Streamlit.
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

from src.skills.market_filters import build_region_filter_clause


load_dotenv()


# ---------------------------------------------------------------------------
# Conexión DB (privada, patrón extraído de sql_chat_agent.py)
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
class PipelineBreakdown:
    """Composición del pipeline para un segmento dado."""
    total_deals: int = 0
    total_revenue: float = 0.0
    by_industry: list[dict] = field(default_factory=list)
    by_country: list[dict] = field(default_factory=list)
    by_segment: list[dict] = field(default_factory=list)
    by_stage: list[dict] = field(default_factory=list)
    filter_description: str = "Todos los segmentos"


# ---------------------------------------------------------------------------
# Helpers privados
# ---------------------------------------------------------------------------

def _build_where_clause(filters: dict) -> tuple[str, list]:
    """
    Construye un WHERE clause parameterizado a partir del dict de filtros.
    Retorna (clause_str, params_list).
    Valores None o vacíos se ignoran.
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
        parts.append("create_date >= %s")
        params.append(start_date)
    end_date = filters.get("end_date")
    if end_date:
        parts.append("create_date <= %s")
        params.append(end_date)
    clause = " AND ".join(parts) if parts else "1=1"
    return clause, params


def _build_filter_description(filters: dict) -> str:
    """Genera una descripción legible de los filtros aplicados."""
    label_map = {
        "industry":   "Industria",
        "country":    "País",
        "region":     "Región",
        "segment":    "Segmento",
        "deal_stage": "Etapa",
        "start_date": "Desde",
        "end_date":   "Hasta",
    }
    parts = []
    for key, label in label_map.items():
        val = filters.get(key)
        if val:
            if isinstance(val, list):
                parts.append(f"{label}: {', '.join(str(item) for item in val)}")
            else:
                parts.append(f"{label}: {val}")
    return " | ".join(parts) if parts else "Todos los segmentos"


def _run_breakdown(cur, base_where: str, params: list, col: str, label: str, top_n: int) -> list[dict]:
    """Ejecuta un GROUP BY para una dimensión dada y retorna los top N."""
    sql = f"""
        SELECT COALESCE({col}, 'Sin dato') AS label,
               COUNT(DISTINCT deal_id)    AS deals,
               COALESCE(SUM(amount), 0)  AS revenue
        FROM raw_deals
        WHERE {base_where}
        GROUP BY {col}
        ORDER BY deals DESC
        LIMIT %s
    """
    cur.execute(sql, params + [top_n])
    return [{label: r["label"], "deals": r["deals"], "revenue": float(r["revenue"])} for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Función pública
# ---------------------------------------------------------------------------

def get_pipeline_breakdown(filters: dict, top_n: int = 5) -> PipelineBreakdown:
    """
    Consulta raw_deals y retorna la composición del pipeline para el segmento dado.

    Args:
        filters: dict con claves opcionales:
                 industry, country, region, segment, deal_stage, start_date, end_date.
                 Valores None o '' se ignoran (sin filtro).
        top_n:   Cuántos items retornar en cada breakdown.

    Returns:
        PipelineBreakdown con totales y breakdowns por dimensión.
    """
    where, params = _build_where_clause(filters)
    description = _build_filter_description(filters)

    conn = None
    try:
        conn = _get_db_connection()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Set query timeout
            cur.execute("SET statement_timeout = '15s'")

            # Total stats
            cur.execute(
                f"SELECT COUNT(DISTINCT deal_id) AS total_deals, "
                f"COALESCE(SUM(amount), 0) AS total_revenue "
                f"FROM raw_deals WHERE {where}",
                params,
            )
            row = cur.fetchone()
            total_deals = int(row["total_deals"] or 0)
            total_revenue = float(row["total_revenue"] or 0)

            # Breakdowns
            by_industry = _run_breakdown(cur, where, params, "industry", "industry", top_n)
            by_country  = _run_breakdown(cur, where, params, "country",  "country",  top_n)
            by_segment  = _run_breakdown(cur, where, params, "segment",  "segment",  top_n)
            by_stage    = _run_breakdown(cur, where, params, "deal_stage", "stage",  20)

        return PipelineBreakdown(
            total_deals=total_deals,
            total_revenue=total_revenue,
            by_industry=by_industry,
            by_country=by_country,
            by_segment=by_segment,
            by_stage=by_stage,
            filter_description=description,
        )

    except Exception as e:
        print(f"[pipeline_stats] Error al consultar el pipeline: {e}", file=sys.stderr)
        return PipelineBreakdown(filter_description=description)

    finally:
        if conn:
            conn.close()
