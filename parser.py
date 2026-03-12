"""
Parse and validate LLM responses against the taxonomy.
Normalize codes, extend feature names, prepare rows for DB insertion.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import ValidationError

import config
from db import compute_content_hash, insert_new_feature
from models import TranscriptInsightsResponse, InsightItem
from taxonomy import (
    get_valid_pain_codes,
    get_valid_deal_friction_codes,
    get_valid_faq_codes,
    get_valid_competitive_relationship_codes,
    get_valid_module_codes,
    get_valid_feature_codes,
    get_competitor_names,
    normalize_competitor,
    PAIN_SUBTYPES,
    MODULES,
    SEED_FEATURE_NAMES,
)

logger = logging.getLogger(__name__)

# Caches
_valid_pains = get_valid_pain_codes()
_valid_frictions = get_valid_deal_friction_codes()
_valid_faqs = get_valid_faq_codes()
_valid_relationships = get_valid_competitive_relationship_codes()
_valid_modules = get_valid_module_codes()
_valid_features = get_valid_feature_codes()
_known_competitors = get_competitor_names()

# Track new features discovered in this run
_new_features: dict[str, dict] = {}


def parse_response(
    raw_json: str | dict,
    transcript_id: str,
    chunk_index: int,
    metadata: dict,
    model_used: str,
    batch_id: str | None = None,
    supabase_client=None,
) -> list[dict]:
    """
    Parse an LLM response, validate, normalize, and return DB-ready rows.

    Returns a list of dicts ready for insertion into transcript_insights.
    """
    # Parse JSON
    if isinstance(raw_json, str):
        try:
            data = json.loads(raw_json)
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error for {transcript_id}[{chunk_index}]: {e}")
            return []
    else:
        data = raw_json

    # Validate with Pydantic
    try:
        response = TranscriptInsightsResponse.model_validate(data)
    except ValidationError as e:
        logger.error(f"Validation error for {transcript_id}[{chunk_index}]: {e}")
        return []

    rows = []
    for insight in response.insights:
        row = _normalize_insight(insight, transcript_id, chunk_index, metadata, model_used, batch_id)
        if row:
            # Register new features if needed
            if (
                row.get("feature_name")
                and row["feature_name"] not in _valid_features
                and row["feature_name"] not in _new_features
                and supabase_client
            ):
                _register_new_feature(supabase_client, row["feature_name"], row.get("module"))

            rows.append(row)

    logger.info(
        f"Parsed {transcript_id}[{chunk_index}]: "
        f"{len(response.insights)} raw -> {len(rows)} valid insights"
    )
    return rows


def _normalize_insight(
    insight: InsightItem,
    transcript_id: str,
    chunk_index: int,
    metadata: dict,
    model_used: str,
    batch_id: str | None,
) -> dict | None:
    """Validate and normalize a single insight. Returns None if invalid."""

    itype = insight.insight_type.value
    subtype = insight.insight_subtype
    module = insight.module

    # ── Validate subtype by insight type ──
    if itype == "pain":
        if subtype not in _valid_pains:
            logger.warning(f"Unknown pain subtype: {subtype}")
            return None
        # Auto-assign module from taxonomy if not provided
        if not module:
            pain_data = PAIN_SUBTYPES.get(subtype)
            if pain_data and pain_data.get("module"):
                module = pain_data["module"]

    elif itype == "deal_friction":
        if subtype not in _valid_frictions:
            logger.warning(f"Unknown deal_friction subtype: {subtype}")
            return None

    elif itype == "faq":
        if subtype not in _valid_faqs:
            logger.warning(f"Unknown faq subtype: {subtype}")
            return None

    elif itype == "competitive_signal":
        # For competitive signals, subtype is the relationship code
        if subtype not in _valid_relationships:
            # Try using competitor_relationship instead
            if insight.competitor_relationship in _valid_relationships:
                subtype = insight.competitor_relationship
            else:
                logger.warning(f"Unknown competitive relationship: {subtype}")
                return None

    elif itype == "product_gap":
        # product_gap always needs a module
        if not module:
            logger.warning(f"product_gap without module: {insight.summary[:60]}")
            return None
        # Normalize feature_name to slug format
        if insight.feature_name:
            insight.feature_name = _to_slug(insight.feature_name)

    # ── Validate module ──
    if module and module not in _valid_modules:
        logger.warning(f"Unknown module: {module}, dropping from insight")
        if itype == "product_gap":
            return None  # Module is required for product_gap
        module = None

    # ── Normalize competitor ──
    competitor_name = insight.competitor_name
    if competitor_name:
        competitor_name = normalize_competitor(competitor_name)

    # ── Build row ──
    content_hash = compute_content_hash(
        {"insight_type": itype, "insight_subtype": subtype, "summary": insight.summary},
        transcript_id,
        chunk_index,
    )

    row = {
        "transcript_id": transcript_id,
        "transcript_chunk": chunk_index,
        "deal_id": metadata.get("deal_id"),
        "deal_name": metadata.get("deal_name"),
        "company_name": metadata.get("company_name"),
        "region": metadata.get("region"),
        "country": metadata.get("country"),
        "industry": metadata.get("industry"),
        "company_size": metadata.get("company_size"),
        "segment": metadata.get("segment"),
        "amount": metadata.get("amount"),
        "deal_stage": metadata.get("deal_stage"),
        "deal_owner": metadata.get("deal_owner"),
        "call_date": metadata.get("call_date"),
        "insight_type": itype,
        "insight_subtype": subtype,
        "module": module,
        "summary": insight.summary,
        "verbatim_quote": insight.verbatim_quote,
        "confidence": insight.confidence,
        "competitor_name": competitor_name,
        "competitor_relationship": insight.competitor_relationship,
        "feature_name": insight.feature_name,
        "gap_description": insight.gap_description,
        "gap_priority": insight.gap_priority.value if insight.gap_priority else None,
        "faq_topic": insight.faq_topic,
        "model_used": model_used,
        "prompt_version": config.PROMPT_VERSION,
        "batch_id": batch_id,
        "content_hash": content_hash,
    }

    return row


def _to_slug(text: str) -> str:
    """Convert a feature name to a valid slug code."""
    slug = text.lower().strip()
    slug = re.sub(r"[^a-z0-9_]", "_", slug)
    slug = re.sub(r"_+", "_", slug)
    slug = slug.strip("_")
    return slug


def _register_new_feature(client, code: str, module: str | None) -> None:
    """Register a new feature name discovered by the LLM."""
    display_name = code.replace("_", " ").title()
    _new_features[code] = {"display_name": display_name, "module": module}
    insert_new_feature(client, code, display_name, module)
    _valid_features.add(code)


def get_new_features() -> dict[str, dict]:
    """Return all new features discovered in this run."""
    return dict(_new_features)
