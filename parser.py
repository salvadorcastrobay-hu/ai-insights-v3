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
from db import compute_content_hash, insert_new_feature, insert_new_subtype
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
    normalize_module,
    normalize_subtype,
    match_feature_to_roadmap,
    PAIN_SUBTYPES,
    MODULES,
    SEED_FEATURE_NAMES,
)

# Maps insight_type -> tax_* table name, for auto-registering new (non-seed) codes
_SUBTYPE_TABLE = {
    "pain": "tax_pain_subtypes",
    "deal_friction": "tax_deal_friction_subtypes",
    "faq": "tax_faq_subtypes",
}

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

# Track new (non-seed) pain/deal_friction/faq codes discovered in this run
_new_subtype_codes: set[tuple[str, str]] = set()


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
            new_subtype_code = row.pop("_new_subtype_code", None)
            if new_subtype_code and supabase_client:
                _register_new_subtype(supabase_client, *new_subtype_code)

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
    new_subtype_code: str | None = None  # set if normalize_subtype had to auto-create a code

    # ── Validate subtype by insight type ──
    # Never drop the insight for pain/deal_friction/faq on a taxonomy mismatch:
    # normalize_subtype() maps known aliases to the canonical code, and falls
    # back to a new slug code (registered as non-seed) instead of discarding
    # the insight.
    if itype == "pain":
        subtype, is_new = normalize_subtype("pain", subtype)
        if is_new:
            new_subtype_code = subtype
        # Auto-assign module from taxonomy if not provided
        if not module:
            pain_data = PAIN_SUBTYPES.get(subtype)
            if pain_data and pain_data.get("module"):
                module = pain_data["module"]

    elif itype == "deal_friction":
        subtype, is_new = normalize_subtype("deal_friction", subtype)
        if is_new:
            new_subtype_code = subtype

    elif itype == "faq":
        subtype, is_new = normalize_subtype("faq", subtype)
        if is_new:
            new_subtype_code = subtype

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
    # Connect MODULE_ALIASES (previously only used to build prompt hints,
    # never applied programmatically) so paraphrased module mentions get
    # resolved instead of dropped.
    if module:
        module = normalize_module(module)
    if module and module not in _valid_modules:
        logger.warning(f"Unknown module: {module}, dropping from insight")
        if itype == "product_gap":
            return None  # Module is required for product_gap
        module = None

    # ── Normalize competitor ──
    competitor_name = insight.competitor_name
    if competitor_name:
        competitor_name = normalize_competitor(competitor_name)

    # ── Match against the real roadmap (product_gap only) ──
    roadmap_match_id = None
    if itype == "product_gap":
        roadmap_match_id = match_feature_to_roadmap(insight.feature_name, insight.gap_description)

    # ── Build row ──
    content_hash = compute_content_hash(
        {
            "insight_type": itype,
            "insight_subtype": subtype,
            "summary": insight.summary,
            "prompt_version": config.PROMPT_VERSION,
        },
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
        "roadmap_match_id": roadmap_match_id,
        "gap_description": insight.gap_description,
        "gap_priority": insight.gap_priority.value if insight.gap_priority else None,
        "faq_answer": insight.faq_answer,
        "speaker_role": insight.speaker_role,
        "model_used": model_used,
        "prompt_version": config.PROMPT_VERSION,
        "batch_id": batch_id,
        "content_hash": content_hash,
        # Internal marker, popped by parse_response before insertion.
        "_new_subtype_code": (itype, new_subtype_code) if new_subtype_code else None,
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


def _register_new_subtype(client, itype: str, code: str) -> None:
    """Register a new (non-seed) pain/deal_friction/faq code discovered by the LLM.

    Mirrors _register_new_feature: never drops the insight, just makes the
    new code visible (is_seed=False) for QA review instead of silently
    fragmenting or losing data.
    """
    cache_key = (itype, code)
    if cache_key in _new_subtype_codes:
        return
    table = _SUBTYPE_TABLE[itype]
    display_name = code.replace("_", " ").title()
    insert_new_subtype(client, table, code, display_name)
    _new_subtype_codes.add(cache_key)


def get_new_subtype_codes() -> set[tuple[str, str]]:
    """Return all new (insight_type, code) pairs discovered in this run."""
    return set(_new_subtype_codes)
