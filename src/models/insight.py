"""
Pydantic models for OpenAI Structured Output and internal data flow.
These models define the JSON schema that OpenAI must return.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums for strict validation ──

class InsightType(str, Enum):
    pain = "pain"
    product_gap = "product_gap"
    competitive_signal = "competitive_signal"
    deal_friction = "deal_friction"
    faq = "faq"


class GapPriority(str, Enum):
    must_have = "must_have"
    nice_to_have = "nice_to_have"
    dealbreaker = "dealbreaker"


# ── Single Insight (what the LLM returns per insight) ──

class InsightItem(BaseModel):
    """One insight extracted from a transcript chunk."""

    insight_type: InsightType
    insight_subtype: str = Field(
        description="Code from the taxonomy (e.g. 'fragmented_tools', 'budget', 'pricing')"
    )
    module: Optional[str] = Field(
        default=None,
        description="Module code (e.g. 'chat', 'onboarding'). Required for product_gap."
    )
    summary: str = Field(
        description="Normalized summary in 1-2 sentences (Spanish)"
    )
    verbatim_quote: Optional[str] = Field(
        default=None,
        description="Exact quote from the transcript supporting this insight"
    )
    confidence: float = Field(
        ge=0.0, le=1.0,
        description="Confidence score 0-1"
    )

    # Competitive Signal fields
    competitor_name: Optional[str] = Field(
        default=None,
        description="Normalized competitor name from the known list, or new name"
    )
    competitor_relationship: Optional[str] = Field(
        default=None,
        description="Relationship code: currently_using, evaluating, migrating_from, previously_used, mentioned, rejected"
    )

    # Product Gap fields
    feature_name: Optional[str] = Field(
        default=None,
        description="Normalized feature code (from seed list or new slug)"
    )
    gap_description: Optional[str] = Field(
        default=None,
        description="Free-text description of the missing feature"
    )
    gap_priority: Optional[GapPriority] = Field(
        default=None,
        description="Priority signal: must_have, nice_to_have, dealbreaker"
    )

    # FAQ fields
    faq_topic: Optional[str] = Field(
        default=None,
        description="FAQ topic code from taxonomy"
    )


class TranscriptInsightsResponse(BaseModel):
    """Response from the LLM for one transcript/chunk."""

    insights: list[InsightItem] = Field(
        description="List of all insights found in this transcript chunk"
    )


# ── Helper: Generate JSON Schema for OpenAI response_format ──

def get_openai_json_schema() -> dict:
    """Return the JSON schema dict for OpenAI's response_format parameter.

    OpenAI strict mode requires:
    - additionalProperties: false on all objects
    - All properties must be in 'required'
    - No 'default' values
    """
    schema = TranscriptInsightsResponse.model_json_schema()
    _make_strict_compatible(schema)
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "transcript_insights",
            "strict": True,
            "schema": schema,
        }
    }


def _make_strict_compatible(schema: dict) -> None:
    """Recursively transform a Pydantic JSON schema to be OpenAI-strict-compatible."""
    if not isinstance(schema, dict):
        return

    # Process $defs
    for defn in schema.get("$defs", {}).values():
        _make_strict_compatible(defn)

    # For objects: add additionalProperties, make all props required, remove defaults
    if schema.get("type") == "object" or "properties" in schema:
        schema["additionalProperties"] = False
        if "properties" in schema:
            schema["required"] = list(schema["properties"].keys())
            for prop in schema["properties"].values():
                prop.pop("default", None)
                prop.pop("title", None)
                _make_strict_compatible(prop)

    # Process items in arrays
    if "items" in schema:
        _make_strict_compatible(schema["items"])

    # Process anyOf branches
    for branch in schema.get("anyOf", []):
        _make_strict_compatible(branch)


# ── Internal models for pipeline ──

class TranscriptRecord(BaseModel):
    """A transcript fetched from Supabase view."""
    transcript_id: str
    transcript_text: str
    deal_id: Optional[str] = None
    deal_name: Optional[str] = None
    company_name: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    deal_stage: Optional[str] = None
    deal_owner: Optional[str] = None
    call_date: Optional[str] = None


class ChunkResult(BaseModel):
    """A chunk of a transcript ready for processing."""
    transcript_id: str
    chunk_index: int
    text: str
    token_count: int
    metadata: TranscriptRecord
