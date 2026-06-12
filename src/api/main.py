from __future__ import annotations

import html
import json
import os
import re
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlparse

import jwt
import urllib.request
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from openai import OpenAI
from sql_chat_agent import (
    execute_query,
    generate_response,
    set_requested_model,
    search_transcript_chunks,
    summarize_hybrid_results,
    summarize_results,
    summarize_search_results,
    validate_sql,
    _parse_search_content,
    _split_hybrid_queries,
)
from src.agents.marketing_advisor import MarketingAdvisorAgent
from src.connectors.campaign_advisor_store import (
    create_conversation as create_campaign_advisor_conversation,
    insert_message as insert_campaign_advisor_message,
    insert_snapshot as insert_campaign_advisor_snapshot,
    list_conversations as list_campaign_advisor_conversations,
    load_conversation as load_campaign_advisor_conversation,
    serialize_insights,
    serialize_pipeline,
    serialize_recommendation,
)
from src.connectors.sql_chat_store import (
    create_conversation as create_sql_chat_conversation,
    insert_message as insert_sql_chat_message,
    insert_snapshot as insert_sql_chat_snapshot,
    list_conversations as list_sql_chat_conversations,
    load_conversation as load_sql_chat_conversation,
)
from src.skills.pipeline_stats import get_pipeline_breakdown
from src.skills.segment_insights import get_segment_insights
from src.api.token_tracker import (
    check_quota,
    clear_request_context,
    get_usage_summary_for,
    record_external_usage,
    set_request_context,
)

app = FastAPI(title="Humand Insights API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "https://humand-insights-web.vercel.app")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Modelos permitidos en los selectores de chat (mirror del web lib/chat-models).
ALLOWED_CHAT_MODELS = {"gpt-4o-mini", "gpt-5.4-mini", "gpt-5.4"}


def resolve_chat_model(model: str | None) -> str | None:
    """Devuelve el modelo si está en el allowlist; si no, None (usa el default)."""
    return model if model in ALLOWED_CHAT_MODELS else None


class ChatQueryBody(BaseModel):
    question: str
    conversation_id: str | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)
    filters: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None


class ConversationPatchBody(BaseModel):
    title: str


class AdvisorGenerateBody(BaseModel):
    filters: dict[str, Any] = Field(default_factory=dict)
    question: str = ""
    conversation_id: str | None = None
    external_sources: list[str] = Field(default_factory=list)
    model: str | None = None


class AdvisorFollowupBody(BaseModel):
    conversation_id: str
    question: str
    target_language: str = ""
    chat_history: list[dict[str, Any]] = Field(default_factory=list)
    model: str | None = None


class AdvisorTranslateBody(BaseModel):
    conversation_id: str
    target_language: str


_JWKS_CLIENT: jwt.PyJWKClient | None = None


def _get_jwks_client() -> jwt.PyJWKClient:
    """Lazy, cached Supabase JWKS client (for asymmetric RS256/ES256 tokens)."""
    global _JWKS_CLIENT
    if _JWKS_CLIENT is None:
        base = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        if not base:
            raise HTTPException(status_code=500, detail="Missing env var: SUPABASE_URL")
        _JWKS_CLIENT = jwt.PyJWKClient(f"{base.rstrip('/')}/auth/v1/.well-known/jwks.json")
    return _JWKS_CLIENT


def _decode_token(token: str) -> dict[str, Any]:
    """Decode a Supabase JWT. Tries asymmetric JWKS first, falls back to HS256."""
    unverified_header = jwt.get_unverified_header(token)
    alg = unverified_header.get("alg", "HS256")
    common_kwargs = {"audience": "authenticated", "options": {"verify_aud": True}}

    if alg == "HS256":
        secret = os.environ.get("SUPABASE_JWT_SECRET")
        if not secret:
            raise HTTPException(status_code=500, detail="Missing env var: SUPABASE_JWT_SECRET")
        return jwt.decode(token, secret, algorithms=["HS256"], **common_kwargs)

    signing_key = _get_jwks_client().get_signing_key_from_jwt(token).key
    return jwt.decode(token, signing_key, algorithms=[alg], **common_kwargs)


def verify_jwt(authorization: str = Header(...)) -> str:
    """Return the owner identifier (Streamlit-compatible username = email local-part)."""
    try:
        token = authorization.replace("Bearer ", "").strip()
        payload = _decode_token(token)
        email = str(payload.get("email") or "").strip().lower()
        if email and "@" in email:
            # Match the Streamlit `config.yaml` username convention: juanba.scelzi@humand.co -> juanba.scelzi
            return email.split("@", 1)[0]
        return str(payload.get("sub") or "").strip()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - auth failures depend on runtime token
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/usage/me")
def usage_me(owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    """Token usage del user autenticado en ventanas 24h / 7d / 30d."""
    return get_usage_summary_for(owner)


@app.post("/usage/guard")
def usage_guard(owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    """Pre-check de cuota para calls de OpenAI hechas fuera del proceso Python
    (ej: /api/ask-chart de Next). Lanza 429 si el user superó algún cap;
    no-op si no tiene enforcement. Devuelve {ok:true} si puede seguir."""
    check_quota(owner)  # raises HTTPException(429) si superó el cap
    return {"ok": True}


class UsageLogBody(BaseModel):
    endpoint: str = "ask-chart"
    model: str = "unknown"
    input_tokens: int = 0
    output_tokens: int = 0


@app.post("/usage/log")
def usage_log(body: UsageLogBody, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    """Registra usage de una call a OpenAI hecha fuera del cliente parcheado.
    Lo llama /api/ask-chart después de streamear, para que el cap cuente
    también ese chat."""
    record_external_usage(
        owner=owner,
        endpoint=body.endpoint,
        model=body.model,
        input_tokens=body.input_tokens,
        output_tokens=body.output_tokens,
    )
    return {"ok": True}


_FILTER_LABELS: dict[str, str] = {
    "types": "Tipos de insight",
    "regions": "Regiones",
    "segments": "Segmentos",
    "countries": "Paises",
    "industries": "Industrias",
    "owners": "AEs / Deal owners",
    "modules": "Modulos",
    "categories": "Categorias HR",
    "channels": "Canales de adquisicion",
    "sources": "Fuentes de deal",
}


def _coerce_filter_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(v).strip() for v in value if str(v).strip()]
    text = str(value).strip()
    return [text] if text else []


def _format_filter_context(filters: dict[str, Any] | None) -> str:
    if not filters:
        return ""
    parts: list[str] = []
    for key, label in _FILTER_LABELS.items():
        values = _coerce_filter_list(filters.get(key))
        if values:
            parts.append(f"- {label}: {', '.join(values)}")
    date_start = filters.get("date_start") or filters.get("start_date")
    date_end = filters.get("date_end") or filters.get("end_date")
    if date_start:
        parts.append(f"- Fecha desde: {date_start}")
    if date_end:
        parts.append(f"- Fecha hasta: {date_end}")
    if not parts:
        return ""
    return (
        "FILTROS ACTIVOS DEL DASHBOARD (aplicalos como WHERE clauses cuando generes SQL, "
        "y usalos para encuadrar la respuesta):\n" + "\n".join(parts)
    )


_EXTERNAL_SOURCE_MAX_BYTES = 400_000  # ~400 KB raw HTML cap per URL
_EXTERNAL_SOURCE_TIMEOUT = 8  # seconds
_EXTERNAL_SOURCE_MAX_CHARS = 4000  # extracted text per URL
_EXTERNAL_SOURCE_MAX_URLS = 5


def _strip_html(html_text: str) -> str:
    """Quick-and-dirty HTML → plain text: drop scripts/styles, strip tags, collapse whitespace."""
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html_text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _fetch_external_source(url: str) -> tuple[str, str | None]:
    """Fetch a URL and return (excerpt, error). Excerpt is capped to _EXTERNAL_SOURCE_MAX_CHARS."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return "", f"URL inválida: {url}"
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "HumandInsightsAdvisor/1.0 (+https://humand.co)",
                "Accept": "text/html,text/plain,*/*;q=0.8",
            },
        )
        with urllib.request.urlopen(req, timeout=_EXTERNAL_SOURCE_TIMEOUT) as resp:
            content_type = resp.headers.get("Content-Type", "") or ""
            raw = resp.read(_EXTERNAL_SOURCE_MAX_BYTES)
    except Exception as exc:  # noqa: BLE001 — any network/SSL/etc error is reported back
        return "", f"No se pudo obtener {url}: {exc}"

    try:
        body = raw.decode("utf-8", errors="replace")
    except Exception:
        body = raw.decode("latin-1", errors="replace")

    if "text/html" in content_type or body.lstrip().startswith("<"):
        text = _strip_html(body)
    else:
        text = re.sub(r"\s+", " ", body).strip()

    if not text:
        return "", f"Contenido vacío en {url}"
    return text[:_EXTERNAL_SOURCE_MAX_CHARS], None


def _build_external_context(urls: list[str]) -> tuple[str, list[dict[str, str]], list[str]]:
    """Fetch each URL and return (context_block, source_records, warnings)."""
    seen: set[str] = set()
    clean: list[str] = []
    for raw in urls or []:
        if not raw:
            continue
        url = raw.strip()
        if not url or url in seen:
            continue
        seen.add(url)
        clean.append(url)
        if len(clean) >= _EXTERNAL_SOURCE_MAX_URLS:
            break

    warnings: list[str] = []
    records: list[dict[str, str]] = []
    blocks: list[str] = []
    for idx, url in enumerate(clean, start=1):
        excerpt, err = _fetch_external_source(url)
        if err:
            warnings.append(err)
            records.append({"url": url, "error": err})
            continue
        records.append({"url": url, "excerpt": excerpt})
        blocks.append(f"[Fuente externa {idx}] {url}\n{excerpt}")

    context = ""
    if blocks:
        context = (
            "REFERENCIAS EXTERNAS PROVISTAS POR EL USUARIO (material de contexto: "
            "campañas, artículos, notas, documentación, etc. Usalo para enriquecer tu "
            "razonamiento; no cites su contenido como dato propio):\n\n"
            + "\n\n".join(blocks)
        )
    return context, records, warnings


def _normalize_filters_payload(filters: dict[str, Any] | None) -> dict[str, Any]:
    """Return a compact, JSON-safe dict preserving only the filter keys we expose."""
    if not filters:
        return {}
    out: dict[str, Any] = {}
    for key in _FILTER_LABELS:
        values = _coerce_filter_list(filters.get(key))
        if values:
            out[key] = values
    for key in ("date_start", "date_end"):
        v = filters.get(key)
        if v:
            out[key] = str(v)
    return out


@app.post("/sql-chat/query")
def sql_chat_query(body: ChatQueryBody, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required.")

    # Token usage: setea contexto + chequea quota antes de hacer cualquier call.
    set_request_context(owner, "sql-chat")
    check_quota(owner)
    set_requested_model(resolve_chat_model(body.model))

    filters_payload = _normalize_filters_payload(body.filters)
    filter_context = _format_filter_context(filters_payload)

    existing_state = _load_sql_conversation_state(owner, body.conversation_id)
    conversation_id = body.conversation_id or _safe_create_sql_conversation(owner, question)
    history = body.history or existing_state["openai_history"]
    if filter_context:
        # Prepend as an additional system turn. generate_response already stacks
        # its own SYSTEM_PROMPT first, so OpenAI sees both in order.
        history = [{"role": "system", "content": filter_context}, *history]

    client = OpenAI()
    mode, content = generate_response(client, question, history)
    response = _execute_sql_chat_response(client, mode, content, question)
    if filters_payload:
        response["filters_applied"] = filters_payload

    user_message: dict[str, Any] = {"role": "user", "content": question}
    if filters_payload:
        user_message["filters_applied"] = filters_payload
    assistant_message = {"role": "assistant", **response}
    messages = existing_state["messages"] + [user_message, assistant_message]
    openai_history = history + [
        {"role": "user", "content": question},
        {"role": "assistant", "content": response.get("content", "")},
    ]

    warnings = list(response.get("warnings") or [])
    warnings.extend(_persist_sql_chat_state(conversation_id, owner, user_message, assistant_message, messages, openai_history))
    if warnings:
        response["warnings"] = warnings

    return {"conversation_id": conversation_id, **response}


@app.patch("/sql-chat/conversations/{conv_id}")
def rename_sql_conversation(
    conv_id: str,
    body: ConversationPatchBody,
    owner: str = Depends(verify_jwt),
) -> dict[str, Any]:
    new_title = body.title.strip()[:120]
    if not new_title:
        raise HTTPException(status_code=400, detail="Title is required.")
    try:
        from src.connectors.sql_chat_store import rename_conversation as _rename
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"Rename helper unavailable: {exc}") from exc
    try:
        ok = _rename(owner, conv_id, new_title)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to rename conversation: {exc}") from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"id": conv_id, "title": new_title}


@app.delete("/sql-chat/conversations/{conv_id}")
def delete_sql_conversation(conv_id: str, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    try:
        from src.connectors.sql_chat_store import delete_conversation as _delete
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"Delete helper unavailable: {exc}") from exc
    try:
        ok = _delete(owner, conv_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to delete conversation: {exc}") from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"id": conv_id, "deleted": True}


@app.get("/sql-chat/conversations")
def list_sql_conversations(
    limit: int = Query(default=20, ge=1, le=100),
    owner: str = Depends(verify_jwt),
) -> dict[str, Any]:
    try:
        return {"conversations": list_sql_chat_conversations(owner, limit)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to load SQL conversations: {exc}") from exc


@app.get("/sql-chat/conversations/{conv_id}")
def load_sql_conversation(conv_id: str, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    payload = load_sql_chat_conversation(owner, conv_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return _json_safe(payload)


@app.post("/campaign-advisor/generate")
def advisor_generate(body: AdvisorGenerateBody, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    set_request_context(owner, "campaign-advisor-generate")
    check_quota(owner)
    filters = dict(body.filters or {})
    question = body.question.strip()
    external_context, external_records, external_warnings = _build_external_context(body.external_sources)
    agent = MarketingAdvisorAgent(model=resolve_chat_model(body.model))
    pipeline = get_pipeline_breakdown(filters)
    insights = get_segment_insights(filters)
    recommendation = agent.generate_recommendations(
        filters,
        question,
        pipeline,
        insights,
        external_context=external_context,
    )

    conversation_id = body.conversation_id or _safe_create_advisor_conversation(owner, question, filters)
    assistant_summary = recommendation.segment_summary or "Recommendation generated."
    warnings = _persist_advisor_initial_state(
        conversation_id=conversation_id,
        owner=owner,
        question=question,
        filters=filters,
        recommendation=recommendation,
        pipeline=pipeline,
        insights=insights,
        assistant_summary=assistant_summary,
        external_sources=external_records,
    )
    warnings = list(warnings or []) + external_warnings

    response = {
        "conversation_id": conversation_id,
        "recommendation": serialize_recommendation(recommendation),
        "pipeline": serialize_pipeline(pipeline),
        "insights": serialize_insights(insights),
        "metadata": {
            "pipeline_deals": pipeline.total_deals,
            "pipeline_revenue": pipeline.total_revenue,
            "insight_sample_size": insights.sample_size,
        },
        "external_sources": external_records,
    }
    if warnings:
        response["warnings"] = warnings
    return response


@app.post("/campaign-advisor/followup")
def advisor_followup(body: AdvisorFollowupBody, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    set_request_context(owner, "campaign-advisor-followup")
    check_quota(owner)
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required.")

    conversation = _load_latest_advisor_snapshot(body.conversation_id, owner)
    recommendation = conversation.get("recommendation")
    pipeline = conversation.get("pipeline")
    insights = conversation.get("insights")
    if not recommendation or not pipeline or not insights:
        raise HTTPException(status_code=404, detail="Advisor snapshot not found for this conversation.")

    agent = MarketingAdvisorAgent(model=resolve_chat_model(body.model))
    answer = agent.answer_followup(
        body.question,
        recommendation,
        pipeline,
        insights,
        body.target_language,
        body.chat_history,
    )
    warnings = _persist_advisor_followup_message(body.conversation_id, owner, question, answer)
    response = {"conversation_id": body.conversation_id, "answer": answer}
    if warnings:
        response["warnings"] = warnings
    return response


@app.post("/campaign-advisor/translate")
def advisor_translate(body: AdvisorTranslateBody, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    set_request_context(owner, "campaign-advisor-translate")
    check_quota(owner)
    target_language = body.target_language.strip()
    if not target_language:
        raise HTTPException(status_code=400, detail="target_language is required.")

    conversation = _load_latest_advisor_snapshot(body.conversation_id, owner)
    recommendation = conversation.get("recommendation")
    pipeline = conversation.get("pipeline")
    insights = conversation.get("insights")
    snapshot = conversation.get("snapshot") or {}
    base_filters = snapshot.get("filters") or {}
    inferred_filters = snapshot.get("inferred_filters") or {}
    if not recommendation or not pipeline or not insights:
        raise HTTPException(status_code=404, detail="Advisor snapshot not found for this conversation.")

    agent = MarketingAdvisorAgent()
    translated = agent.translate_recommendation(recommendation, target_language)
    warnings = []
    try:
        insert_campaign_advisor_snapshot(
            conversation_id=body.conversation_id,
            owner=owner,
            question=snapshot.get("question") or "",
            filters=base_filters,
            inferred_filters=inferred_filters,
            answer_language=target_language,
            recommendation=translated,
            pipeline=pipeline,
            insights=insights,
            snapshot_kind="translation",
        )
        insert_campaign_advisor_message(
            body.conversation_id,
            owner,
            "assistant",
            f"Recommendation translated to {target_language}.",
            "translation",
        )
    except Exception as exc:
        warnings.append(f"Unable to persist translated recommendation: {exc}")

    response = {
        "conversation_id": body.conversation_id,
        "target_language": target_language,
        "recommendation": serialize_recommendation(translated),
        "pipeline": serialize_pipeline(pipeline),
        "insights": serialize_insights(insights),
    }
    if warnings:
        response["warnings"] = warnings
    return response


@app.patch("/campaign-advisor/conversations/{conv_id}")
def rename_advisor_conversation(
    conv_id: str,
    body: ConversationPatchBody,
    owner: str = Depends(verify_jwt),
) -> dict[str, Any]:
    new_title = body.title.strip()[:120]
    if not new_title:
        raise HTTPException(status_code=400, detail="Title is required.")
    try:
        from src.connectors.campaign_advisor_store import rename_conversation as _rename
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"Rename helper unavailable: {exc}") from exc
    try:
        ok = _rename(owner, conv_id, new_title)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to rename conversation: {exc}") from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"id": conv_id, "title": new_title}


@app.delete("/campaign-advisor/conversations/{conv_id}")
def delete_advisor_conversation(conv_id: str, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    try:
        from src.connectors.campaign_advisor_store import delete_conversation as _delete
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"Delete helper unavailable: {exc}") from exc
    try:
        ok = _delete(owner, conv_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to delete conversation: {exc}") from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"id": conv_id, "deleted": True}


@app.get("/campaign-advisor/conversations")
def list_advisor_conversations(
    limit: int = Query(default=20, ge=1, le=100),
    owner: str = Depends(verify_jwt),
) -> dict[str, Any]:
    try:
        return {"conversations": list_campaign_advisor_conversations(owner, limit)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to load advisor conversations: {exc}") from exc


@app.get("/campaign-advisor/conversations/{conv_id}")
def load_advisor_conversation(conv_id: str, owner: str = Depends(verify_jwt)) -> dict[str, Any]:
    payload = load_campaign_advisor_conversation(owner, conv_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    recommendation = payload.get("recommendation")
    pipeline = payload.get("pipeline")
    insights = payload.get("insights")
    return _json_safe(
        {
            "conversation": payload.get("conversation"),
            "snapshot": payload.get("snapshot"),
            "messages": payload.get("messages") or [],
            "recommendation": serialize_recommendation(recommendation) if recommendation else None,
            "pipeline": serialize_pipeline(pipeline) if pipeline else None,
            "insights": serialize_insights(insights) if insights else None,
        }
    )


def _safe_create_sql_conversation(owner: str, question: str) -> str:
    try:
        return create_sql_chat_conversation(owner, question)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to create SQL conversation: {exc}") from exc


def _safe_create_advisor_conversation(owner: str, question: str, filters: dict[str, Any]) -> str:
    try:
        # TODO: infer filter labels once the dedicated frontend filter schema is finalized.
        return create_campaign_advisor_conversation(owner, question or "Campaign Advisor", filters, {})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to create advisor conversation: {exc}") from exc


def _load_sql_conversation_state(owner: str, conversation_id: str | None) -> dict[str, list[dict[str, Any]]]:
    if not conversation_id:
        return {"messages": [], "openai_history": []}
    try:
        payload = load_sql_chat_conversation(owner, conversation_id) or {}
    except Exception:
        payload = {}
    return {
        "messages": list(payload.get("messages") or []),
        "openai_history": list(payload.get("openai_history") or []),
    }


def _persist_sql_chat_state(
    conversation_id: str,
    owner: str,
    user_message: dict[str, Any],
    assistant_message: dict[str, Any],
    messages: list[dict[str, Any]],
    openai_history: list[dict[str, Any]],
) -> list[str]:
    warnings: list[str] = []
    try:
        insert_sql_chat_message(conversation_id, owner, "user", user_message)
        insert_sql_chat_message(conversation_id, owner, "assistant", assistant_message)
        insert_sql_chat_snapshot(conversation_id, owner, messages, openai_history)
    except Exception as exc:
        warnings.append(f"Unable to persist SQL chat history: {exc}")
    return warnings


def _persist_advisor_initial_state(
    conversation_id: str,
    owner: str,
    question: str,
    filters: dict[str, Any],
    recommendation,
    pipeline,
    insights,
    assistant_summary: str,
    external_sources: list[dict[str, str]] | None = None,
) -> list[str]:
    warnings: list[str] = []
    inferred: dict[str, Any] = {}
    if external_sources:
        inferred["external_sources"] = external_sources
    try:
        if question:
            insert_campaign_advisor_message(conversation_id, owner, "user", question, "prompt")
        insert_campaign_advisor_message(
            conversation_id,
            owner,
            "assistant",
            assistant_summary,
            "recommendation",
        )
        insert_campaign_advisor_snapshot(
            conversation_id=conversation_id,
            owner=owner,
            question=question,
            filters=filters,
            inferred_filters=inferred,
            answer_language=recommendation.recommended_market_language,
            recommendation=recommendation,
            pipeline=pipeline,
            insights=insights,
            snapshot_kind="initial",
        )
    except Exception as exc:
        warnings.append(f"Unable to persist advisor recommendation: {exc}")
    return warnings


def _persist_advisor_followup_message(conversation_id: str, owner: str, question: str, answer: str) -> list[str]:
    warnings: list[str] = []
    try:
        insert_campaign_advisor_message(conversation_id, owner, "user", question, "followup")
        insert_campaign_advisor_message(conversation_id, owner, "assistant", answer, "followup_answer")
    except Exception as exc:
        warnings.append(f"Unable to persist advisor follow-up: {exc}")
    return warnings


def _load_latest_advisor_snapshot(conversation_id: str, owner: str) -> dict[str, Any]:
    # TODO: replace this with a direct snapshot lookup if we need a lighter read path.
    payload = load_campaign_advisor_conversation(owner, conversation_id) or {}
    return {
        "conversation": payload.get("conversation"),
        "snapshot": payload.get("snapshot"),
        "messages": payload.get("messages") or [],
        "recommendation": payload.get("recommendation"),
        "pipeline": payload.get("pipeline"),
        "insights": payload.get("insights"),
    }


def _execute_sql_chat_response(client: OpenAI, mode: str, content: str, question: str) -> dict[str, Any]:
    normalized_mode = (mode or "chat").lower()
    if normalized_mode == "chat":
        return {
            "mode": "chat",
            "content": content.strip() or "No pude generar una respuesta.",
        }
    if normalized_mode == "sql":
        return _execute_sql_mode(client, question, content)
    if normalized_mode == "hybrid":
        return _execute_hybrid_mode(client, question, content)
    if normalized_mode == "search":
        return _execute_search_mode(client, question, content)
    return {
        "mode": "chat",
        "content": content.strip() or "Modo no soportado."
    }


def _execute_sql_mode(client: OpenAI, question: str, sql: str) -> dict[str, Any]:
    is_valid, error = validate_sql(sql)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid SQL generated by agent: {error}")

    try:
        columns, rows = execute_query(sql)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SQL execution failed: {exc}") from exc

    try:
        summary = summarize_results(client, question, sql, columns, rows)
    except Exception:
        summary = "Query executed successfully. Summary generation is unavailable right now."

    table = _table_payload(columns, rows)
    return {
        "mode": "sql",
        "content": summary,
        "sql": sql,
        "table": table,
        "chart": _auto_chart_payload(columns, rows),
    }


def _execute_hybrid_mode(client: OpenAI, question: str, content: str) -> dict[str, Any]:
    quant_sql, qual_sql = _split_hybrid_queries(content)
    warnings: list[str] = []

    quant_columns: list[str] = []
    quant_rows: list[tuple[Any, ...]] = []
    qual_columns: list[str] = []
    qual_rows: list[tuple[Any, ...]] = []

    valid_quant, quant_error = validate_sql(quant_sql)
    valid_qual, qual_error = validate_sql(qual_sql)
    if not valid_quant:
        warnings.append(f"Quantitative SQL was skipped: {quant_error}")
    if not valid_qual:
        warnings.append(f"Qualitative SQL was skipped: {qual_error}")
    if not valid_quant and not valid_qual:
        raise HTTPException(status_code=400, detail="Neither HYBRID query could be validated.")

    if valid_quant:
        try:
            quant_columns, quant_rows = execute_query(quant_sql)
        except Exception as exc:
            warnings.append(f"Quantitative SQL failed: {exc}")
    if valid_qual:
        try:
            qual_columns, qual_rows = execute_query(qual_sql)
        except Exception as exc:
            warnings.append(f"Qualitative SQL failed: {exc}")

    if not quant_rows and not qual_rows:
        # Fallback: en vez de tirar 404 al cliente (UI ve JSON crudo rojo),
        # devolvemos una respuesta normal explicando que no hay data y
        # sugiriendo qué probar. Menos abrupto para el user.
        return {
            "mode": "hybrid",
            "content": (
                "No encontré datos que coincidan con esa pregunta. "
                "Sugerencias para probar:\n"
                "1. Ampliá el rango de fechas (ej. 'en los últimos 6 meses').\n"
                "2. Verificá los valores del filtro (ej. segment ILIKE 'Enterprise%', no '= Enterprise').\n"
                "3. Quitá un filtro a la vez para ver si la query con menos restricciones devuelve algo."
            ),
            "quant_sql": quant_sql,
            "qual_sql": qual_sql,
            "warnings": warnings,
        }

    try:
        summary = summarize_hybrid_results(client, question, quant_columns, quant_rows, qual_columns, qual_rows)
    except Exception:
        summary = "Hybrid queries executed, but synthesis is unavailable right now."

    payload = {
        "mode": "hybrid",
        "content": summary,
        "quant_sql": quant_sql,
        "qual_sql": qual_sql,
        "quant_table": _table_payload(quant_columns, quant_rows) if quant_columns else None,
        "qual_table": _table_payload(qual_columns, qual_rows) if qual_columns else None,
        "chart": _auto_chart_payload(quant_columns, quant_rows) if quant_columns else None,
    }
    if warnings:
        payload["warnings"] = warnings
    return payload


def _execute_search_mode(client: OpenAI, question: str, content: str) -> dict[str, Any]:
    parsed = _parse_search_content(content)
    search_query = (parsed.get("search_query") or "").strip()
    search_filters = (parsed.get("filters") or "").strip()
    search_sql = (parsed.get("sql") or "").strip()
    if not search_query:
        raise HTTPException(status_code=400, detail="SEARCH mode did not include a search query.")

    try:
        search_results = search_transcript_chunks(client, search_query, filters=search_filters)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Semantic search failed: {exc}") from exc

    sql_columns: list[str] | None = None
    sql_rows: list[tuple[Any, ...]] | None = None
    warnings: list[str] = []
    if search_sql:
        valid_sql, sql_error = validate_sql(search_sql)
        if valid_sql:
            try:
                sql_columns, sql_rows = execute_query(search_sql)
            except Exception as exc:
                warnings.append(f"Complementary SQL failed: {exc}")
        else:
            warnings.append(f"Complementary SQL was skipped: {sql_error}")

    if not search_results and not sql_rows:
        raise HTTPException(status_code=404, detail="SEARCH mode returned no results.")

    try:
        summary = summarize_search_results(client, question, search_results, sql_columns=sql_columns, sql_rows=sql_rows)
    except Exception:
        summary = "Search completed, but synthesis is unavailable right now."

    payload = {
        "mode": "search",
        "content": summary,
        "search_query": search_query,
        "search_filters": search_filters,
        "search_results": _json_safe(search_results),
        "search_sql": search_sql or None,
        "search_sql_table": _table_payload(sql_columns or [], sql_rows or []) if sql_columns else None,
        "chart": _auto_chart_payload(sql_columns or [], sql_rows or []) if sql_columns else None,
    }
    if warnings:
        payload["warnings"] = warnings
    return payload


def _table_payload(columns: list[str], rows: list[tuple[Any, ...]]) -> dict[str, Any]:
    records = []
    for row in rows:
        records.append({column: _json_safe(value) for column, value in zip(columns, row)})
    return {"columns": columns, "rows": records}


def _auto_chart_payload(columns: list[str], rows: list[tuple[Any, ...]]) -> dict[str, Any] | None:
    if not columns or not rows:
        return None

    numeric_indexes = []
    text_indexes = []
    for index, column in enumerate(columns):
        values = [row[index] for row in rows[:20] if len(row) > index]
        if values and all(isinstance(value, (int, float, Decimal)) for value in values if value is not None):
            numeric_indexes.append(index)
        elif values:
            text_indexes.append(index)

    if not numeric_indexes:
        return None

    value_index = numeric_indexes[0]
    label_index = text_indexes[0] if text_indexes else None
    chart_type = "bar" if label_index is not None else "metric"
    series = []
    for row in rows[:20]:
        point = {"value": _json_safe(row[value_index])}
        if label_index is not None:
            point["label"] = _json_safe(row[label_index])
        series.append(point)

    return {
        "type": chart_type,
        "labelKey": "label" if label_index is not None else None,
        "valueKey": "value",
        "title": f"{columns[value_index]} by {columns[label_index]}" if label_index is not None else columns[value_index],
        "series": series,
    }


def _json_safe(value: Any) -> Any:
    if is_dataclass(value):
        return _json_safe(asdict(value))
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)
