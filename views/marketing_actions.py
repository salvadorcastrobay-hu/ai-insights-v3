"""
Marketing Campaign Advisor - Vista de Streamlit.

Genera recomendaciones de campana basadas en datos reales
del pipeline y transcripts de demos. Solo visible para usuarios admin.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
import hashlib
import json
import os
import re
import unicodedata

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from exp_ds import DS, ds_sub, inject_ds_css
from src.connectors.campaign_advisor_store import (
    create_conversation,
    insert_message,
    insert_snapshot,
    list_conversations,
    load_conversation,
)
from src.skills.market_filters import CANONICAL_REGION_OPTIONS

inject_ds_css()

REGION_OPTIONS = CANONICAL_REGION_OPTIONS
SEGMENT_OPTIONS = ["", "SMB", "Mid Market", "Enterprise"]
DEFAULT_LOOKBACK_DAYS = 180
REGION_LABELS = {
    "": "Todas",
    "HISPAM": "HISPAM",
    "Brazil": "Brazil",
    "EMEA": "EMEA",
    "ANGLO AMERICA": "Anglo America",
    "APAC": "APAC",
    "MENA": "MENA",
}

QUESTION_INDUSTRY_ALIASES = {
    "Retail": ["retail", "varejo"],
    "Manufacturing": ["manufacturing", "manufactura", "manufatura"],
    "Healthcare": ["healthcare", "salud", "saude", "health care"],
    "Technology": ["technology", "tecnologia", "tech"],
    "Construction": ["construction", "construccion", "construcao"],
    "Logistics": ["logistics", "logistica", "logistica"],
}

QUESTION_COUNTRY_ALIASES = {
    "Argentina": ["argentina"],
    "Brasil": ["brasil", "brazil"],
    "Chile": ["chile"],
    "Colombia": ["colombia"],
    "Mexico": ["mexico", "méxico"],
    "Peru": ["peru", "peru", "perú"],
    "Spain": ["spain", "espana", "españa"],
    "United States": ["united states", "usa", "us"],
    "Canada": ["canada"],
}

QUESTION_REGION_ALIASES = {
    "HISPAM": ["latam", "hispam"],
    "Brazil": ["brazil region", "brasil region"],
    "EMEA": ["emea"],
    "ANGLO AMERICA": ["north america", "namer", "anglo america", "na"],
    "APAC": ["apac"],
    "MENA": ["mena"],
}

QUESTION_SEGMENT_ALIASES = {
    "SMB": ["smb", "small business"],
    "Mid Market": ["mid market", "mid-market"],
    "Enterprise": ["enterprise", "large enterprise"],
}
ANSWER_LANGUAGE_OPTIONS = {
    "original": "Original",
    "es": "Español",
    "en": "English",
    "pt-BR": "Português",
}
FILTER_COLUMNS = {
    "industry": "industry",
    "country": "country",
    "deal_stage": "deal_stage",
}


def _get_agent():
    from src.agents.marketing_advisor import MarketingAdvisorAgent

    return MarketingAdvisorAgent()


def _get_current_user() -> str:
    user = st.session_state.get("username") or st.session_state.get("name")
    if not user:
        raise RuntimeError("No se encontro el usuario autenticado para guardar historial.")
    return str(user).strip()


def _get_current_user_candidates() -> list[str]:
    values = []
    for key in ("username", "name"):
        value = st.session_state.get(key)
        cleaned = str(value or "").strip()
        if cleaned and cleaned not in values:
            values.append(cleaned)
    if not values:
        raise RuntimeError("No se encontro el usuario autenticado para cargar historial.")
    return values


def _resolve_model_label() -> str:
    return os.getenv("OPENAI_MARKETING_MODEL") or "gpt-5.4"


def _normalize_search_text(value: str) -> str:
    lowered = " ".join((value or "").strip().lower().split())
    ascii_text = "".join(
        ch for ch in unicodedata.normalize("NFKD", lowered) if not unicodedata.combining(ch)
    )
    return f" {ascii_text} "


def _contains_alias(haystack: str, alias: str) -> bool:
    normalized_alias = _normalize_search_text(alias).strip()
    if not normalized_alias:
        return False
    pattern = rf"(?<!\w){re.escape(normalized_alias)}(?!\w)"
    return re.search(pattern, haystack.strip()) is not None


def _match_alias_map(question: str, aliases: dict[str, list[str]]) -> str | None:
    normalized_question = _normalize_search_text(question)
    for canonical, options in aliases.items():
        for alias in options:
            if _contains_alias(normalized_question, alias):
                return canonical
    return None


def _infer_filters_from_question(question: str) -> dict:
    if not question or not question.strip():
        return {}
    return {
        "industry": _match_alias_map(question, QUESTION_INDUSTRY_ALIASES),
        "country": _match_alias_map(question, QUESTION_COUNTRY_ALIASES),
        "region": _match_alias_map(question, QUESTION_REGION_ALIASES),
        "segment": _match_alias_map(question, QUESTION_SEGMENT_ALIASES),
    }


def _merge_question_filters(filters: dict, question: str) -> tuple[dict, dict]:
    inferred = _infer_filters_from_question(question)
    merged = dict(filters)
    for key, value in inferred.items():
        if value and not merged.get(key):
            merged[key] = value
    return merged, {key: value for key, value in inferred.items() if value}


def _normalize_date_input(value, label: str) -> str | None:
    if value in (None, ""):
        return None

    if isinstance(value, datetime):
        return value.date().isoformat()

    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return date.fromisoformat(raw).isoformat()
        except ValueError as exc:
            raise ValueError(f"{label} debe estar en formato YYYY-MM-DD.") from exc

    raise ValueError(f"{label} no tiene un formato de fecha valido.")


def _date_widget_value(key: str) -> date | None:
    value = st.session_state.get(key)
    if value in (None, ""):
        if key == "ma_start_date":
            return date.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)
        if key == "ma_end_date":
            return date.today()
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    return None


def _read_filters() -> dict:
    start_raw = st.session_state.get("ma_start_date")
    end_raw = st.session_state.get("ma_end_date")
    if start_raw in (None, ""):
        start_raw = date.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)
    if end_raw in (None, ""):
        end_raw = date.today()

    start_date = _normalize_date_input(start_raw, "Fecha desde")
    end_date = _normalize_date_input(end_raw, "Fecha hasta")
    if start_date and end_date and start_date > end_date:
        raise ValueError("Fecha desde no puede ser mayor que fecha hasta.")
    return {
        "industry": _normalize_filter_values(st.session_state.get("ma_industry")),
        "country": _normalize_filter_values(st.session_state.get("ma_country")),
        "region": _normalize_filter_values(st.session_state.get("ma_region")),
        "segment": _normalize_filter_values(st.session_state.get("ma_segment")),
        "deal_stage": _normalize_filter_values(st.session_state.get("ma_deal_stage")),
        "start_date": start_date,
        "end_date": end_date,
    }


def _format_filter_summary(filters: dict) -> list[str]:
    labels = {
        "industry": "Industria",
        "country": "Pais",
        "region": "Region",
        "segment": "Segmento",
        "deal_stage": "Etapa",
        "start_date": "Desde",
        "end_date": "Hasta",
    }
    out = []
    for key, value in filters.items():
        if not value:
            continue
        out.append(f"{labels[key]}: {_format_filter_value(key, value)}")
    return out or ["Sin filtros"]


def _normalize_filter_values(value):
    if value in (None, "", []):
        return None
    if isinstance(value, list):
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        return cleaned or None
    cleaned = str(value).strip()
    return [cleaned] if cleaned else None


def _format_filter_value(key: str, value) -> str:
    if isinstance(value, list):
        items = value
    else:
        items = [value]
    formatted = []
    for item in items:
        if key == "region":
            formatted.append(REGION_LABELS.get(item, item))
        else:
            formatted.append(str(item))
    return ", ".join(formatted)


def _get_filter_options(filter_key: str) -> list[str]:
    if filter_key == "region":
        return [value for value in REGION_OPTIONS if value]
    if filter_key == "segment":
        return [value for value in SEGMENT_OPTIONS if value]

    df = st.session_state.get("df")
    column = FILTER_COLUMNS.get(filter_key)
    if df is None or getattr(df, "empty", True) or not column or column not in df.columns:
        return []
    values = sorted({str(value).strip() for value in df[column].dropna().tolist() if str(value).strip()})
    return values


def _slugify_filename(value: str) -> str:
    normalized = "".join(
        ch for ch in unicodedata.normalize("NFKD", value.lower()) if not unicodedata.combining(ch)
    )
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return normalized or "campaign-advisor"


def _recommendation_to_markdown(rec) -> str:
    lines = ["# Campaign Advisor", ""]
    lines.append(rec.segment_summary)
    lines.append("")
    lines.append("## Metadata")
    lines.append(f"- Confianza: {rec.data_confidence}")
    lines.append(f"- Muestra: {rec.sample_size}")
    lines.append(f"- Modelo: {rec.model_used or _resolve_model_label()}")
    lines.append(f"- Idioma: {rec.recommended_market_language or '-'}")
    if rec.freshness_window:
        lines.append(f"- Ventana temporal: {rec.freshness_window}")
    if rec.confidence_reason:
        lines.append(f"- Lectura de confianza: {rec.confidence_reason}")
    if rec.market_tone:
        lines.append(f"- Tono recomendado: {rec.market_tone}")
    filter_summary = _format_filter_summary(rec.filters_applied)
    if filter_summary:
        lines.append(f"- Filtros usados: {' | '.join(filter_summary)}")
    lines.append("")

    if rec.qualification_summary:
        lines.append("## Qué validar antes de lanzar")
        lines.extend(f"- {item}" for item in rec.qualification_summary)
        lines.append("")

    lines.append("## Ángulos recomendados")
    for angle in rec.recommended_angles:
        lines.append("")
        lines.append(f"### #{angle.rank} {angle.title}")
        lines.append(f"- Tipo: {angle.action_type.replace('_', ' ')}")
        lines.append(f"- Prioridad: {angle.priority}")
        lines.append(f"- Listo para lanzar: {'Si' if angle.launch_readiness == 'ready_now' else 'Validar'}")
        if angle.channels:
            lines.append(f"- Canales: {', '.join(angle.channels)}")
        lines.append(f"- Target: {angle.target_audience}")
        lines.append(f"- Hero: {angle.hero_message}")
        lines.append(f"- Mensaje clave: {angle.core_message}")
        lines.append(f"- Pain principal: {angle.key_pain_addressed}")
        lines.append("")
        lines.append("#### Justificación con datos")
        lines.append(angle.supporting_data)
        if angle.rationale:
            lines.append("")
            lines.append(angle.rationale)
        if angle.qualification_checks:
            lines.append("")
            lines.append("#### Chequeos de calificación")
            lines.extend(f"- {item}" for item in angle.qualification_checks)
        if angle.content_ideas:
            lines.append("")
            lines.append("#### Ideas de contenido")
            lines.extend(f"- {item}" for item in angle.content_ideas)

    if rec.what_not_to_do:
        lines.append("")
        lines.append("## Qué no priorizar ahora")
        lines.extend(f"- {item}" for item in rec.what_not_to_do)

    return "\n".join(lines).strip() + "\n"


def _recommendation_to_full_answer(rec) -> str:
    lines = [rec.segment_summary, ""]
    lines.append("## Snapshot")
    lines.append(f"- Confianza: {rec.data_confidence}")
    lines.append(f"- Muestra: {rec.sample_size}")
    lines.append(f"- Modelo: {rec.model_used or _resolve_model_label()}")
    lines.append(f"- Idioma: {rec.recommended_market_language or '-'}")
    if rec.freshness_window:
        lines.append(f"- Ventana temporal efectiva: {rec.freshness_window}")
    filter_summary = _format_filter_summary(rec.filters_applied)
    if filter_summary:
        lines.append(f"- Filtros usados: {' | '.join(filter_summary)}")
    if rec.confidence_reason:
        lines.append(f"- Lectura de confianza: {rec.confidence_reason}")
    if rec.market_tone:
        lines.append(f"- Tono recomendado: {rec.market_tone}")
    lines.append("")

    if rec.qualification_summary:
        lines.append("## Qué validar antes de lanzar")
        lines.extend(f"- {item}" for item in rec.qualification_summary)
        lines.append("")

    lines.append("## Ángulos recomendados")
    for angle in rec.recommended_angles:
        lines.append("")
        lines.append(f"### #{angle.rank} {angle.title}")
        lines.append(f"- Tipo: {angle.action_type.replace('_', ' ')}")
        lines.append(f"- Prioridad: {angle.priority}")
        lines.append(f"- Listo para lanzar: {'Sí' if angle.launch_readiness == 'ready_now' else 'Validar'}")
        if angle.channels:
            lines.append(f"- Canales: {', '.join(angle.channels)}")
        lines.append(f"- Target: {angle.target_audience}")
        lines.append(f"- Hero: {angle.hero_message}")
        lines.append(f"- Mensaje clave: {angle.core_message}")
        lines.append(f"- Pain principal: {angle.key_pain_addressed}")
        lines.append("")
        lines.append("#### Justificación con datos")
        lines.append(angle.supporting_data)
        if angle.rationale:
            lines.append("")
            lines.append(angle.rationale)
        if angle.qualification_checks:
            lines.append("")
            lines.append("#### Chequeos de calificación")
            lines.extend(f"- {item}" for item in angle.qualification_checks)
        if angle.content_ideas:
            lines.append("")
            lines.append("#### Ideas de contenido")
            lines.extend(f"- {item}" for item in angle.content_ideas)

    if rec.what_not_to_do:
        lines.append("")
        lines.append("## Qué no priorizar ahora")
        lines.extend(f"- {item}" for item in rec.what_not_to_do)

    return "\n".join(lines).strip()


def _render_title() -> None:
    st.header("Campaign Advisor")
    st.caption(
        "OpenAI-based advisor para traducir pains, FAQs, gaps y senales competitivas en una campana priorizada."
    )


def _render_methodology(methodology: list[str], filters: dict) -> None:
    ds_sub("Plan de analisis")
    st.caption("Filtros activos: " + " | ".join(_format_filter_summary(filters)))
    st.markdown("\n".join(f"{step}" for step in methodology))


def _render_recommendation(rec) -> None:
    answer_markdown = _recommendation_to_full_answer(rec)
    container = st.container(border=True)
    with container:
        st.markdown(answer_markdown)


def _render_copy_md_button(markdown_export: str) -> None:
    payload = json.dumps(markdown_export, ensure_ascii=False)
    button_id = f"copy-md-{hashlib.md5(markdown_export.encode('utf-8')).hexdigest()[:8]}"
    components.html(
        f"""
        <html>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600&display=swap" rel="stylesheet">
          <style>
            html, body {{
              margin: 0;
              padding: 0;
              background: transparent;
            }}
            #{button_id} {{
              width: 100%;
              min-height: 40px;
              height: 40px;
              border: 1px solid {DS["neutral_200"]};
              border-radius: {DS["radius_m"]};
              background: {DS["bg_card"]};
              color: {DS["text_default"]};
              font-family: {DS["font"]};
              font-size: {DS["size_s"]};
              font-weight: 500;
              letter-spacing: 0.2px;
              cursor: pointer;
              box-sizing: border-box;
              transition: background-color 120ms ease, border-color 120ms ease;
            }}
            #{button_id}:hover {{
              background: {DS["brand_50"]};
              border-color: {DS["brand_100"]};
            }}
          </style>
        </head>
        <body>
        <button
          id="{button_id}"
          onclick='navigator.clipboard.writeText({payload})'
        >
          Copy md
        </button>
        </body>
        </html>
        """,
        height=40,
    )


def _get_display_recommendation(rec):
    selected_language = st.session_state.get("ma_answer_language", "original")
    if selected_language == "original":
        return rec

    translation_cache = st.session_state.setdefault("ma_translations", {})
    if selected_language not in translation_cache:
        agent = _get_agent()
        translation_cache[selected_language] = agent.translate_recommendation(rec, selected_language)
        st.session_state["ma_translations"] = translation_cache
    return translation_cache[selected_language]


def _render_followup_chat(display_rec, base_rec, pipeline, insights) -> None:
    history = st.session_state.setdefault("ma_chat_history", [])
    for item in history:
        with st.chat_message("user" if item.get("role") == "user" else "assistant"):
            st.markdown(item.get("content", ""))


def _reset_conversation_state() -> None:
    keys = (
        "ma_active_conversation_id",
        "ma_sidebar_conversation_choice",
        "ma_question",
        "ma_methodology",
        "ma_filters_snapshot",
        "ma_inferred_filters",
        "ma_recommendation",
        "ma_pipeline",
        "ma_insights",
        "ma_translations",
        "ma_chat_history",
        "ma_answer_language",
    )
    for key in keys:
        st.session_state.pop(key, None)


def _apply_loaded_conversation(payload: dict) -> None:
    snapshot = payload["snapshot"]
    messages = payload["messages"]
    followups = []
    for item in messages:
        if item.get("message_kind") != "followup":
            continue
        followups.append(
            {
                "role": item.get("role", "assistant"),
                "content": item.get("content", ""),
            }
        )

    st.session_state["ma_active_conversation_id"] = payload["conversation"]["id"]
    st.session_state["ma_question"] = snapshot.get("question") or payload["conversation"].get("initial_question", "")
    st.session_state["ma_filters_snapshot"] = dict(snapshot.get("filters") or {})
    st.session_state["ma_inferred_filters"] = dict(snapshot.get("inferred_filters") or {})
    st.session_state["ma_answer_language"] = snapshot.get("answer_language") or "original"
    st.session_state["ma_recommendation"] = payload["recommendation"]
    st.session_state["ma_pipeline"] = payload["pipeline"]
    st.session_state["ma_insights"] = payload["insights"]
    st.session_state["ma_chat_history"] = followups
    st.session_state["ma_translations"] = {}


def _render_saved_conversations() -> None:
    try:
        owner_candidates = _get_current_user_candidates()
        conversations = list_conversations(owner_candidates)
    except Exception as exc:
        st.sidebar.caption(f"Historial no disponible: {exc}")
        return

    st.markdown(
        """
        <style>
        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history {
            margin-left: 0.5rem;
            padding-left: 0.55rem;
            border-left: 1px solid rgba(49, 51, 63, 0.18);
        }

        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history [data-testid="stExpander"] {
            border: 0;
            box-shadow: none;
            background: transparent;
        }

        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history [data-testid="stExpander"] details {
            border: 0;
            background: transparent;
        }

        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history [data-testid="stExpander"] summary {
            padding-top: 0.1rem;
            padding-bottom: 0.1rem;
        }

        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history [data-testid="stExpander"] summary p {
            font-size: 0.88rem;
            font-weight: 500;
        }

        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history .stButton button {
            min-height: 1.95rem;
            font-size: 0.84rem;
            padding-top: 0.2rem;
            padding-bottom: 0.2rem;
        }

        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history [data-testid="stExpanderDetails"] {
            padding-top: 0.15rem;
        }

        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history .stSelectbox > div[data-baseweb="select"] > div {
            min-height: 2.15rem;
            font-size: 0.84rem;
        }

        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history .stMarkdown,
        div[data-testid="stVerticalBlock"].st-key-ma-sidebar-history .stCaption {
            margin-bottom: 0.2rem;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    with st.sidebar.container(key="ma-sidebar-history"):
        with st.expander("Chats", expanded=False):
            if st.button("Nuevo chat", key="ma-sidebar-new-chat", use_container_width=True):
                _reset_conversation_state()
                st.session_state["ma_sidebar_conversation_choice"] = "__new__"
                st.rerun()

            if not conversations:
                st.caption("Todavía no hay conversaciones guardadas.")
                return

            conversation_options = ["__new__"] + [conversation["id"] for conversation in conversations]
            active_conversation_id = st.session_state.get("ma_active_conversation_id")
            default_choice = active_conversation_id if active_conversation_id in conversation_options else "__new__"
            current_choice = st.session_state.get("ma_sidebar_conversation_choice", default_choice)
            if current_choice not in conversation_options:
                current_choice = default_choice

            labels = {
                "__new__": "Seleccionar chat...",
            }
            for conversation in conversations:
                title = conversation.get("title") or "Campaign Advisor"
                labels[conversation["id"]] = title

            selected_conversation_id = st.selectbox(
                "Abrir chat",
                options=conversation_options,
                key="ma_sidebar_conversation_choice",
                index=conversation_options.index(current_choice),
                label_visibility="collapsed",
                format_func=lambda conversation_id: labels.get(conversation_id, conversation_id),
            )

            if selected_conversation_id == "__new__":
                return

            if selected_conversation_id == active_conversation_id:
                return

            payload = load_conversation(owner_candidates, selected_conversation_id)
            if payload is None:
                st.warning("No se pudo cargar esa conversación.")
                return
            _apply_loaded_conversation(payload)
            st.rerun()


def _render_evidence(pipeline, insights) -> None:
    ds_sub("Evidence pack")

    if pipeline:
        top_a, top_b = st.columns(2)
        top_a.metric("Deals en el segmento", pipeline.total_deals)
        top_b.metric("Revenue total", f"${pipeline.total_revenue:,.0f}")

    tab_pipeline, tab_pains, tab_faqs, tab_modules, tab_comp, tab_gaps = st.tabs(
        ["Pipeline", "Pain points", "FAQs", "Modulos", "Competidores", "Feature gaps"]
    )

    with tab_pipeline:
        if pipeline and pipeline.by_stage:
            st.dataframe(pd.DataFrame(pipeline.by_stage), use_container_width=True, hide_index=True)
        else:
            st.info("No hay datos de pipeline para esta seleccion.")

    with tab_pains:
        if insights and insights.top_pains:
            st.dataframe(
                pd.DataFrame(insights.top_pains).drop(columns=["example_quote"], errors="ignore"),
                use_container_width=True,
                hide_index=True,
            )
        else:
            st.info("No se encontraron pains para este segmento.")

    with tab_faqs:
        if insights and insights.top_faqs:
            st.dataframe(pd.DataFrame(insights.top_faqs), use_container_width=True, hide_index=True)
        else:
            st.info("No se encontraron FAQs para este segmento.")

    with tab_modules:
        if insights and insights.top_modules:
            st.dataframe(pd.DataFrame(insights.top_modules), use_container_width=True, hide_index=True)
        else:
            st.info("No se encontraron modulos para este segmento.")

    with tab_comp:
        if insights and insights.competitors:
            st.dataframe(pd.DataFrame(insights.competitors), use_container_width=True, hide_index=True)
        else:
            st.info("No se encontraron competidores para este segmento.")

    with tab_gaps:
        if insights and insights.top_gaps:
            st.dataframe(pd.DataFrame(insights.top_gaps), use_container_width=True, hide_index=True)
        else:
            st.info("No se encontraron feature gaps para este segmento.")


def _run_methodology() -> None:
    agent = _get_agent()
    question = st.session_state.get("ma_question", "")
    filters, inferred = _merge_question_filters(_read_filters(), question)
    st.session_state["ma_methodology"] = agent.expose_methodology(filters)
    st.session_state["ma_filters_snapshot"] = filters
    st.session_state["ma_inferred_filters"] = inferred
    for key in (
        "ma_active_conversation_id",
        "ma_recommendation",
        "ma_pipeline",
        "ma_insights",
        "ma_translations",
        "ma_chat_history",
    ):
        st.session_state.pop(key, None)


def _run_generation() -> None:
    owner = _get_current_user()
    question = st.session_state.get("ma_question", "")
    filters = st.session_state.get("ma_filters_snapshot")
    if not filters:
        filters, inferred = _merge_question_filters(_read_filters(), question)
        st.session_state["ma_filters_snapshot"] = filters
        st.session_state["ma_inferred_filters"] = inferred
    inferred = st.session_state.get("ma_inferred_filters", {})
    agent = _get_agent()
    pipeline, insights = agent.build_context(filters)
    st.session_state["ma_pipeline"] = pipeline
    st.session_state["ma_insights"] = insights
    st.session_state["ma_translations"] = {}
    st.session_state["ma_chat_history"] = []
    st.session_state["ma_answer_language"] = "original"
    st.session_state["ma_recommendation"] = agent.generate_recommendations(
        filters, question, pipeline, insights
    )
    conversation_id = create_conversation(owner, question, filters, inferred)
    st.session_state["ma_active_conversation_id"] = conversation_id
    insert_message(conversation_id, owner, "user", question, "initial_question")
    insert_message(
        conversation_id,
        owner,
        "assistant",
        _recommendation_to_full_answer(st.session_state["ma_recommendation"]),
        "recommendation",
    )
    insert_snapshot(
        conversation_id=conversation_id,
        owner=owner,
        question=question,
        filters=filters,
        inferred_filters=inferred,
        answer_language="original",
        recommendation=st.session_state["ma_recommendation"],
        pipeline=pipeline,
        insights=insights,
        snapshot_kind="recommendation",
    )


def _run_followup(prompt: str, display_rec, rec, pipeline, insights) -> None:
    owner = _get_current_user()
    conversation_id = st.session_state.get("ma_active_conversation_id")
    if not conversation_id:
        raise RuntimeError("No hay una conversación activa para guardar el follow-up.")
    history = st.session_state.setdefault("ma_chat_history", [])
    history.append({"role": "user", "content": prompt})
    insert_message(conversation_id, owner, "user", prompt, "followup")
    agent = _get_agent()
    answer = agent.answer_followup(
        prompt,
        rec,
        pipeline,
        insights,
        target_language=display_rec.recommended_market_language,
        chat_history=history[:-1],
    )
    history.append({"role": "assistant", "content": answer})
    insert_message(conversation_id, owner, "assistant", answer, "followup")
    st.session_state["ma_chat_history"] = history
    insert_snapshot(
        conversation_id=conversation_id,
        owner=owner,
        question=st.session_state.get("ma_question", ""),
        filters=st.session_state.get("ma_filters_snapshot", {}),
        inferred_filters=st.session_state.get("ma_inferred_filters", {}),
        answer_language=st.session_state.get("ma_answer_language", "original"),
        recommendation=rec,
        pipeline=pipeline,
        insights=insights,
        snapshot_kind="followup",
    )


_render_title()
st.markdown(
    f"""
    <style>
      div[data-testid="stVerticalBlock"].st-key-ma-content-area {{
        min-height: 56vh;
      }}
    </style>
    """,
    unsafe_allow_html=True,
)
with st.expander("Filtros", expanded=False):
    row1_col1, row1_col2, row1_col3 = st.columns(3)
    with row1_col1:
        st.multiselect(
            "Industria",
            options=_get_filter_options("industry"),
            key="ma_industry",
            placeholder="Elegí una o más industrias",
        )
    with row1_col2:
        st.multiselect(
            "País",
            options=_get_filter_options("country"),
            key="ma_country",
            placeholder="Elegí uno o más países",
        )
    with row1_col3:
        st.multiselect(
            "Región",
            options=_get_filter_options("region"),
            key="ma_region",
            format_func=lambda value: REGION_LABELS.get(value, value),
        )

    row2_col1, row2_col2, row2_col3 = st.columns(3)
    with row2_col1:
        st.multiselect(
            "Segmento",
            options=_get_filter_options("segment"),
            key="ma_segment",
        )
    with row2_col2:
        st.multiselect(
            "Etapa del deal",
            options=_get_filter_options("deal_stage"),
            key="ma_deal_stage",
            placeholder="Elegí una o más etapas",
        )
    with row2_col3:
        st.empty()

    date_left, date_right = st.columns(2)
    with date_left:
        st.date_input(
            "Desde",
            key="ma_start_date",
            value=_date_widget_value("ma_start_date"),
            format="YYYY-MM-DD",
        )
    with date_right:
        st.date_input(
            "Hasta",
            key="ma_end_date",
            value=_date_widget_value("ma_end_date"),
            format="YYYY-MM-DD",
        )

_render_saved_conversations()

status_placeholder = st.empty()
content_container = st.container(key="ma-content-area")

rec = st.session_state.get("ma_recommendation")
pipeline = st.session_state.get("ma_pipeline")
insights = st.session_state.get("ma_insights")
display_rec = rec
if rec and not rec.error:
    try:
        display_rec = _get_display_recommendation(rec)
    except RuntimeError as exc:
        st.warning(f"No se pudo traducir la respuesta: {exc}")

with content_container:
    if rec and rec.error:
        st.error(rec.error)
    elif rec:
        history = st.session_state.setdefault("ma_chat_history", [])
        current_question = (st.session_state.get("ma_question") or "").strip()
        if current_question and not history:
            with st.chat_message("user"):
                st.markdown(current_question)

        selector_col, action_col1, action_col2, spacer_col = st.columns(
            [0.24, 0.16, 0.16, 0.44],
            vertical_alignment="bottom",
        )
        with selector_col:
            st.selectbox(
                "Idioma de la respuesta",
                options=list(ANSWER_LANGUAGE_OPTIONS.keys()),
                key="ma_answer_language",
                format_func=lambda value: ANSWER_LANGUAGE_OPTIONS[value],
            )
        markdown_export = _recommendation_to_markdown(display_rec)
        file_label = display_rec.recommended_market_language or "original"
        filename = _slugify_filename(
            f"campaign-advisor-{file_label}-{'-'.join(_format_filter_summary(display_rec.filters_applied))}"
        )
        with action_col1:
            st.download_button(
                "Download md",
                data=markdown_export,
                file_name=f"{filename}.md",
                mime="text/markdown",
                use_container_width=True,
            )
        with action_col2:
            _render_copy_md_button(markdown_export)

        with st.expander("Evidence pack", expanded=False):
            _render_evidence(pipeline, insights)

        _render_recommendation(display_rec)
        _render_followup_chat(display_rec, rec, pipeline, insights)

prompt = st.chat_input("Escribí tu pregunta sobre la campaña, por ejemplo: Retail Brasil")
if prompt:
    try:
        with content_container:
            with st.chat_message("user"):
                st.markdown(prompt)
        if rec and not rec.error and display_rec:
            with status_placeholder.container():
                with st.spinner("Pensando la respuesta sobre el plan..."):
                    _run_followup(prompt, display_rec, rec, pipeline, insights)
            st.rerun()
        st.session_state["ma_question"] = prompt
        with status_placeholder.container():
            with st.spinner("Analizando el segmento y generando la recomendacion..."):
                _run_generation()
        st.rerun()
    except ValueError as exc:
        st.warning(str(exc))
    except RuntimeError as exc:
        st.error(f"Error de configuracion: {exc}")
    except Exception as exc:
        st.error(f"Error inesperado: {exc}")
