"""
Ingestion orchestrator: Fathom transcripts + HubSpot CRM data + deal matching.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from supabase import Client as SupabaseClient

import config
from fathom_client import fetch_meetings, parse_meeting
from hubspot_client import (
    fetch_all_deals, parse_deal,
    fetch_owners, fetch_pipelines,
)
from deal_matcher import match_call_to_deal

logger = logging.getLogger(__name__)


def run_ingestion(
    supabase: SupabaseClient,
    source: str | None = None,
    match_only: bool = False,
    since: str | None = None,
) -> dict:
    """
    Run the full ingestion pipeline.

    Args:
        supabase: Supabase client
        source: 'fathom', 'hubspot', or None (both)
        match_only: Skip fetching, only re-run deal matching
        since: ISO date string for incremental Fathom fetch

    Returns:
        Summary stats dict.
    """
    stats = {
        "fathom_meetings": 0,
        "hubspot_deals": 0,
        "matches_made": 0,
        "matches_none": 0,
    }

    if match_only:
        logger.info("Match-only mode: re-running deal matching...")
        _run_matching(supabase, stats)
        return stats

    # ── Fathom ingestion ──
    if source in (None, "fathom"):
        logger.info("=" * 50)
        logger.info("FATHOM: Fetching meetings...")
        logger.info("=" * 50)
        _ingest_fathom(supabase, since, stats)

    # ── HubSpot ingestion ──
    if source in (None, "hubspot"):
        logger.info("=" * 50)
        logger.info("HUBSPOT: Fetching CRM data...")
        logger.info("=" * 50)
        _ingest_hubspot(supabase, stats)

    # ── Deal matching ──
    logger.info("=" * 50)
    logger.info("MATCHING: Linking calls to deals...")
    logger.info("=" * 50)
    _run_matching(supabase, stats)

    _log_summary(stats)
    return stats


def _ingest_fathom(
    supabase: SupabaseClient,
    since: str | None,
    stats: dict,
) -> None:
    """Fetch Fathom meetings and store in raw_transcripts."""
    meetings = fetch_meetings(since=since)
    stats["fathom_meetings"] = len(meetings)

    if not meetings:
        logger.warning("No meetings found in Fathom")
        return

    rows = []
    for m in meetings:
        parsed = parse_meeting(m)
        # Convert complex fields to JSON strings for Supabase
        row = {
            **parsed,
            "transcript_json": json.dumps(parsed["transcript_json"], ensure_ascii=False)
                if parsed["transcript_json"] else None,
            "participants": json.dumps(parsed["participants"], ensure_ascii=False)
                if parsed["participants"] else None,
            "fathom_crm_matches": json.dumps(parsed["fathom_crm_matches"], ensure_ascii=False)
                if parsed["fathom_crm_matches"] else None,
        }
        rows.append(row)

    _upsert_batch(supabase, "raw_transcripts", rows, "recording_id")
    logger.info(f"Stored {len(rows)} transcripts in raw_transcripts")


def _ingest_hubspot(supabase: SupabaseClient, stats: dict) -> None:
    """Fetch HubSpot deals and store in cache table."""

    # Fetch owners for name resolution
    logger.info("Fetching owners...")
    try:
        owners = fetch_owners()
        logger.info(f"Found {len(owners)} owners")
    except Exception as e:
        logger.warning(f"Could not fetch owners (add crm.objects.owners.read scope): {e}")
        owners = {}

    # Fetch pipeline/stage labels
    logger.info("Fetching deal pipelines & stages...")
    try:
        pipelines = fetch_pipelines()
        total_stages = sum(len(p["stages"]) for p in pipelines.values())
        logger.info(f"Found {len(pipelines)} pipelines, {total_stages} stages")
    except Exception as e:
        logger.warning(f"Could not fetch pipelines: {e}")
        pipelines = {}

    # Deals
    logger.info("Fetching deals...")
    raw_deals = fetch_all_deals()
    deal_rows = []
    for d in raw_deals:
        parsed = parse_deal(d, pipelines)
        # Resolve owner names
        if parsed["owner_id"] and parsed["owner_id"] in owners:
            parsed["owner_name"] = owners[parsed["owner_id"]]
        if parsed["ae_owner_id"] and parsed["ae_owner_id"] in owners:
            parsed["ae_owner_name"] = owners[parsed["ae_owner_id"]]
        # Convert lists/dicts to JSON for Supabase
        row = {
            **parsed,
            "associated_company_ids": parsed["associated_company_ids"],
            "associated_contact_ids": parsed["associated_contact_ids"],
            "properties": json.dumps(parsed["properties"], ensure_ascii=False)
                if parsed["properties"] else None,
        }
        deal_rows.append(row)
    _upsert_batch(supabase, "raw_deals", deal_rows, "deal_id")
    stats["hubspot_deals"] = len(deal_rows)
    logger.info(f"Stored {len(deal_rows)} deals")


def _run_matching(supabase: SupabaseClient, stats: dict) -> None:
    """Run deal matching on all transcripts using Fathom crm_matches."""

    # Load only needed columns for matching (avoid timeout on large blobs)
    logger.info("Loading data for matching...")

    transcripts = _fetch_columns(supabase, "raw_transcripts",
        "recording_id,fathom_crm_matches,call_date,title")
    deals_raw = _fetch_columns(supabase, "raw_deals",
        "deal_id,deal_name,deal_stage,create_date,amount,associated_company_ids")

    logger.info(
        f"Loaded: {len(transcripts)} transcripts, {len(deals_raw)} deals"
    )

    # Build lookup indices
    deals_by_id: dict[str, dict] = {}
    for d in deals_raw:
        deals_by_id[d["deal_id"]] = d

    deals_by_company: dict[str, list[dict]] = {}
    for d in deals_raw:
        company_ids = d.get("associated_company_ids") or []
        for cid in company_ids:
            deals_by_company.setdefault(str(cid), []).append(d)

    logger.info(
        f"Indices built: {len(deals_by_id)} deals, "
        f"{len(deals_by_company)} companies with deals"
    )

    # Match each transcript
    match_rows = []
    for t in transcripts:
        result = match_call_to_deal(t, deals_by_company, deals_by_id)

        match_row = {
            "recording_id": t["recording_id"],
            "matched_deal_id": result["matched_deal_id"],
            "match_method": result["match_method"],
            "match_score": result["match_score"],
            "match_details": json.dumps(result["match_details"], ensure_ascii=False),
        }
        match_rows.append(match_row)

        if result["matched_deal_id"]:
            stats["matches_made"] += 1
        else:
            stats["matches_none"] += 1

    _upsert_batch(supabase, "call_deal_matches", match_rows, "recording_id")
    logger.info(
        f"Matching complete: {stats['matches_made']} matched, "
        f"{stats['matches_none']} unmatched"
    )


def _fetch_all(supabase: SupabaseClient, table: str) -> list[dict]:
    """Fetch all rows from a table (paginated)."""
    return _fetch_columns(supabase, table, "*")


def _fetch_columns(
    supabase: SupabaseClient, table: str, columns: str,
) -> list[dict]:
    """Fetch specific columns from a table (paginated)."""
    all_data = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            supabase.table(table)
            .select(columns)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_data.extend(response.data)
        if len(response.data) < page_size:
            break
        offset += page_size
        if offset % 10000 == 0:
            logger.info(f"  Loading {table}: {len(all_data)} rows...")
    return all_data


def _upsert_batch(
    supabase: SupabaseClient,
    table: str,
    rows: list[dict],
    pk_column: str,
) -> None:
    """Upsert rows in batches."""
    if not rows:
        return
    batch_size = 100
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        try:
            supabase.table(table).upsert(batch, on_conflict=pk_column).execute()
        except Exception as e:
            logger.error(f"Upsert error on {table}: {e}")
            # Try one by one
            for row in batch:
                try:
                    supabase.table(table).upsert(row, on_conflict=pk_column).execute()
                except Exception as row_e:
                    logger.warning(f"Skip row in {table}: {row_e}")


def _log_summary(stats: dict) -> None:
    logger.info("=" * 50)
    logger.info("Ingestion Summary:")
    logger.info(f"  Fathom meetings:   {stats.get('fathom_meetings', 0)}")
    logger.info(f"  HubSpot deals:     {stats.get('hubspot_deals', 0)}")
    logger.info(f"  Deals matched:     {stats.get('matches_made', 0)}")
    logger.info(f"  No match:          {stats.get('matches_none', 0)}")
    logger.info("=" * 50)
