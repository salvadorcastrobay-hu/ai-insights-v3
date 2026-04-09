"""
Persistencia append-only para Campaign Advisor en Supabase.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from uuid import uuid4

from shared import get_supabase
from src.agents.marketing_advisor import CampaignAngle, MarketingRecommendation
from src.skills.pipeline_stats import PipelineBreakdown
from src.skills.segment_insights import SegmentInsights


CONVERSATIONS_TABLE = "campaign_advisor_conversations"
MESSAGES_TABLE = "campaign_advisor_messages"
SNAPSHOTS_TABLE = "campaign_advisor_snapshots"


def _client():
    return get_supabase()


def _normalize_owner_candidates(owner) -> list[str]:
    if owner is None:
        return []
    if isinstance(owner, (list, tuple, set)):
        values = owner
    else:
        values = [owner]
    out = []
    for value in values:
        cleaned = str(value or "").strip()
        if cleaned and cleaned not in out:
            out.append(cleaned)
    return out


def _iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _conversation_title(question: str) -> str:
    cleaned = " ".join((question or "").strip().split())
    if not cleaned:
        return "Campaign Advisor"
    return cleaned[:80]


def serialize_recommendation(recommendation: MarketingRecommendation) -> dict:
    return {
        "segment_summary": recommendation.segment_summary,
        "recommended_market_language": recommendation.recommended_market_language,
        "market_tone": recommendation.market_tone,
        "confidence_reason": recommendation.confidence_reason,
        "freshness_window": recommendation.freshness_window,
        "qualification_summary": recommendation.qualification_summary,
        "recommended_angles": [asdict(angle) for angle in recommendation.recommended_angles],
        "what_not_to_do": recommendation.what_not_to_do,
        "data_confidence": recommendation.data_confidence,
        "sample_size": recommendation.sample_size,
        "filters_applied": recommendation.filters_applied,
        "model_used": recommendation.model_used,
        "error": recommendation.error,
    }


def deserialize_recommendation(data: dict | None) -> MarketingRecommendation | None:
    if not isinstance(data, dict):
        return None
    angles = [
        CampaignAngle(**angle)
        for angle in (data.get("recommended_angles") or [])
        if isinstance(angle, dict)
    ]
    return MarketingRecommendation(
        segment_summary=data.get("segment_summary", ""),
        recommended_market_language=data.get("recommended_market_language", ""),
        market_tone=data.get("market_tone", ""),
        confidence_reason=data.get("confidence_reason", ""),
        freshness_window=data.get("freshness_window", ""),
        qualification_summary=list(data.get("qualification_summary") or []),
        recommended_angles=angles,
        what_not_to_do=list(data.get("what_not_to_do") or []),
        data_confidence=data.get("data_confidence", ""),
        sample_size=int(data.get("sample_size") or 0),
        filters_applied=dict(data.get("filters_applied") or {}),
        model_used=data.get("model_used", ""),
        error=data.get("error", ""),
    )


def serialize_pipeline(pipeline: PipelineBreakdown) -> dict:
    return asdict(pipeline)


def deserialize_pipeline(data: dict | None) -> PipelineBreakdown | None:
    if not isinstance(data, dict):
        return None
    return PipelineBreakdown(
        total_deals=int(data.get("total_deals") or 0),
        total_revenue=float(data.get("total_revenue") or 0),
        by_industry=list(data.get("by_industry") or []),
        by_country=list(data.get("by_country") or []),
        by_segment=list(data.get("by_segment") or []),
        by_stage=list(data.get("by_stage") or []),
        filter_description=data.get("filter_description", "Todos los segmentos"),
    )


def serialize_insights(insights: SegmentInsights) -> dict:
    return asdict(insights)


def deserialize_insights(data: dict | None) -> SegmentInsights | None:
    if not isinstance(data, dict):
        return None
    return SegmentInsights(
        top_pains=list(data.get("top_pains") or []),
        top_faqs=list(data.get("top_faqs") or []),
        top_modules=list(data.get("top_modules") or []),
        competitors=list(data.get("competitors") or []),
        top_gaps=list(data.get("top_gaps") or []),
        sample_size=int(data.get("sample_size") or 0),
        insight_volume=dict(data.get("insight_volume") or {}),
    )


def create_conversation(owner: str, question: str, filters: dict, inferred_filters: dict) -> str:
    conversation_id = str(uuid4())
    row = {
        "id": conversation_id,
        "owner": owner,
        "title": _conversation_title(question),
        "initial_question": question,
        "filters": filters or {},
        "inferred_filters": inferred_filters or {},
        "created_at": _iso_now(),
    }
    _client().table(CONVERSATIONS_TABLE).insert(row).execute()
    return conversation_id


def insert_message(
    conversation_id: str,
    owner: str,
    role: str,
    content: str,
    message_kind: str,
) -> None:
    _client().table(MESSAGES_TABLE).insert(
        {
            "id": str(uuid4()),
            "conversation_id": conversation_id,
            "owner": owner,
            "role": role,
            "message_kind": message_kind,
            "content": content,
            "created_at": _iso_now(),
        }
    ).execute()


def insert_snapshot(
    conversation_id: str,
    owner: str,
    question: str,
    filters: dict,
    inferred_filters: dict,
    answer_language: str,
    recommendation: MarketingRecommendation,
    pipeline: PipelineBreakdown,
    insights: SegmentInsights,
    snapshot_kind: str,
) -> None:
    _client().table(SNAPSHOTS_TABLE).insert(
        {
            "id": str(uuid4()),
            "conversation_id": conversation_id,
            "owner": owner,
            "question": question,
            "filters": filters or {},
            "inferred_filters": inferred_filters or {},
            "answer_language": answer_language,
            "recommendation": serialize_recommendation(recommendation),
            "pipeline": serialize_pipeline(pipeline),
            "insights": serialize_insights(insights),
            "snapshot_kind": snapshot_kind,
            "created_at": _iso_now(),
        }
    ).execute()


def list_conversations(owner, limit: int = 20) -> list[dict]:
    owners = _normalize_owner_candidates(owner)
    if not owners:
        return []
    query = _client().table(CONVERSATIONS_TABLE).select("id,title,initial_question,created_at").order(
        "created_at", desc=True
    )
    if len(owners) == 1:
        query = query.eq("owner", owners[0])
    else:
        query = query.in_("owner", owners)
    response = query.limit(limit).execute()
    return response.data or []


def load_conversation(owner, conversation_id: str) -> dict | None:
    owners = _normalize_owner_candidates(owner)
    if not owners:
        return None

    conversation_query = _client().table(CONVERSATIONS_TABLE).select("*").eq("id", conversation_id)
    if len(owners) == 1:
        conversation_query = conversation_query.eq("owner", owners[0])
    else:
        conversation_query = conversation_query.in_("owner", owners)
    conversation_response = conversation_query.limit(1).execute()
    conversations = conversation_response.data or []
    if not conversations:
        return None

    snapshot_query = _client().table(SNAPSHOTS_TABLE).select("*").eq("conversation_id", conversation_id)
    if len(owners) == 1:
        snapshot_query = snapshot_query.eq("owner", owners[0])
    else:
        snapshot_query = snapshot_query.in_("owner", owners)
    snapshot_response = snapshot_query.order("created_at", desc=True).limit(1).execute()
    snapshots = snapshot_response.data or []
    if not snapshots:
        return None

    message_query = _client().table(MESSAGES_TABLE).select("*").eq("conversation_id", conversation_id)
    if len(owners) == 1:
        message_query = message_query.eq("owner", owners[0])
    else:
        message_query = message_query.in_("owner", owners)
    message_response = message_query.order("created_at", desc=False).execute()
    messages = message_response.data or []

    conversation = conversations[0]
    snapshot = snapshots[0]
    return {
        "conversation": conversation,
        "snapshot": snapshot,
        "messages": messages,
        "recommendation": deserialize_recommendation(snapshot.get("recommendation")),
        "pipeline": deserialize_pipeline(snapshot.get("pipeline")),
        "insights": deserialize_insights(snapshot.get("insights")),
    }
