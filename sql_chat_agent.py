"""
Chat SQL Agent con IA — Preguntas en lenguaje natural sobre datos de insights.

Flujo:
1. Usuario escribe pregunta en español
2. GPT-4o decide el modo: CHAT, SQL, HYBRID, o SEARCH
3. SQL: ejecuta query cuantitativa → resume resultados
4. HYBRID: 2 queries (cuanti + cuali de insights) → sintetiza
5. SEARCH: busqueda semantica en transcripciones (pgvector) + SQL opcional → sintetiza
6. Se muestra: respuesta + SQL/datos colapsables
"""

from __future__ import annotations

import os
import re
from urllib.parse import quote_plus

import pandas as pd
import plotly.express as px
import psycopg2
import psycopg2.extras
import streamlit as st
from openai import OpenAI

try:
    from insights_copilot import ask_insights
except Exception:  # pragma: no cover - optional fallback
    ask_insights = None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SEARCH_RESULTS_LIMIT = 15
_DATA_QUESTION_PATTERN = re.compile(
    r"\b("
    r"top|pain|pains|gap|gaps|faq|competidor|competidor(es)?|competitor|competitors|"
    r"deal|deals|revenue|arr|pipeline|region|emea|latam|apac|q[1-4]|insight|insights|"
    r"cuantos|cuántos|ranking|amount|factura|facturacion|facturación|segment"
    r")\b",
    re.IGNORECASE,
)
_KNOWLEDGE_LIMIT_PATTERN = re.compile(
    r"(entrenamiento|training|knowledge cutoff|cutoff|hasta (octubre|.*20\d{2})|"
    r"no puedo proporcionar datos|no tengo acceso)",
    re.IGNORECASE,
)
_DB_CONNECTION_ERROR_PATTERN = re.compile(
    r"(password authentication failed|connection to server|could not connect|"
    r"Falta configurar la conexion PostgreSQL|Missing secret: DATABASE_URL)",
    re.IGNORECASE,
)
_CHART_REQUEST_PATTERN = re.compile(
    r"\b("
    r"top|ranking|rank|tendencia|trend|evolucion|evolución|historico|histórico|"
    r"distribucion|distribución|compare|comparar|comparacion|comparación|"
    r"proporcion|proporción|share|mix|porcentaje|vs|versus|correlacion|correlación"
    r")\b",
    re.IGNORECASE,
)
_TIME_HINT_PATTERN = re.compile(r"(date|fecha|month|mes|week|semana|year|anio|año)", re.IGNORECASE)
_METRIC_HINT_PATTERN = re.compile(
    r"(count|frecuencia|cantidad|total|menciones|deals?|revenue|arr|amount|monto|valor|score|confidence)",
    re.IGNORECASE,
)
_DIMENSION_HINT_PATTERN = re.compile(
    r"(pain|tipo|subtype|region|country|segment|owner|competitor|module|feature|stage|categoria|category)",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
Eres un asistente de datos para el equipo de liderazgo de Humand. Tu trabajo es \
ayudar al usuario respondiendo preguntas de negocio con datos reales o manteniendo \
una conversacion amigable y profesional.

## Modos de respuesta

Debes responder en exactamente uno de estos cuatro formatos:

**Modo SQL** — pregunta puramente cuantitativa (conteos, rankings, totales, revenue):
SQL:
SELECT ...

**Modo HYBRID** — datos cuantitativos + contexto cualitativo de insights ya extraidos:
HYBRID:
---CUANTITATIVO---
SELECT ... (agregaciones)
---CUALITATIVO---
SELECT ... (summary, verbatim_quote, LIMIT 25)

**Modo SEARCH** — busqueda semantica en los resumenes de llamadas de ventas (Fathom summaries). \
Ideal para preguntas sobre lo que se dijo en las llamadas, opiniones detalladas, \
temas que no estan en los insights estructurados, o cuando se necesita contexto \
de conversaciones especificas:
SEARCH:
---FILTROS---
(condiciones SQL opcionales para filtrar por metadata: segment, region, country, \
company_name, deal_name, deal_owner, deal_stage, industry, call_date, amount, source_type)
---BUSQUEDA---
(descripcion en lenguaje natural de lo que buscar en las transcripciones)
---SQL---
(query SQL opcional contra v_insights_dashboard para datos cuantitativos complementarios)

**Modo CHAT** — saludo, aclaracion, pregunta general:
CHAT:
Tu respuesta conversacional aqui.

## Cuando usar cada modo

**SQL**: Solo numeros — "cuantos", "top 10", "total revenue", "ranking", "lista de deals", \
"cuanto factura", "pipeline por etapa". Siempre que la respuesta sean datos tabulares puros.

**HYBRID**: Numeros + contexto de insights — "que opinan", "por que", "ejemplos", \
"cuales son los principales pains y que dicen". Usa este modo cuando la respuesta combina \
conteos/rankings con los campos summary/verbatim_quote de los insights YA EXTRAIDOS en \
v_insights_dashboard. Ideal para preguntas como "cuales son los top 5 product gaps y \
que dicen los prospectos al respecto".

**SEARCH**: Busqueda profunda en transcripciones — usa este modo cuando:
- Se pregunta por lo que se DIJO en las llamadas: "que dijo Coca-Cola sobre..."
- Se busca un tema no capturado en insights: "alguien menciono SAP?"
- Se piden opiniones detalladas o contexto conversacional
- Se pregunta "de que se hablo" en una llamada especifica
- Se pide analisis de sentimiento o percepciones no estructuradas
- Se mezcla segmentacion CRM + texto libre: "que dicen los Enterprise sobre su herramienta actual?"
- EN CASO DE DUDA entre HYBRID y SEARCH, prefiere SEARCH — tiene acceso al texto completo \
de las conversaciones, que es mas rico que los insights resumidos.

**CHAT**: Saludos, preguntas sobre la herramienta, aclaraciones, preguntas generales \
que no requieren datos.

## Schema de la base de datos

### Vista principal: v_insights_dashboard
Columnas principales:
- id (UUID), transcript_id, deal_id, deal_name, company_name
- region, country, segment, industry, company_size
- deal_stage, deal_owner, amount (numeric — revenue del deal en USD)
- call_date (date)
- insight_type: 'pain' | 'product_gap' | 'competitive_signal' | 'deal_friction' | 'faq'
- insight_subtype (codigo taxonomico), insight_subtype_display (nombre legible)
- module (codigo), module_display (nombre legible), module_status ('existing'|'missing')
- hr_category, hr_category_display
- pain_theme, pain_scope ('general'|'module_linked')
- competitor_name, competitor_relationship
- competitor_relationship_display
- feature_name (codigo), feature_display (nombre legible), feature_is_seed (boolean)
- gap_description, gap_priority ('must_have'|'nice_to_have'|'dealbreaker')
- **summary** (TEXT — resumen normalizado del insight en 1-2 oraciones)
- **verbatim_quote** (TEXT — cita textual exacta de la transcripcion)
- confidence (0-1)

### Tabla: raw_transcripts (para modo SEARCH — busqueda por palabras clave)
Columnas disponibles para filtros:
- title (contiene nombre de la empresa y reunion)
- call_date (fecha de la llamada)
- team (equipo que hizo la llamada)
(La columna fathom_summary se busca automaticamente con las palabras clave)

### Tabla: raw_transcripts
- recording_id (TEXT PK), fathom_summary, transcript_text, title, call_date, team

### Tabla: raw_deals
- deal_id, deal_name, deal_stage, pipeline, amount
- create_date, close_date, owner_name, ae_owner_name
- country, region, segment, industry

### Tabla: raw_companies
- company_id, name, domain, industry, company_size, country, region

## Valores clave de enums
- insight_type: pain, product_gap, competitive_signal, deal_friction, faq
- gap_priority: must_have, nice_to_have, dealbreaker
- competitor_relationship: currently_using, evaluating, migrating_from, comparing, mentioned, previously_used
- segment: 'Enterprise', 'Mid-Market', 'SMB', etc.

## Ejemplos

Pregunta: "Cuales son los top 10 pains mas frecuentes?"
SQL:
SELECT insight_subtype_display AS pain, COUNT(*) AS frecuencia
FROM v_insights_dashboard
WHERE insight_type = 'pain'
GROUP BY insight_subtype_display
ORDER BY frecuencia DESC
LIMIT 10;

Pregunta: "Que competidores mencionan mas y por que?"
HYBRID:
---CUANTITATIVO---
SELECT competitor_name, competitor_relationship_display, COUNT(*) AS menciones
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal' AND competitor_name IS NOT NULL
GROUP BY competitor_name, competitor_relationship_display
ORDER BY menciones DESC
LIMIT 15;
---CUALITATIVO---
SELECT competitor_name, competitor_relationship_display, summary, verbatim_quote, company_name
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal' AND competitor_name IS NOT NULL
  AND (summary IS NOT NULL OR verbatim_quote IS NOT NULL)
ORDER BY competitor_name, call_date DESC
LIMIT 25;

Pregunta: "Que dijo el prospecto de Coca-Cola sobre su proceso de onboarding?"
SEARCH:
---FILTROS---
title ILIKE '%coca%cola%'
---BUSQUEDA---
proceso de onboarding actual, como manejan el onboarding de empleados

Pregunta: "Que dicen los prospectos Enterprise de LATAM sobre su herramienta actual?"
SEARCH:
---BUSQUEDA---
herramienta actual que usan, plataforma actual, sistema que tienen hoy
---SQL---
SELECT company_name, competitor_name, competitor_relationship_display, COUNT(*) AS menciones
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal' AND segment = 'Enterprise' AND region = 'LATAM'
  AND competitor_name IS NOT NULL
GROUP BY company_name, competitor_name, competitor_relationship_display
ORDER BY menciones DESC
LIMIT 15;

Pregunta: "Alguien menciono integracion con SAP en alguna llamada?"
SEARCH:
---BUSQUEDA---
integracion con SAP, conectar con SAP, SAP SuccessFactors

Pregunta: "Cuales son los principales dolores en Enterprise y que dicen?"
HYBRID:
---CUANTITATIVO---
SELECT insight_subtype_display AS pain, pain_theme, COUNT(*) AS frecuencia
FROM v_insights_dashboard
WHERE insight_type = 'pain' AND segment = 'Enterprise'
GROUP BY insight_subtype_display, pain_theme
ORDER BY frecuencia DESC
LIMIT 10;
---CUALITATIVO---
SELECT insight_subtype_display AS pain, summary, verbatim_quote, company_name, deal_name
FROM v_insights_dashboard
WHERE insight_type = 'pain' AND segment = 'Enterprise'
  AND (summary IS NOT NULL OR verbatim_quote IS NOT NULL)
ORDER BY insight_subtype_display
LIMIT 25;

Pregunta: "Cuanto revenue esta en riesgo por deal friction?"
SQL:
SELECT insight_subtype_display AS tipo_friccion,
       COUNT(DISTINCT deal_id) AS deals_afectados,
       SUM(DISTINCT amount) AS revenue_en_riesgo
FROM v_insights_dashboard
WHERE insight_type = 'deal_friction' AND deal_id IS NOT NULL
GROUP BY insight_subtype_display
ORDER BY revenue_en_riesgo DESC NULLS LAST
LIMIT 15;

Pregunta: "Como manejan el tema de comunicacion interna los prospectos de mas de 50K?"
SEARCH:
---BUSQUEDA---
comunicacion interna, como se comunican los empleados, canales de comunicacion, chat interno
---SQL---
SELECT company_name, deal_name, amount, segment
FROM v_insights_dashboard
WHERE insight_type = 'pain' AND amount >= 50000
  AND (module = 'chat' OR module = 'communication')
GROUP BY company_name, deal_name, amount, segment
ORDER BY amount DESC
LIMIT 10;

## Reglas estrictas
1. Solo genera sentencias SELECT o WITH ... SELECT. NUNCA INSERT, UPDATE, DELETE, DROP, etc.
2. Siempre incluye LIMIT (maximo 50 filas por query).
3. Usa las columnas _display para valores legibles.
4. Responde siempre en espanol.
5. Si la pregunta no se puede responder, dilo con modo CHAT.
6. Para revenue, usa SUM(DISTINCT amount) o subquery para evitar duplicados.
7. En modo HYBRID, la query CUALITATIVA debe incluir summary y/o verbatim_quote.
8. En modo SEARCH, la seccion ---BUSQUEDA--- es obligatoria. ---FILTROS--- y ---SQL--- son opcionales.
9. En modo SEARCH, los filtros deben usar columnas de raw_transcripts: \
title, call_date, team. Ejemplo de filtro: title ILIKE '%Coca%Cola%'.
10. En modo SEARCH, la busqueda debe incluir palabras clave variadas y sinonimos \
(en espanol e ingles) para maximizar la cobertura de resultados.
11. Nunca respondas con "fecha de entrenamiento", "knowledge cutoff" o limites de internet. \
Si la pregunta requiere datos, usa SQL, HYBRID o SEARCH.
"""

SUMMARIZE_SYSTEM_PROMPT = """\
Eres un analista de datos ejecutivo. Recibes una pregunta de negocio, el SQL \
ejecutado y los resultados. Tu trabajo es resumir los hallazgos en espanol de \
forma clara, concisa y accionable para un CEO o VP.

Reglas:
- Responde en espanol.
- Se conciso: maximo 3-4 parrafos.
- Destaca los numeros mas importantes.
- Si los resultados estan vacios, dilo claramente.
- No muestres SQL ni codigo, solo el resumen en lenguaje natural.
- Usa formato markdown simple (negritas, listas) para legibilidad.
"""

SYNTHESIZE_HYBRID_PROMPT = """\
Eres un analista de datos ejecutivo. Recibes una pregunta de negocio junto con \
dos tipos de datos:

1. DATOS CUANTITATIVOS: numeros, conteos, rankings, revenue
2. CONTEXTO CUALITATIVO: resumenes de insights y citas textuales de llamadas de ventas

Tu trabajo es sintetizar AMBOS en una respuesta ejecutiva rica que combine los \
numeros duros con el contexto y las voces de los prospectos/clientes.

Reglas:
- Responde en espanol.
- Estructura sugerida:
  1. Hallazgos cuantitativos clave (los numeros mas importantes)
  2. Contexto cualitativo (que dicen, por que, como lo describen)
  3. Patrones o conclusiones accionables
- Usa citas textuales (verbatim_quote) entre comillas para dar evidencia directa.
- Cuando cites, menciona la empresa o deal si esta disponible para dar contexto.
- Se conciso pero informativo: maximo 5-6 parrafos.
- Identifica patrones cualitativos: que opiniones se repiten, que sentimientos predominan.
- No muestres SQL ni codigo.
- Usa formato markdown (negritas, listas, blockquotes) para legibilidad.
- Si hay datos cuantitativos pero no cualitativos, resume solo lo cuantitativo.
"""

SYNTHESIZE_SEARCH_PROMPT = """\
Eres un analista de datos ejecutivo. Recibes una pregunta de negocio junto con \
fragmentos de resumenes de llamadas de ventas (generados por Fathom AI) recuperados \
por busqueda semantica, y opcionalmente datos cuantitativos de una query SQL.

Tu trabajo es sintetizar la informacion en una respuesta ejecutiva rica, extrayendo \
los insights mas relevantes de las conversaciones reales.

Reglas:
- Responde en espanol.
- Estructura sugerida:
  1. Resumen ejecutivo de los hallazgos (2-3 oraciones clave)
  2. Lo que dicen los prospectos (citas o parafraseos relevantes entre comillas)
  3. Patrones identificados (que se repite, que sentimientos predominan)
  4. Si hay datos cuantitativos, integralos con el contexto cualitativo
- Cita o parafrasea fragmentos relevantes entre comillas.
- Menciona la empresa, segmento o region cuando este disponible para dar contexto.
- Se conciso pero informativo: maximo 6-7 parrafos.
- Si los fragmentos no son relevantes a la pregunta, dilo honestamente.
- No muestres SQL, codigo ni metadata tecnica.
- Usa formato markdown (negritas, listas, blockquotes) para legibilidad.
"""

# ---------------------------------------------------------------------------
# Blocked SQL patterns
# ---------------------------------------------------------------------------

_BLOCKED_PATTERNS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|EXECUTE|EXEC)\b",
    re.IGNORECASE,
)

_VALID_START = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)


def validate_sql(sql: str) -> tuple[bool, str]:
    """Validate that SQL is a read-only SELECT statement."""
    if not sql or not sql.strip():
        return False, "SQL vacio."
    if _BLOCKED_PATTERNS.search(sql):
        return False, "SQL contiene comandos no permitidos. Solo se permiten consultas SELECT."
    if not _VALID_START.match(sql):
        return False, "SQL debe comenzar con SELECT o WITH."
    return True, ""


def _validate_filters(filters: str) -> tuple[bool, str]:
    """Validate that search filters are safe for use in a WHERE clause."""
    if not filters or not filters.strip():
        return True, ""
    if _BLOCKED_PATTERNS.search(filters):
        return False, "Filtros contienen comandos no permitidos."
    if ";" in filters:
        return False, "Filtros no pueden contener ';'."
    if re.search(r"\b(FROM|JOIN|INTO|TABLE|UNION)\b", filters, re.IGNORECASE):
        return False, "Filtros no pueden contener operaciones de tabla."
    return True, ""


# ---------------------------------------------------------------------------
# Chart helpers
# ---------------------------------------------------------------------------

def _pretty_label(column: str) -> str:
    return str(column).replace("_", " ").strip().title()


def _rows_to_dataframe(columns: list[str], rows: list) -> pd.DataFrame:
    if not columns:
        return pd.DataFrame()
    if not rows:
        return pd.DataFrame(columns=columns)
    if isinstance(rows[0], dict):
        frame = pd.DataFrame(rows)
        for col in columns:
            if col not in frame.columns:
                frame[col] = pd.NA
        return frame[columns]
    return pd.DataFrame(rows, columns=columns)


def _to_numeric_series(series: pd.Series) -> pd.Series:
    cleaned = series.astype(str).str.replace(",", "", regex=False).str.replace("$", "", regex=False).str.replace("%", "", regex=False)
    return pd.to_numeric(cleaned, errors="coerce")


def _numeric_columns(df: pd.DataFrame) -> list[str]:
    if df.empty:
        return []
    threshold = max(2, int(len(df) * 0.6))
    out = []
    for col in df.columns:
        numeric = _to_numeric_series(df[col])
        if numeric.notna().sum() >= threshold:
            out.append(col)
    return out


def _pick_metric_column(numeric_cols: list[str]) -> str | None:
    if not numeric_cols:
        return None
    scored = []
    for idx, col in enumerate(numeric_cols):
        score = 10 if _METRIC_HINT_PATTERN.search(col or "") else 0
        score += max(0, 5 - idx)
        scored.append((score, col))
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def _pick_time_column(df: pd.DataFrame) -> str | None:
    if df.empty:
        return None
    threshold = max(2, int(len(df) * 0.6))
    candidates: list[tuple[int, int, str]] = []
    for col in df.columns:
        series = df[col]
        has_hint = bool(_TIME_HINT_PATTERN.search(col or ""))
        if not has_hint and not pd.api.types.is_datetime64_any_dtype(series):
            sample = series.dropna().astype(str).head(15)
            if sample.empty:
                continue
            date_like_ratio = sample.str.contains(
                r"(?:\d{4}-\d{1,2}-\d{1,2})|(?:\d{1,2}/\d{1,2}/\d{2,4})",
                regex=True,
            ).mean()
            if date_like_ratio < 0.5:
                continue
        parsed = pd.to_datetime(series, errors="coerce")
        valid = int(parsed.notna().sum())
        if valid < threshold:
            continue
        candidates.append((1 if has_hint else 0, valid, col))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return candidates[0][2]


def _pick_dimension_column(df: pd.DataFrame, excluded: set[str]) -> str | None:
    candidates: list[tuple[int, int, str]] = []
    for col in df.columns:
        if col in excluded:
            continue
        series = df[col].dropna()
        if series.empty:
            continue
        unique_count = int(series.nunique(dropna=True))
        if unique_count < 2 or unique_count > 40:
            continue
        avg_len = series.astype(str).str.len().mean()
        if avg_len > 90:
            continue
        score = 10 if _DIMENSION_HINT_PATTERN.search(col or "") else 0
        score += max(0, 20 - unique_count)
        candidates.append((score, unique_count, col))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return candidates[0][2]


def _should_try_chart(question: str, df: pd.DataFrame) -> bool:
    if df.empty or len(df) < 2:
        return False
    if _CHART_REQUEST_PATTERN.search(question or ""):
        return True
    # Chart small, aggregate-like tables even without explicit ask.
    return len(df) <= 12


def _infer_chart_meta(question: str, df: pd.DataFrame) -> dict | None:
    if not _should_try_chart(question, df):
        return None

    numeric_cols = _numeric_columns(df)
    if not numeric_cols:
        return None

    q = (question or "").lower()
    y_col = _pick_metric_column(numeric_cols)
    if not y_col:
        return None

    time_col = _pick_time_column(df)
    excluded = {y_col}
    if time_col:
        excluded.add(time_col)
    dim_col = _pick_dimension_column(df, excluded=excluded)

    wants_trend = bool(re.search(r"\b(trend|tendencia|evolucion|evolución|historico|histórico|mensual|semanal|diario|time)\b", q))
    wants_distribution = bool(re.search(r"\b(distribucion|distribución|share|mix|proporcion|proporción|porcentaje)\b", q))
    wants_correlation = bool(re.search(r"\b(correlacion|correlación|vs|versus)\b", q))

    if wants_correlation and len(numeric_cols) >= 2:
        x_col = next((c for c in numeric_cols if c != y_col), numeric_cols[0])
        return {
            "chart_type": "scatter",
            "x_col": x_col,
            "y_col": y_col,
            "title": f"{_pretty_label(y_col)} vs {_pretty_label(x_col)}",
        }

    if time_col and wants_trend:
        return {
            "chart_type": "line",
            "x_col": time_col,
            "y_col": y_col,
            "title": f"Evolucion de {_pretty_label(y_col)} por {_pretty_label(time_col)}",
        }

    if dim_col:
        unique_count = int(df[dim_col].nunique(dropna=True))
        if wants_distribution and unique_count <= 10:
            return {
                "chart_type": "pie",
                "x_col": dim_col,
                "y_col": y_col,
                "top_n": 10,
                "title": f"Distribucion de {_pretty_label(y_col)} por {_pretty_label(dim_col)}",
            }
        return {
            "chart_type": "bar",
            "x_col": dim_col,
            "y_col": y_col,
            "sort_desc": True,
            "top_n": 20,
            "title": f"{_pretty_label(y_col)} por {_pretty_label(dim_col)}",
        }

    if time_col:
        return {
            "chart_type": "line",
            "x_col": time_col,
            "y_col": y_col,
            "title": f"{_pretty_label(y_col)} por {_pretty_label(time_col)}",
        }

    if len(numeric_cols) >= 2:
        x_col = next((c for c in numeric_cols if c != y_col), numeric_cols[0])
        return {
            "chart_type": "scatter",
            "x_col": x_col,
            "y_col": y_col,
            "title": f"{_pretty_label(y_col)} vs {_pretty_label(x_col)}",
        }

    return None


def _build_chart_figure(df: pd.DataFrame, chart_meta: dict) -> object | None:
    chart_type = chart_meta.get("chart_type")
    x_col = chart_meta.get("x_col")
    y_col = chart_meta.get("y_col")
    title = chart_meta.get("title") or "Visualizacion"

    if not chart_type or not x_col or not y_col:
        return None
    if x_col not in df.columns or y_col not in df.columns:
        return None

    work = df.copy()
    work[y_col] = _to_numeric_series(work[y_col])

    if chart_type == "line":
        work[x_col] = pd.to_datetime(work[x_col], errors="coerce")
        plot_df = work[[x_col, y_col]].dropna(subset=[x_col, y_col]).sort_values(x_col)
        if plot_df.empty:
            return None
        return px.line(plot_df, x=x_col, y=y_col, title=title, labels={x_col: _pretty_label(x_col), y_col: _pretty_label(y_col)})

    if chart_type == "bar":
        plot_df = work[[x_col, y_col]].dropna(subset=[x_col, y_col])
        if plot_df.empty:
            return None
        agg_df = plot_df.groupby(x_col, dropna=False)[y_col].sum().reset_index()
        if chart_meta.get("sort_desc", True):
            agg_df = agg_df.sort_values(y_col, ascending=False)
        top_n = int(chart_meta.get("top_n", 20))
        agg_df = agg_df.head(top_n)
        return px.bar(agg_df, x=x_col, y=y_col, title=title, labels={x_col: _pretty_label(x_col), y_col: _pretty_label(y_col)})

    if chart_type == "pie":
        plot_df = work[[x_col, y_col]].dropna(subset=[x_col, y_col])
        if plot_df.empty:
            return None
        agg_df = plot_df.groupby(x_col, dropna=False)[y_col].sum().reset_index()
        top_n = int(chart_meta.get("top_n", 10))
        agg_df = agg_df.sort_values(y_col, ascending=False).head(top_n)
        return px.pie(agg_df, names=x_col, values=y_col, title=title)

    if chart_type == "scatter":
        work[x_col] = _to_numeric_series(work[x_col])
        plot_df = work[[x_col, y_col]].dropna(subset=[x_col, y_col])
        if plot_df.empty:
            return None
        return px.scatter(plot_df, x=x_col, y=y_col, title=title, labels={x_col: _pretty_label(x_col), y_col: _pretty_label(y_col)})

    return None


def _render_auto_chart(
    question: str,
    columns: list[str],
    rows: list,
    key_prefix: str,
    chart_meta: dict | None = None,
    infer_if_missing: bool = True,
) -> dict | None:
    df = _rows_to_dataframe(columns, rows)
    if df.empty:
        return None

    resolved_meta = chart_meta
    if resolved_meta is None and infer_if_missing:
        resolved_meta = _infer_chart_meta(question, df)
    if not resolved_meta:
        return None

    fig = _build_chart_figure(df, resolved_meta)
    if fig is None:
        return None

    fig.update_layout(margin=dict(l=10, r=10, t=40, b=10))
    st.caption("Visualizacion sugerida")
    st.plotly_chart(fig, width="stretch", key=f"{key_prefix}_auto_chart")
    return resolved_meta


# ---------------------------------------------------------------------------
# OpenAI helpers
# ---------------------------------------------------------------------------

def _get_secret(key: str) -> str:
    """Read from env vars (local) or st.secrets (Streamlit Cloud)."""
    import os
    val = os.environ.get(key)
    if val:
        return val
    try:
        return st.secrets[key]
    except (KeyError, FileNotFoundError):
        raise RuntimeError(f"Missing secret: {key}")


def _get_secret_optional(key: str) -> str | None:
    """Like _get_secret but returns None instead of raising."""
    val = os.environ.get(key)
    if val:
        return val
    try:
        return st.secrets[key]
    except (KeyError, FileNotFoundError):
        return None


def _get_chat_model() -> str:
    return os.getenv("OPENAI_CHAT_AGENT_MODEL", "gpt-4o")


def _get_openai_client() -> OpenAI:
    return OpenAI(api_key=_get_secret("OPENAI_API_KEY"))


# ---------------------------------------------------------------------------
# Database connection
# ---------------------------------------------------------------------------

def _get_db_connection():
    """Get a read-only PostgreSQL connection with retry on transient errors."""
    database_url = _get_secret_optional("DATABASE_URL") or _build_db_url_from_supabase_secrets()
    if not database_url:
        raise RuntimeError(
            "Falta configurar la conexion PostgreSQL. "
            "Opcion A: DATABASE_URL (Transaction Pooler). "
            "Opcion B: SUPABASE_URL + SUPABASE_DB_PASSWORD "
            "(opcionalmente SUPABASE_DB_HOST, SUPABASE_DB_PORT, SUPABASE_DB_NAME, SUPABASE_DB_USER)."
        )
    database_url = re.sub(r"[?&]sslmode=[^&]*", "", database_url)
    sep = "&" if "?" in database_url else "?"
    database_url = f"{database_url}{sep}sslmode=require"
    import time
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


def _build_db_url_from_supabase_secrets() -> str | None:
    """Build a PostgreSQL URL from Supabase secrets if DATABASE_URL is not provided."""
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

    return (
        "postgresql://"
        f"{quote_plus(user)}:{quote_plus(db_password)}"
        f"@{host}:{port}/{db_name}"
    )


def _looks_like_data_question(question: str) -> bool:
    return bool(_DATA_QUESTION_PATTERN.search(question or ""))


def _looks_like_knowledge_limit_response(text: str) -> bool:
    return bool(_KNOWLEDGE_LIMIT_PATTERN.search(text or ""))


def _force_data_mode_if_needed(
    client: OpenAI,
    question: str,
    mode: str,
    content: str,
    history: list[dict],
) -> tuple[str, str]:
    """Re-ask the model for SQL/HYBRID/SEARCH when a data question got CHAT."""
    if mode != "chat":
        return mode, content
    if not _looks_like_data_question(question):
        return mode, content

    retry_prompt = (
        "La pregunta siguiente requiere datos reales de la base. "
        "NO uses modo CHAT. "
        "Responde en SQL, HYBRID o SEARCH (con el formato exacto).\n\n"
        f"Pregunta: {question}"
    )
    try:
        forced_mode, forced_content = generate_response(client, retry_prompt, history)
    except Exception:
        return mode, content

    if forced_mode == "chat":
        if _looks_like_knowledge_limit_response(forced_content):
            forced_content = (
                "No uso respuestas por entrenamiento para preguntas de datos. "
                "Necesito consultar la base (PostgreSQL) para darte resultados reales."
            )
        return forced_mode, forced_content
    return forced_mode, forced_content


def _is_db_connection_error(error_text: str) -> bool:
    return bool(_DB_CONNECTION_ERROR_PATTERN.search(error_text or ""))


def _handle_rest_fallback(question: str, db_error: str) -> bool:
    """Fallback to read-only Supabase REST copilot when Postgres is unavailable."""
    if ask_insights is None:
        return False

    try:
        payload = ask_insights(question=question, top_n=10)
    except Exception:
        return False

    summary = payload.get("narrative") or "No pude generar una respuesta con el fallback."
    sql_preview = payload.get("sql") or ""
    columns = payload.get("columns") or []
    rows = payload.get("rows") or []

    st.caption(
        "PostgreSQL no disponible en este entorno. Respuesta generada con API read-only de Supabase."
    )
    st.markdown(summary)
    with st.expander("Detalle tecnico del fallback"):
        st.text(db_error)
    if sql_preview:
        with st.expander("Ver SQL (aproximado)"):
            st.code(sql_preview, language="sql")

    raw_data = None
    chart_meta = None
    if rows and columns:
        data_rows = [[row.get(c) for c in columns] for row in rows]
        raw_data = {"columns": columns, "rows": data_rows}
        chart_meta = _render_auto_chart(
            question=question,
            columns=columns,
            rows=data_rows,
            key_prefix=f"live_rest_{len(st.session_state.sql_chat_messages)}",
        )
        with st.expander("Ver datos crudos"):
            st.dataframe(pd.DataFrame(rows), width="stretch")

    st.session_state.sql_chat_messages.append({
        "role": "assistant",
        "content": summary,
        "sql": sql_preview if sql_preview else None,
        "raw_data": raw_data,
        "auto_chart": chart_meta,
        "question": question,
    })
    st.session_state.sql_chat_openai_history.append({"role": "user", "content": question})
    st.session_state.sql_chat_openai_history.append(
        {"role": "assistant", "content": f"Fallback REST. Resumen: {summary}"}
    )
    _trim_history()
    return True


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _parse_response(raw: str) -> tuple[str, str]:
    """Parse a GPT response into (mode, content).

    Returns ("sql"|"chat"|"hybrid"|"search", content_text).
    """
    stripped = raw.strip()

    if stripped.upper().startswith("SEARCH:"):
        search_text = stripped[7:].strip()
        search_text = re.sub(r"```(?:sql)?\s*\n?", "", search_text)
        search_text = search_text.replace("```", "")
        return "search", search_text

    if stripped.upper().startswith("HYBRID:"):
        hybrid_text = stripped[7:].strip()
        hybrid_text = re.sub(r"```(?:sql)?\s*\n?", "", hybrid_text)
        hybrid_text = hybrid_text.replace("```", "")
        return "hybrid", hybrid_text

    if stripped.upper().startswith("SQL:"):
        sql_text = stripped[4:].strip()
        fence_match = re.search(r"```(?:sql)?\s*\n(.*?)```", sql_text, re.DOTALL)
        if fence_match:
            sql_text = fence_match.group(1).strip()
        return "sql", sql_text

    if stripped.upper().startswith("CHAT:"):
        return "chat", stripped[5:].strip()

    # Fallback heuristic
    if re.search(r"\b(SELECT|WITH)\b", stripped, re.IGNORECASE):
        fence_match = re.search(r"```(?:sql)?\s*\n(.*?)```", stripped, re.DOTALL)
        if fence_match:
            return "sql", fence_match.group(1).strip()
        sql_match = re.search(r"((?:SELECT|WITH)\b.*)", stripped, re.DOTALL | re.IGNORECASE)
        if sql_match:
            return "sql", sql_match.group(1).strip()

    return "chat", stripped


def _split_hybrid_queries(content: str) -> tuple[str, str]:
    """Split HYBRID content into (quantitative_sql, qualitative_sql)."""
    parts = re.split(
        r"---\s*CUANTITATIVO\s*---\s*|---\s*CUALITATIVO\s*---\s*",
        content, flags=re.IGNORECASE,
    )
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    elif len(parts) == 1:
        return parts[0], parts[0]
    return content, content


def _parse_search_content(content: str) -> dict:
    """Parse SEARCH mode content into filters, search query, and optional SQL.

    Returns dict with keys: "filters", "search_query", "sql" (optional).
    Robust: if no section markers found, treats entire content as the search query.
    """
    result = {"filters": "", "search_query": "", "sql": ""}

    # Split on section markers
    sections = re.split(
        r"---\s*(FILTROS|BUSQUEDA|SQL)\s*---",
        content, flags=re.IGNORECASE,
    )

    # If no markers were found (only 1 part), use content as search query
    if len(sections) == 1:
        result["search_query"] = content.strip()
        return result

    # sections alternates: [text_before, marker, text, marker, text, ...]
    current_key = None
    for part in sections:
        upper = part.strip().upper()
        if upper == "FILTROS":
            current_key = "filters"
        elif upper == "BUSQUEDA":
            current_key = "search_query"
        elif upper == "SQL":
            current_key = "sql"
        elif current_key and part.strip():
            result[current_key] = part.strip()

    return result


# ---------------------------------------------------------------------------
# GPT calls
# ---------------------------------------------------------------------------

def generate_response(client: OpenAI, question: str, history: list[dict]) -> tuple[str, str]:
    """Main entry point: ask GPT and return (mode, content)."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": question})

    response = client.chat.completions.create(
        model=_get_chat_model(),
        messages=messages,
        temperature=0,
        max_tokens=2000,
    )
    raw = response.choices[0].message.content.strip()
    return _parse_response(raw)


def generate_sql(client: OpenAI, question: str, history: list[dict]) -> str:
    """Ask GPT-4o to generate SQL (used for retry flow)."""
    mode, content = generate_response(client, question, history)
    return content


def summarize_results(
    client: OpenAI, question: str, sql: str, columns: list[str], rows: list[tuple],
) -> str:
    """Ask GPT-4o to summarize query results in executive language."""
    if not rows:
        results_text = "(Sin resultados)"
    else:
        header = " | ".join(columns)
        lines = [header, "-" * len(header)]
        for row in rows[:50]:
            lines.append(" | ".join(str(v) for v in row))
        results_text = "\n".join(lines)

    user_msg = (
        f"Pregunta: {question}\n\n"
        f"SQL ejecutado:\n{sql}\n\n"
        f"Resultados:\n{results_text}"
    )

    response = client.chat.completions.create(
        model=_get_chat_model(),
        messages=[
            {"role": "system", "content": SUMMARIZE_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.3,
        max_tokens=1024,
    )
    return response.choices[0].message.content.strip()


def summarize_hybrid_results(
    client: OpenAI, question: str,
    quant_columns: list[str], quant_rows: list[tuple],
    qual_columns: list[str], qual_rows: list[tuple],
) -> str:
    """Synthesize quantitative + qualitative results."""
    if quant_rows:
        q_header = " | ".join(quant_columns)
        q_lines = [q_header, "-" * len(q_header)]
        for row in quant_rows[:50]:
            q_lines.append(" | ".join(str(v) for v in row))
        quant_text = "\n".join(q_lines)
    else:
        quant_text = "(Sin resultados cuantitativos)"

    if qual_rows:
        qual_entries = []
        for row in qual_rows[:25]:
            entry_parts = []
            for col, val in zip(qual_columns, row):
                if val is not None and str(val).strip():
                    entry_parts.append(f"  {col}: {val}")
            if entry_parts:
                qual_entries.append("\n".join(entry_parts))
        qual_text = "\n---\n".join(qual_entries) if qual_entries else "(Sin contexto cualitativo)"
    else:
        qual_text = "(Sin contexto cualitativo)"

    user_msg = (
        f"Pregunta del usuario: {question}\n\n"
        f"== DATOS CUANTITATIVOS ==\n{quant_text}\n\n"
        f"== CONTEXTO CUALITATIVO ==\n{qual_text}"
    )

    response = client.chat.completions.create(
        model=_get_chat_model(),
        messages=[
            {"role": "system", "content": SYNTHESIZE_HYBRID_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.3,
        max_tokens=2048,
    )
    return response.choices[0].message.content.strip()


def summarize_search_results(
    client: OpenAI, question: str,
    search_chunks: list[dict],
    sql_columns: list[str] | None = None,
    sql_rows: list[tuple] | None = None,
) -> str:
    """Synthesize semantic search results + optional SQL data."""
    # Format search results
    if search_chunks:
        chunk_entries = []
        for i, chunk in enumerate(search_chunks, 1):
            source_label = "Transcripcion" if chunk["source_type"] == "transcript" else "Resumen Fathom"
            parts = [f"Fragmento {i} ({source_label}, similitud: {chunk['similarity']:.2f})"]
            if chunk.get("company_name"):
                parts[0] += f" — {chunk['company_name']}"
            if chunk.get("segment"):
                parts[0] += f" ({chunk['segment']})"
            if chunk.get("call_date"):
                parts[0] += f" [{chunk['call_date']}]"
            parts.append(chunk["chunk_text"][:2000])  # Truncate very long chunks
            chunk_entries.append("\n".join(parts))
        search_text = "\n\n===\n\n".join(chunk_entries)
    else:
        search_text = "(No se encontraron fragmentos relevantes)"

    # Format optional SQL results
    sql_text = ""
    if sql_columns and sql_rows:
        header = " | ".join(sql_columns)
        lines = [header, "-" * len(header)]
        for row in sql_rows[:30]:
            lines.append(" | ".join(str(v) for v in row))
        sql_text = f"\n\n== DATOS CUANTITATIVOS COMPLEMENTARIOS ==\n" + "\n".join(lines)

    user_msg = (
        f"Pregunta del usuario: {question}\n\n"
        f"== FRAGMENTOS DE TRANSCRIPCIONES RELEVANTES ==\n{search_text}"
        f"{sql_text}"
    )

    response = client.chat.completions.create(
        model=_get_chat_model(),
        messages=[
            {"role": "system", "content": SYNTHESIZE_SEARCH_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.3,
        max_tokens=2048,
    )
    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Database execution
# ---------------------------------------------------------------------------

def execute_query(sql: str) -> tuple[list[str], list[tuple]]:
    """Execute a read-only SQL query against PostgreSQL."""
    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '15s';")
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description] if cur.description else []
            rows = cur.fetchall() if cur.description else []
        return columns, rows
    finally:
        conn.close()


def _generate_search_keywords(client: OpenAI, search_query: str) -> list[str]:
    """Use GPT to generate bilingual search keywords from a natural language query."""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "system",
                "content": (
                    "Given a search query about sales call transcripts, generate 4-6 "
                    "search keywords to find relevant content. Include both Spanish and "
                    "English versions of the most important terms.\n"
                    "Return ONLY a comma-separated list of single keywords, nothing else.\n"
                    "Example: 'onboarding, incorporacion, induccion, new hire'"
                ),
            }, {
                "role": "user",
                "content": search_query,
            }],
            temperature=0,
            max_tokens=100,
        )
        raw = response.choices[0].message.content.strip()
        keywords = [k.strip().strip("'\"") for k in raw.split(",") if k.strip()]
        return keywords[:6]  # Cap at 6 keywords
    except Exception:
        # Fallback: split original query into words > 2 chars
        return [w for w in search_query.split() if len(w) > 2][:4]


def search_transcript_chunks(
    client: OpenAI,
    search_query: str,
    filters: str = "",
    limit: int = SEARCH_RESULTS_LIMIT,
) -> list[dict]:
    """Keyword-based search on raw_transcripts.fathom_summary.

    Uses GPT to generate bilingual keywords, then searches with ILIKE on
    raw_transcripts (~5K rows, lightweight — no vector columns).
    Returns results ordered by recency (most recent calls first).

    Returns list of dicts with keys: chunk_text, source_type, company_name,
    call_date, segment, similarity.
    """
    # 1. Generate bilingual search keywords
    keywords = _generate_search_keywords(client, search_query)
    if not keywords:
        return []

    # 2. Build parameterized ILIKE patterns
    patterns = [f"%{kw}%" for kw in keywords]

    # WHERE: at least one keyword matches
    or_clauses = " OR ".join(f"fathom_summary ILIKE %s" for _ in patterns)

    # Step 1: Find matching recording_ids (fast — no TOAST decompression)
    id_query = f"""
        SELECT recording_id, title, call_date::text AS call_date, team
        FROM raw_transcripts
        WHERE fathom_summary IS NOT NULL
          AND ({or_clauses})
    """
    id_params: list = list(patterns)

    if filters and filters.strip():
        valid, err = _validate_filters(filters)
        if valid:
            id_query += f" AND ({filters})"

    id_query += """
        ORDER BY call_date DESC NULLS LAST
        LIMIT %s
    """
    id_params.append(int(limit))

    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '15s';")
            cur.execute(id_query, id_params)
            id_rows = cur.fetchall()

        if not id_rows:
            return []

        # Step 2: Fetch text for matching IDs (small batch, fast)
        recording_ids = [r[0] for r in id_rows]
        placeholders = ",".join(["%s"] * len(recording_ids))
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '15s';")
            cur.execute(
                f"SELECT recording_id, LEFT(fathom_summary, 2000) "
                f"FROM raw_transcripts WHERE recording_id IN ({placeholders})",
                recording_ids,
            )
            text_rows = cur.fetchall()
        text_map = {r[0]: r[1] for r in text_rows}

        # Normalize results to expected format
        results = []
        for row in id_rows:
            rid, title, call_date, team = row
            chunk_text = text_map.get(rid, "")
            # Count how many keywords match for scoring
            text_lower = (chunk_text or "").lower()
            matches = sum(1 for kw in keywords if kw.lower() in text_lower)
            similarity = round(matches / len(keywords), 3) if keywords else 0
            results.append({
                "chunk_text": chunk_text,
                "source_type": "fathom_summary",
                "company_name": title or "",
                "call_date": call_date,
                "segment": team or "",
                "similarity": similarity,
            })
        # Re-sort by relevance score first, then date
        results.sort(key=lambda x: (-x["similarity"], x.get("call_date") or ""))
        return results
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Mode handlers
# ---------------------------------------------------------------------------

def _handle_hybrid(client: OpenAI, question: str, content: str) -> None:
    """Handle HYBRID mode: execute quantitative + qualitative queries and synthesize."""
    quant_sql, qual_sql = _split_hybrid_queries(content)

    valid1, err1 = validate_sql(quant_sql)
    valid2, err2 = validate_sql(qual_sql)

    if not valid1 and not valid2:
        response_text = f"No puedo ejecutar las consultas generadas: {err1}"
        st.markdown(response_text)
        st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
        _trim_history()
        return

    quant_cols, quant_rows = [], []
    if valid1:
        try:
            quant_cols, quant_rows = execute_query(quant_sql)
        except Exception as e:
            st.caption(f"Query cuantitativa con error: {e}")

    qual_cols, qual_rows = [], []
    if valid2:
        try:
            qual_cols, qual_rows = execute_query(qual_sql)
        except Exception as e:
            st.caption(f"Query cualitativa con error: {e}")

    if not quant_rows and not qual_rows:
        response_text = "Las consultas no devolvieron resultados. Intenta reformular tu pregunta."
        st.markdown(response_text)
        st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
        _trim_history()
        return

    try:
        summary = summarize_hybrid_results(
            client, question, quant_cols, quant_rows, qual_cols, qual_rows,
        )
    except Exception:
        summary = "No pude generar la sintesis. Revisa los datos crudos abajo."

    st.markdown(summary)

    quant_chart_meta = None
    if quant_cols and quant_rows:
        quant_chart_meta = _render_auto_chart(
            question=question,
            columns=quant_cols,
            rows=[list(r) for r in quant_rows],
            key_prefix=f"live_hybrid_{len(st.session_state.sql_chat_messages)}",
        )

    with st.expander("Ver SQL — cuantitativo"):
        st.code(quant_sql, language="sql")
    with st.expander("Ver SQL — cualitativo"):
        st.code(qual_sql, language="sql")

    quant_data = None
    if quant_cols and quant_rows:
        quant_data = {"columns": quant_cols, "rows": [list(r) for r in quant_rows]}
        with st.expander("Ver datos cuantitativos"):
            st.dataframe(pd.DataFrame(quant_rows, columns=quant_cols), width="stretch")

    qual_data = None
    if qual_cols and qual_rows:
        qual_data = {"columns": qual_cols, "rows": [list(r) for r in qual_rows]}
        with st.expander("Ver datos cualitativos"):
            st.dataframe(pd.DataFrame(qual_rows, columns=qual_cols), width="stretch")

    st.session_state.sql_chat_messages.append({
        "role": "assistant", "content": summary,
        "quant_sql": quant_sql, "qual_sql": qual_sql,
        "quant_data": quant_data, "qual_data": qual_data,
        "quant_chart": quant_chart_meta,
        "question": question,
    })
    st.session_state.sql_chat_openai_history.append({"role": "user", "content": question})
    st.session_state.sql_chat_openai_history.append(
        {"role": "assistant", "content": f"Respuesta hibrida cuanti+cuali.\nResumen: {summary}"}
    )
    _trim_history()


def _handle_search(client: OpenAI, question: str, content: str) -> None:
    """Handle SEARCH mode: semantic search on transcript chunks + optional SQL."""
    parsed = _parse_search_content(content)
    search_query = parsed["search_query"]
    filters = parsed["filters"]
    sql = parsed["sql"]

    if not search_query:
        response_text = "No se pudo identificar la busqueda. Intenta reformular tu pregunta."
        st.markdown(response_text)
        st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
        _trim_history()
        return

    # 1. Semantic search on transcript chunks
    try:
        chunks = search_transcript_chunks(client, search_query, filters=filters)
    except Exception as e:
        response_text = f"Error en la busqueda semantica: {e}"
        st.markdown(response_text)
        st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
        _trim_history()
        return

    # 2. Optional SQL query
    sql_cols, sql_rows = None, None
    if sql and sql.strip():
        valid, err = validate_sql(sql)
        if valid:
            try:
                sql_cols_list, sql_rows_list = execute_query(sql)
                sql_cols = sql_cols_list
                sql_rows = sql_rows_list
            except Exception as e:
                st.caption(f"Query SQL complementaria con error: {e}")

    if not chunks and not sql_rows:
        response_text = "No se encontraron resultados relevantes. Intenta con otra pregunta o menos filtros."
        st.markdown(response_text)
        st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
        _trim_history()
        return

    # 3. Synthesize
    try:
        summary = summarize_search_results(
            client, question, chunks,
            sql_columns=sql_cols, sql_rows=sql_rows,
        )
    except Exception:
        summary = "No pude generar la sintesis. Revisa los fragmentos recuperados abajo."

    # 4. Display
    st.markdown(summary)

    # Show search metadata
    if filters:
        with st.expander("Ver filtros aplicados"):
            st.code(filters, language="sql")
    with st.expander(f"Ver busqueda semantica ({len(chunks)} fragmentos)"):
        st.text(f"Query: {search_query}")
        if chunks:
            display_data = []
            for c in chunks:
                display_data.append({
                    "similitud": f"{c['similarity']:.3f}",
                    "tipo": c["source_type"],
                    "empresa": c.get("company_name") or "",
                    "segmento": c.get("segment") or "",
                    "fecha": c.get("call_date") or "",
                    "texto": c["chunk_text"][:300] + "..." if len(c["chunk_text"]) > 300 else c["chunk_text"],
                })
            st.dataframe(pd.DataFrame(display_data), width="stretch")
    if sql and sql.strip():
        with st.expander("Ver SQL complementario"):
            st.code(sql, language="sql")
        if sql_cols and sql_rows:
            search_sql_chart_meta = _render_auto_chart(
                question=question,
                columns=sql_cols,
                rows=[list(r) for r in sql_rows],
                key_prefix=f"live_search_{len(st.session_state.sql_chat_messages)}",
            )
            with st.expander("Ver datos SQL"):
                st.dataframe(pd.DataFrame(sql_rows, columns=sql_cols), width="stretch")
        else:
            search_sql_chart_meta = None
    else:
        search_sql_chart_meta = None

    # Build serializable search data for history
    search_data = None
    if chunks:
        search_data = [{
            "similarity": f"{c['similarity']:.3f}",
            "source_type": c["source_type"],
            "company_name": c.get("company_name") or "",
            "segment": c.get("segment") or "",
            "call_date": c.get("call_date") or "",
            "chunk_text_preview": c["chunk_text"][:200],
        } for c in chunks]

    sql_data = None
    if sql_cols and sql_rows:
        sql_data = {"columns": sql_cols, "rows": [list(r) for r in sql_rows]}

    st.session_state.sql_chat_messages.append({
        "role": "assistant", "content": summary,
        "search_query": search_query,
        "search_filters": filters,
        "search_data": search_data,
        "search_sql": sql if sql and sql.strip() else None,
        "search_sql_data": sql_data,
        "search_sql_chart": search_sql_chart_meta,
        "question": question,
    })
    st.session_state.sql_chat_openai_history.append({"role": "user", "content": question})
    st.session_state.sql_chat_openai_history.append(
        {"role": "assistant", "content": f"Busqueda semantica completada.\nResumen: {summary}"}
    )
    _trim_history()


# ---------------------------------------------------------------------------
# Streamlit page
# ---------------------------------------------------------------------------

MAX_HISTORY = 12


def page_sql_chat(df) -> None:
    """Streamlit page: Chat con IA."""
    st.header("Chat con IA")
    st.caption(
        "Hace preguntas en lenguaje natural sobre insights, deals y competidores. "
        "Las respuestas combinan datos cuantitativos, insights estructurados y "
        "busqueda semantica en transcripciones completas."
    )

    if "sql_chat_messages" not in st.session_state:
        st.session_state.sql_chat_messages = []
    if "sql_chat_openai_history" not in st.session_state:
        st.session_state.sql_chat_openai_history = []

    if st.sidebar.button("Limpiar chat", key="clear_sql_chat"):
        st.session_state.sql_chat_messages = []
        st.session_state.sql_chat_openai_history = []
        st.rerun()

    # --- Render chat history ---
    for idx, msg in enumerate(st.session_state.sql_chat_messages):
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

            if msg.get("raw_data"):
                _render_auto_chart(
                    question=msg.get("question", ""),
                    columns=msg["raw_data"]["columns"],
                    rows=msg["raw_data"]["rows"],
                    key_prefix=f"history_{idx}_sql",
                    chart_meta=msg.get("auto_chart"),
                    infer_if_missing=msg.get("auto_chart") is None,
                )
            if msg.get("quant_data"):
                _render_auto_chart(
                    question=msg.get("question", ""),
                    columns=msg["quant_data"]["columns"],
                    rows=msg["quant_data"]["rows"],
                    key_prefix=f"history_{idx}_hybrid",
                    chart_meta=msg.get("quant_chart"),
                    infer_if_missing=msg.get("quant_chart") is None,
                )
            if msg.get("search_sql_data"):
                _render_auto_chart(
                    question=msg.get("question", ""),
                    columns=msg["search_sql_data"]["columns"],
                    rows=msg["search_sql_data"]["rows"],
                    key_prefix=f"history_{idx}_search",
                    chart_meta=msg.get("search_sql_chart"),
                    infer_if_missing=msg.get("search_sql_chart") is None,
                )

            # SQL mode
            if msg.get("sql"):
                with st.expander("Ver SQL"):
                    st.code(msg["sql"], language="sql")
            # HYBRID mode
            if msg.get("quant_sql"):
                with st.expander("Ver SQL — cuantitativo"):
                    st.code(msg["quant_sql"], language="sql")
            if msg.get("qual_sql"):
                with st.expander("Ver SQL — cualitativo"):
                    st.code(msg["qual_sql"], language="sql")
            # SEARCH mode
            if msg.get("search_query"):
                with st.expander(f"Ver busqueda semantica"):
                    st.text(f"Query: {msg['search_query']}")
                    if msg.get("search_filters"):
                        st.text(f"Filtros: {msg['search_filters']}")
                    if msg.get("search_data"):
                        st.dataframe(pd.DataFrame(msg["search_data"]), width="stretch")
            if msg.get("search_sql"):
                with st.expander("Ver SQL complementario"):
                    st.code(msg["search_sql"], language="sql")
            # Data expanders
            if msg.get("raw_data"):
                with st.expander("Ver datos crudos"):
                    st.dataframe(
                        pd.DataFrame(msg["raw_data"]["rows"], columns=msg["raw_data"]["columns"]),
                        width="stretch",
                    )
            if msg.get("quant_data"):
                with st.expander("Ver datos cuantitativos"):
                    st.dataframe(
                        pd.DataFrame(msg["quant_data"]["rows"], columns=msg["quant_data"]["columns"]),
                        width="stretch",
                    )
            if msg.get("qual_data"):
                with st.expander("Ver datos cualitativos"):
                    st.dataframe(
                        pd.DataFrame(msg["qual_data"]["rows"], columns=msg["qual_data"]["columns"]),
                        width="stretch",
                    )
            if msg.get("search_sql_data"):
                with st.expander("Ver datos SQL"):
                    st.dataframe(
                        pd.DataFrame(msg["search_sql_data"]["rows"], columns=msg["search_sql_data"]["columns"]),
                        width="stretch",
                    )

    # --- Chat input ---
    question = st.chat_input("Escribi tu pregunta sobre los datos...")
    if not question:
        return

    st.session_state.sql_chat_messages.append({"role": "user", "content": question})
    with st.chat_message("user"):
        st.markdown(question)

    # --- Process ---
    with st.chat_message("assistant"):
        try:
            with st.spinner("Pensando..."):
                client = _get_openai_client()

                try:
                    mode, content = generate_response(
                        client, question, st.session_state.sql_chat_openai_history,
                    )
                    mode, content = _force_data_mode_if_needed(
                        client=client,
                        question=question,
                        mode=mode,
                        content=content,
                        history=st.session_state.sql_chat_openai_history,
                    )
                except Exception:
                    response_text = "No pude conectarme con el servicio de IA. Intenta de nuevo."
                    st.markdown(response_text)
                    st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
                    return

            # --- CHAT ---
            if mode == "chat":
                st.markdown(content)
                st.session_state.sql_chat_messages.append({"role": "assistant", "content": content})
                st.session_state.sql_chat_openai_history.append({"role": "user", "content": question})
                st.session_state.sql_chat_openai_history.append({"role": "assistant", "content": content})
                _trim_history()
                return

            # --- HYBRID ---
            if mode == "hybrid":
                with st.spinner("Consultando datos cuantitativos y cualitativos..."):
                    _handle_hybrid(client, question, content)
                return

            # --- SEARCH ---
            if mode == "search":
                with st.spinner("Buscando en transcripciones..."):
                    _handle_search(client, question, content)
                return

            # --- SQL ---
            sql = content

            valid, err = validate_sql(sql)
            if not valid:
                response_text = f"No puedo ejecutar esa consulta: {err}"
                st.markdown(response_text)
                st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
                st.session_state.sql_chat_openai_history.append({"role": "user", "content": question})
                st.session_state.sql_chat_openai_history.append({"role": "assistant", "content": response_text})
                _trim_history()
                return

            with st.spinner("Ejecutando consulta SQL..."):
                columns, rows = [], []
                exec_error = None
                try:
                    columns, rows = execute_query(sql)
                except Exception as e:
                    exec_error = str(e)

                if exec_error:
                    if _is_db_connection_error(exec_error):
                        if _handle_rest_fallback(question, exec_error):
                            return
                    retry_prompt = (
                        f"El SQL anterior fallo con este error:\n{exec_error}\n\n"
                        f"SQL que fallo:\n{sql}\n\n"
                        f"Pregunta original: {question}\n\n"
                        "Genera un SQL corregido. Responde con SQL: seguido del query."
                    )
                    try:
                        sql = generate_sql(
                            client, retry_prompt, st.session_state.sql_chat_openai_history,
                        )
                    except Exception:
                        response_text = "Hubo un error al generar la consulta. Intenta reformular."
                        st.markdown(response_text)
                        st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
                        _trim_history()
                        return

                    valid, err = validate_sql(sql)
                    if not valid:
                        response_text = f"No pude generar una consulta valida: {err}"
                        st.markdown(response_text)
                        st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
                        _trim_history()
                        return

                    try:
                        columns, rows = execute_query(sql)
                    except Exception as e2:
                        if _is_db_connection_error(str(e2)):
                            if _handle_rest_fallback(question, str(e2)):
                                return
                        response_text = f"La consulta fallo incluso despues de reintentar: {e2}"
                        st.markdown(response_text)
                        st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})
                        _trim_history()
                        return

                try:
                    summary = summarize_results(client, question, sql, columns, rows)
                except Exception:
                    summary = "No pude generar el resumen. Revisa los datos crudos abajo."

            # Display (outside spinner)
            st.markdown(summary)
            with st.expander("Ver SQL"):
                st.code(sql, language="sql")

            raw_data = None
            auto_chart_meta = None
            if columns and rows:
                raw_data = {"columns": columns, "rows": [list(r) for r in rows]}
                auto_chart_meta = _render_auto_chart(
                    question=question,
                    columns=columns,
                    rows=raw_data["rows"],
                    key_prefix=f"live_sql_{len(st.session_state.sql_chat_messages)}",
                )
                with st.expander("Ver datos crudos"):
                    st.dataframe(pd.DataFrame(rows, columns=columns), width="stretch")

            st.session_state.sql_chat_messages.append({
                "role": "assistant", "content": summary, "sql": sql, "raw_data": raw_data,
                "auto_chart": auto_chart_meta, "question": question,
            })
            st.session_state.sql_chat_openai_history.append({"role": "user", "content": question})
            st.session_state.sql_chat_openai_history.append(
                {"role": "assistant", "content": f"SQL: {sql}\nResultado resumido: {summary}"}
            )
            _trim_history()

        except Exception:
            response_text = "Ocurrio un error inesperado. Intenta de nuevo."
            st.markdown(response_text)
            st.session_state.sql_chat_messages.append({"role": "assistant", "content": response_text})


def _trim_history() -> None:
    """Keep only the last MAX_HISTORY messages in OpenAI history."""
    h = st.session_state.sql_chat_openai_history
    if len(h) > MAX_HISTORY:
        st.session_state.sql_chat_openai_history = h[-MAX_HISTORY:]
