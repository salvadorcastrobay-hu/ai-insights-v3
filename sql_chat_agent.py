"""
Chat SQL Agent con IA — Preguntas en lenguaje natural sobre datos de insights.

Flujo:
1. Usuario escribe pregunta en español
2. GPT-4o decide si responder conversacionalmente (CHAT:) o generar SQL (SQL:)
3. Si SQL: se valida que sea solo SELECT, se ejecuta contra PostgreSQL read-only,
   GPT-4o resume los resultados en lenguaje natural ejecutivo
4. Se muestra: respuesta + SQL colapsable + datos crudos colapsables
"""

from __future__ import annotations

import os
import re

import psycopg2
import psycopg2.extras
import streamlit as st
from openai import OpenAI


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
Eres un asistente de datos para el equipo de liderazgo de Humand. Tu trabajo es \
ayudar al usuario respondiendo preguntas de negocio con datos reales o manteniendo \
una conversacion amigable y profesional.

## Modos de respuesta

Debes responder en exactamente uno de estos dos formatos:

**Modo SQL** — cuando el usuario hace una pregunta que requiere consultar datos:
SQL:
SELECT ...

**Modo CHAT** — cuando el usuario saluda, agradece, hace una pregunta general \
que no requiere datos, o pide aclaracion:
CHAT:
Tu respuesta conversacional aqui.

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
- competitor_name, competitor_relationship ('currently_using'|'evaluating'|'migrating_from'|'comparing'|'mentioned'|'previously_used')
- competitor_relationship_display
- feature_name (codigo), feature_display (nombre legible), feature_is_seed (boolean)
- gap_description, gap_priority ('must_have'|'nice_to_have'|'dealbreaker')
- summary, verbatim_quote, confidence (0-1)
- model_used, prompt_version, batch_id, processed_at

### Tabla: raw_deals
- deal_id, deal_name, deal_stage, pipeline, amount
- create_date, close_date, owner_name, ae_owner_name
- country, region, segment, industry

### Tabla: raw_companies
- company_id, name, domain, industry, company_size, country, region

## Valores clave de enums
- insight_type: pain, product_gap, competitive_signal, deal_friction, faq
- insight_type_display: 'Dolor / Problema', 'Feature Faltante', 'Senal Competitiva', 'Friccion del Deal', 'Pregunta Frecuente'
- gap_priority: must_have, nice_to_have, dealbreaker
- competitor_relationship: currently_using, evaluating, migrating_from, comparing, mentioned, previously_used
- module_status: existing, missing
- pain_scope: general, module_linked
- segment: valores tipicos como 'Enterprise', 'Mid-Market', 'SMB', etc.

## Ejemplos de preguntas y SQL

Pregunta: "Cuales son los top 10 pains mas frecuentes?"
SQL:
SELECT insight_subtype_display AS pain, COUNT(*) AS frecuencia
FROM v_insights_dashboard
WHERE insight_type = 'pain'
GROUP BY insight_subtype_display
ORDER BY frecuencia DESC
LIMIT 10;

Pregunta: "Que competidores aparecen en deals Enterprise?"
SQL:
SELECT competitor_name, competitor_relationship_display, COUNT(*) AS menciones
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal' AND segment = 'Enterprise'
  AND competitor_name IS NOT NULL
GROUP BY competitor_name, competitor_relationship_display
ORDER BY menciones DESC
LIMIT 20;

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

Pregunta: "Que features faltantes son dealbreaker?"
SQL:
SELECT feature_display, COUNT(*) AS menciones,
       COUNT(DISTINCT deal_id) AS deals, SUM(amount) AS revenue
FROM v_insights_dashboard
WHERE insight_type = 'product_gap' AND gap_priority = 'dealbreaker'
  AND feature_display IS NOT NULL
GROUP BY feature_display
ORDER BY menciones DESC
LIMIT 15;

## Reglas estrictas
1. Solo genera sentencias SELECT o WITH ... SELECT. NUNCA generes INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, COPY ni ningun otro comando que modifique datos.
2. Siempre incluye LIMIT (maximo 50 filas).
3. Usa las columnas _display para valores legibles (insight_subtype_display, module_display, etc.).
4. Responde siempre en espanol.
5. Si la pregunta no se puede responder con los datos disponibles, dilo claramente usando modo CHAT.
6. Para calcular revenue, usa SUM(DISTINCT amount) cuando agrupes por deal_id, o haz un subquery/CTE para evitar duplicados.
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
# Response parsing
# ---------------------------------------------------------------------------

def _parse_response(raw: str) -> tuple[str, str]:
    """Parse a GPT response into (mode, content).

    Returns ("sql", sql_text) or ("chat", chat_text).
    """
    stripped = raw.strip()

    if stripped.upper().startswith("SQL:"):
        sql_text = stripped[4:].strip()
        # Strip markdown code fences if present
        fence_match = re.search(r"```(?:sql)?\s*\n(.*?)```", sql_text, re.DOTALL)
        if fence_match:
            sql_text = fence_match.group(1).strip()
        return "sql", sql_text

    if stripped.upper().startswith("CHAT:"):
        return "chat", stripped[5:].strip()

    # Fallback heuristic: if it contains SELECT/WITH, treat as SQL
    if re.search(r"\b(SELECT|WITH)\b", stripped, re.IGNORECASE):
        fence_match = re.search(r"```(?:sql)?\s*\n(.*?)```", stripped, re.DOTALL)
        if fence_match:
            return "sql", fence_match.group(1).strip()
        sql_match = re.search(r"((?:SELECT|WITH)\b.*)", stripped, re.DOTALL | re.IGNORECASE)
        if sql_match:
            return "sql", sql_match.group(1).strip()

    return "chat", stripped


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
        max_tokens=1024,
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


# ---------------------------------------------------------------------------
# Database execution
# ---------------------------------------------------------------------------

def execute_query(sql: str) -> tuple[list[str], list[tuple]]:
    """Execute a read-only SQL query against PostgreSQL.

    Returns (columns, rows). Raises on error.
    """
    database_url = _get_secret_optional("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "Falta configurar DATABASE_URL en los Secrets de Streamlit Cloud. "
            "Usa la URL del Transaction Pooler de Supabase."
        )
    # Strip any existing sslmode from URL to avoid conflicts
    database_url = re.sub(r"[?&]sslmode=[^&]*", "", database_url)
    sep = "&" if "?" in database_url else "?"
    database_url = f"{database_url}{sep}sslmode=require"
    conn = psycopg2.connect(database_url)
    try:
        conn.set_session(readonly=True, autocommit=True)
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '15s';")
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description] if cur.description else []
            rows = cur.fetchall() if cur.description else []
        return columns, rows
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Streamlit page
# ---------------------------------------------------------------------------

MAX_HISTORY = 12  # Keep last N messages for OpenAI context


def page_sql_chat(df) -> None:
    """Streamlit page: Chat con IA."""
    st.header("Chat con IA")
    st.caption(
        "Hace preguntas en lenguaje natural sobre insights, deals y competidores. "
        "Las respuestas se basan en datos reales de la base de datos."
    )

    # --- Session state init ---
    if "sql_chat_messages" not in st.session_state:
        st.session_state.sql_chat_messages = []
    if "sql_chat_openai_history" not in st.session_state:
        st.session_state.sql_chat_openai_history = []

    # --- Sidebar: clear chat ---
    if st.sidebar.button("Limpiar chat", key="clear_sql_chat"):
        st.session_state.sql_chat_messages = []
        st.session_state.sql_chat_openai_history = []
        st.rerun()

    # --- Render chat history ---
    for msg in st.session_state.sql_chat_messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            if msg.get("sql"):
                with st.expander("Ver SQL"):
                    st.code(msg["sql"], language="sql")
            if msg.get("raw_data"):
                with st.expander("Ver datos crudos"):
                    import pandas as pd
                    st.dataframe(
                        pd.DataFrame(msg["raw_data"]["rows"], columns=msg["raw_data"]["columns"]),
                        use_container_width=True,
                    )

    # --- Chat input ---
    question = st.chat_input("Escribi tu pregunta sobre los datos...")
    if not question:
        return

    # Show user message
    st.session_state.sql_chat_messages.append({"role": "user", "content": question})
    with st.chat_message("user"):
        st.markdown(question)

    # --- Process ---
    with st.chat_message("assistant"):
        try:
            with st.spinner("Pensando..."):
                client = _get_openai_client()

                # 1. Generate response (SQL or CHAT)
                try:
                    mode, content = generate_response(
                        client, question, st.session_state.sql_chat_openai_history,
                    )
                except Exception:
                    response_text = "No pude conectarme con el servicio de IA. Intenta de nuevo en unos segundos."
                    st.markdown(response_text)
                    st.session_state.sql_chat_messages.append(
                        {"role": "assistant", "content": response_text}
                    )
                    return

                # --- CHAT mode: respond directly, no SQL ---
                if mode == "chat":
                    st.markdown(content)
                    st.session_state.sql_chat_messages.append(
                        {"role": "assistant", "content": content}
                    )
                    st.session_state.sql_chat_openai_history.append(
                        {"role": "user", "content": question}
                    )
                    st.session_state.sql_chat_openai_history.append(
                        {"role": "assistant", "content": content}
                    )
                    _trim_history()
                    return

                # --- SQL mode: validate → execute → summarize ---
                sql = content

                # 2. Validate SQL
                valid, err = validate_sql(sql)
                if not valid:
                    response_text = f"No puedo ejecutar esa consulta: {err}"
                    st.markdown(response_text)
                    st.session_state.sql_chat_messages.append(
                        {"role": "assistant", "content": response_text}
                    )
                    st.session_state.sql_chat_openai_history.append(
                        {"role": "user", "content": question}
                    )
                    st.session_state.sql_chat_openai_history.append(
                        {"role": "assistant", "content": response_text}
                    )
                    _trim_history()
                    return

                # 3. Execute query (with 1 retry on error)
                columns, rows = [], []
                exec_error = None
                try:
                    columns, rows = execute_query(sql)
                except Exception as e:
                    exec_error = str(e)

                # Auto-retry: pass the error back to GPT-4o for a corrected query
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
                        response_text = "Hubo un error al generar la consulta. Intenta reformular tu pregunta."
                        st.markdown(response_text)
                        st.session_state.sql_chat_messages.append(
                            {"role": "assistant", "content": response_text}
                        )
                        _trim_history()
                        return

                    valid, err = validate_sql(sql)
                    if not valid:
                        response_text = f"No pude generar una consulta valida: {err}"
                        st.markdown(response_text)
                        st.session_state.sql_chat_messages.append(
                            {"role": "assistant", "content": response_text}
                        )
                        _trim_history()
                        return

                    try:
                        columns, rows = execute_query(sql)
                    except Exception as e2:
                        response_text = f"La consulta fallo incluso despues de reintentar: {e2}"
                        st.markdown(response_text)
                        st.session_state.sql_chat_messages.append(
                            {"role": "assistant", "content": response_text}
                        )
                        _trim_history()
                        return

                # 4. Summarize results
                try:
                    summary = summarize_results(client, question, sql, columns, rows)
                except Exception:
                    summary = "No pude generar el resumen, pero los datos se consultaron correctamente. Revisa los datos crudos abajo."

            # 5. Display
            st.markdown(summary)
            with st.expander("Ver SQL"):
                st.code(sql, language="sql")

            raw_data = None
            if columns and rows:
                import pandas as pd
                raw_data = {"columns": columns, "rows": [list(r) for r in rows]}
                with st.expander("Ver datos crudos"):
                    st.dataframe(
                        pd.DataFrame(rows, columns=columns),
                        use_container_width=True,
                    )

            # --- Update state ---
            st.session_state.sql_chat_messages.append({
                "role": "assistant",
                "content": summary,
                "sql": sql,
                "raw_data": raw_data,
            })
            st.session_state.sql_chat_openai_history.append(
                {"role": "user", "content": question}
            )
            st.session_state.sql_chat_openai_history.append(
                {"role": "assistant", "content": f"SQL: {sql}\nResultado resumido: {summary}"}
            )
            _trim_history()

        except Exception:
            response_text = "Ocurrio un error inesperado. Intenta de nuevo."
            st.markdown(response_text)
            st.session_state.sql_chat_messages.append(
                {"role": "assistant", "content": response_text}
            )


def _trim_history() -> None:
    """Keep only the last MAX_HISTORY messages in OpenAI history."""
    h = st.session_state.sql_chat_openai_history
    if len(h) > MAX_HISTORY:
        st.session_state.sql_chat_openai_history = h[-MAX_HISTORY:]
