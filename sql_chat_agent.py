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

import psycopg2
import psycopg2.extras
import streamlit as st
from openai import OpenAI


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 2000
SEARCH_RESULTS_LIMIT = 12

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

**Modo SEARCH** — busqueda semantica en las transcripciones completas de llamadas. \
Ideal para preguntas sobre lo que se dijo en las llamadas, opiniones detalladas, \
temas que no estan en los insights estructurados, o cuando se necesita contexto \
profundo de conversaciones especificas:
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

**SQL**: Solo numeros — "cuantos", "top 10", "total revenue", "ranking"

**HYBRID**: Numeros + contexto de insights — "que opinan", "por que", "ejemplos", \
cuando la respuesta esta en los campos summary/verbatim_quote de los insights ya extraidos.

**SEARCH**: Busqueda profunda en transcripciones — preguntas sobre:
- Lo que dijo un prospecto especifico: "que dijo Coca-Cola sobre..."
- Temas no capturados como insight: "alguien menciono integracion con SAP?"
- Opiniones detalladas sobre un tema: "como describen su proceso de onboarding actual?"
- Contexto de conversaciones especificas: "de que se hablo en la llamada con Bimbo?"
- Preguntas que mezclan segmentacion CRM + texto libre: "que dicen los prospectos \
Enterprise de LATAM sobre su herramienta actual?"

**CHAT**: Todo lo demas.

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

### Tabla: transcript_chunks (para modo SEARCH — busqueda semantica)
Columnas para filtros:
- transcript_id, deal_id, deal_name, company_name
- region, country, segment, industry, company_size
- deal_stage, deal_owner, call_date, amount
- source_type: 'transcript' | 'fathom_summary'
(La columna chunk_text y embedding se usan internamente, no las incluyas en filtros)

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
company_name ILIKE '%coca%cola%'
---BUSQUEDA---
proceso de onboarding actual, como manejan el onboarding de empleados

Pregunta: "Que dicen los prospectos Enterprise de LATAM sobre su herramienta actual?"
SEARCH:
---FILTROS---
segment = 'Enterprise' AND region = 'LATAM'
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
---FILTROS---
amount >= 50000
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
9. En modo SEARCH, los filtros deben usar columnas de transcript_chunks: \
segment, region, country, company_name, deal_name, deal_owner, deal_stage, \
industry, company_size, call_date, amount, source_type.
10. En modo SEARCH, la busqueda debe ser descriptiva (varias formas de decir lo mismo) \
para maximizar la cobertura semantica.
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
fragmentos de transcripciones de llamadas de ventas recuperados por busqueda semantica, \
y opcionalmente datos cuantitativos de una query SQL.

Tu trabajo es sintetizar la informacion en una respuesta ejecutiva rica, extrayendo \
los insights mas relevantes de las conversaciones reales.

Reglas:
- Responde en espanol.
- Estructura sugerida:
  1. Resumen ejecutivo de los hallazgos (2-3 oraciones clave)
  2. Lo que dicen los prospectos (citas textuales relevantes entre comillas)
  3. Patrones identificados (que se repite, que sentimientos predominan)
  4. Si hay datos cuantitativos, integralos con el contexto cualitativo
- Cita textualmente fragmentos relevantes de las transcripciones entre comillas.
- Menciona la empresa, segmento o region cuando este disponible para dar contexto.
- Se conciso pero informativo: maximo 6-7 parrafos.
- Si los fragmentos no son relevantes a la pregunta, dilo honestamente.
- No muestres SQL, codigo ni metadata tecnica.
- Usa formato markdown (negritas, listas, blockquotes) para legibilidad.
- Indica si los fragmentos vienen de la transcripcion completa o del resumen de Fathom.
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
    """Get a read-only PostgreSQL connection."""
    database_url = _get_secret_optional("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "Falta configurar DATABASE_URL en los Secrets de Streamlit Cloud. "
            "Usa la URL del Transaction Pooler de Supabase."
        )
    database_url = re.sub(r"[?&]sslmode=[^&]*", "", database_url)
    sep = "&" if "?" in database_url else "?"
    database_url = f"{database_url}{sep}sslmode=require"
    conn = psycopg2.connect(database_url)
    conn.set_session(readonly=True, autocommit=True)
    return conn


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
    """
    result = {"filters": "", "search_query": "", "sql": ""}

    # Split on section markers
    sections = re.split(
        r"---\s*(FILTROS|BUSQUEDA|SQL)\s*---",
        content, flags=re.IGNORECASE,
    )

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
        max_tokens=1500,
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


def _embed_query(client: OpenAI, text: str) -> list[float]:
    """Embed a search query using text-embedding-3-large."""
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text,
        dimensions=EMBEDDING_DIMENSIONS,
    )
    return response.data[0].embedding


def search_transcript_chunks(
    client: OpenAI,
    search_query: str,
    filters: str = "",
    limit: int = SEARCH_RESULTS_LIMIT,
) -> list[dict]:
    """Embed query and search transcript_chunks by cosine similarity.

    Returns list of dicts with keys: chunk_text, source_type, company_name,
    deal_name, call_date, segment, region, country, deal_owner, similarity.
    """
    # Generate query embedding
    query_embedding = _embed_query(client, search_query)
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    # Build query with optional filters
    query = """
        SELECT chunk_text, source_type, company_name, deal_name,
               call_date::text AS call_date, segment, region, country,
               deal_owner, deal_stage, amount,
               1 - (embedding <=> %s::vector) AS similarity
        FROM transcript_chunks
        WHERE embedding IS NOT NULL
    """
    params: list = [embedding_str]

    if filters and filters.strip():
        valid, err = _validate_filters(filters)
        if valid:
            query += f" AND ({filters})"
        # If filters are invalid, skip them silently and search without filters

    query += """
        ORDER BY embedding <=> %s::vector
        LIMIT %s
    """
    params.extend([embedding_str, limit])

    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '15s';")
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
        return [dict(zip(columns, row)) for row in rows]
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
    with st.expander("Ver SQL — cuantitativo"):
        st.code(quant_sql, language="sql")
    with st.expander("Ver SQL — cualitativo"):
        st.code(qual_sql, language="sql")

    quant_data = None
    if quant_cols and quant_rows:
        import pandas as pd
        quant_data = {"columns": quant_cols, "rows": [list(r) for r in quant_rows]}
        with st.expander("Ver datos cuantitativos"):
            st.dataframe(pd.DataFrame(quant_rows, columns=quant_cols), use_container_width=True)

    qual_data = None
    if qual_cols and qual_rows:
        import pandas as pd
        qual_data = {"columns": qual_cols, "rows": [list(r) for r in qual_rows]}
        with st.expander("Ver datos cualitativos"):
            st.dataframe(pd.DataFrame(qual_rows, columns=qual_cols), use_container_width=True)

    st.session_state.sql_chat_messages.append({
        "role": "assistant", "content": summary,
        "quant_sql": quant_sql, "qual_sql": qual_sql,
        "quant_data": quant_data, "qual_data": qual_data,
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
            import pandas as pd
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
            st.dataframe(pd.DataFrame(display_data), use_container_width=True)
    if sql and sql.strip():
        with st.expander("Ver SQL complementario"):
            st.code(sql, language="sql")
        if sql_cols and sql_rows:
            import pandas as pd
            with st.expander("Ver datos SQL"):
                st.dataframe(pd.DataFrame(sql_rows, columns=sql_cols), use_container_width=True)

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
    for msg in st.session_state.sql_chat_messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
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
                        import pandas as pd
                        st.dataframe(pd.DataFrame(msg["search_data"]), use_container_width=True)
            if msg.get("search_sql"):
                with st.expander("Ver SQL complementario"):
                    st.code(msg["search_sql"], language="sql")
            # Data expanders
            if msg.get("raw_data"):
                with st.expander("Ver datos crudos"):
                    import pandas as pd
                    st.dataframe(
                        pd.DataFrame(msg["raw_data"]["rows"], columns=msg["raw_data"]["columns"]),
                        use_container_width=True,
                    )
            if msg.get("quant_data"):
                with st.expander("Ver datos cuantitativos"):
                    import pandas as pd
                    st.dataframe(
                        pd.DataFrame(msg["quant_data"]["rows"], columns=msg["quant_data"]["columns"]),
                        use_container_width=True,
                    )
            if msg.get("qual_data"):
                with st.expander("Ver datos cualitativos"):
                    import pandas as pd
                    st.dataframe(
                        pd.DataFrame(msg["qual_data"]["rows"], columns=msg["qual_data"]["columns"]),
                        use_container_width=True,
                    )
            if msg.get("search_sql_data"):
                with st.expander("Ver datos SQL"):
                    import pandas as pd
                    st.dataframe(
                        pd.DataFrame(msg["search_sql_data"]["rows"], columns=msg["search_sql_data"]["columns"]),
                        use_container_width=True,
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
                    _handle_hybrid(client, question, content)
                    return

                # --- SEARCH ---
                if mode == "search":
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

                columns, rows = [], []
                exec_error = None
                try:
                    columns, rows = execute_query(sql)
                except Exception as e:
                    exec_error = str(e)

                if exec_error:
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
            if columns and rows:
                import pandas as pd
                raw_data = {"columns": columns, "rows": [list(r) for r in rows]}
                with st.expander("Ver datos crudos"):
                    st.dataframe(pd.DataFrame(rows, columns=columns), use_container_width=True)

            st.session_state.sql_chat_messages.append({
                "role": "assistant", "content": summary, "sql": sql, "raw_data": raw_data,
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
