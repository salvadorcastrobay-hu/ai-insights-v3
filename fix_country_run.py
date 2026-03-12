"""
Fix deal metadata: country (pais), deal_owner (Account Executive),
segment, and amount columns.

Usage:
  1. First run fix_country.sql in Supabase SQL Editor
  2. Then run: python fix_country_run.py
"""
from __future__ import annotations

import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def reingest_hubspot_deals():
    """Re-ingest HubSpot deals to populate country, AE, segment from fresh API data."""
    from db import get_client
    from ingest import _ingest_hubspot

    supabase = get_client()
    stats = {}
    logger.info("Re-ingesting HubSpot deals (fetching pais, who_closed_the_lead, segment_v2, amount)...")
    _ingest_hubspot(supabase, stats)
    logger.info(f"Re-ingestion complete: {stats}")
    return supabase


def update_existing_insights(supabase):
    """Update transcript_insights rows with correct country, region, deal_owner, segment, amount from v_transcripts."""
    logger.info("Updating existing insights from v_transcripts view...")

    # Fetch all transcript_id -> deal metadata mappings from the updated view
    # (v_transcripts now has deal_country, deal_region, deal_owner=AE, segment, amount)
    all_mappings = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("v_transcripts")
            .select("transcript_id,deal_country,deal_region,country,region,deal_owner,segment,amount")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_mappings.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
    logger.info(f"Loaded {len(all_mappings)} transcript mappings from v_transcripts")

    # Build lookup: transcript_id -> metadata
    mapping = {}
    for row in all_mappings:
        tid = row["transcript_id"]
        mapping[tid] = {
            "country": row.get("deal_country") or row.get("country"),
            "region": row.get("deal_region") or row.get("region"),
            "deal_owner": row.get("deal_owner"),
            "segment": row.get("segment"),
            "amount": row.get("amount"),
        }

    # Fetch all distinct transcript_ids from insights
    all_tids = set()
    offset = 0
    while True:
        resp = (
            supabase.table("transcript_insights")
            .select("transcript_id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        for r in resp.data:
            all_tids.add(r["transcript_id"])
        if len(resp.data) < page_size:
            break
        offset += page_size

    logger.info(f"Found {len(all_tids)} unique transcript IDs in insights")

    # Update insights in batches by transcript_id
    updated = 0
    skipped = 0
    errors = 0
    total = len(all_tids)

    for i, tid in enumerate(all_tids, 1):
        meta = mapping.get(tid)
        if not meta:
            skipped += 1
            continue

        update_fields = {}
        if meta["country"]:
            update_fields["country"] = meta["country"]
        if meta["region"]:
            update_fields["region"] = meta["region"]
        if meta["deal_owner"]:
            update_fields["deal_owner"] = meta["deal_owner"]
        if meta["segment"]:
            update_fields["segment"] = meta["segment"]
        if meta["amount"] is not None:
            update_fields["amount"] = meta["amount"]

        if not update_fields:
            skipped += 1
            continue

        try:
            supabase.table("transcript_insights").update(update_fields).eq("transcript_id", tid).execute()
            updated += 1
        except Exception as e:
            logger.warning(f"Error updating {tid}: {e}")
            errors += 1

        if i % 500 == 0:
            logger.info(f"  Progress: {i}/{total} ({updated} updated, {skipped} skipped, {errors} errors)")

    logger.info(f"Update complete: {updated} updated, {skipped} skipped, {errors} errors")


def verify(supabase):
    """Verify the fix with a sample."""
    logger.info("\n=== VERIFICATION ===")

    # Check the test deal
    resp = (
        supabase.table("raw_deals")
        .select("deal_id,deal_name,country,region,segment,ae_owner_name,amount")
        .eq("deal_id", "38821447040")
        .execute()
    )
    if resp.data:
        d = resp.data[0]
        logger.info(f"Deal 38821447040: {d['deal_name']}")
        logger.info(f"  country={d['country']}, region={d['region']}, segment={d['segment']}")
        logger.info(f"  AE={d['ae_owner_name']}, amount={d['amount']}")

    # Check insights for that deal
    resp = (
        supabase.table("transcript_insights")
        .select("transcript_id,country,region,deal_owner,segment,amount")
        .eq("deal_id", "38821447040")
        .limit(3)
        .execute()
    )
    if resp.data:
        logger.info(f"\nInsights for deal 38821447040 ({len(resp.data)} shown):")
        for r in resp.data:
            logger.info(f"  tid={r['transcript_id']}: country={r['country']}, "
                       f"region={r['region']}, AE={r['deal_owner']}, "
                       f"segment={r['segment']}, amount={r['amount']}")

    # Country distribution
    countries = {}
    offset = 0
    while True:
        resp = (
            supabase.table("transcript_insights")
            .select("country")
            .range(offset, offset + 999)
            .execute()
        )
        for r in resp.data:
            c = r.get("country") or "(null)"
            countries[c] = countries.get(c, 0) + 1
        if len(resp.data) < 1000:
            break
        offset += 1000

    logger.info("\nTop 15 countries in transcript_insights:")
    for c, cnt in sorted(countries.items(), key=lambda x: -x[1])[:15]:
        logger.info(f"  {c}: {cnt}")

    # Segment distribution
    segments = {}
    offset = 0
    while True:
        resp = (
            supabase.table("transcript_insights")
            .select("segment")
            .range(offset, offset + 999)
            .execute()
        )
        for r in resp.data:
            s = r.get("segment") or "(null)"
            segments[s] = segments.get(s, 0) + 1
        if len(resp.data) < 1000:
            break
        offset += 1000

    logger.info("\nSegments in transcript_insights:")
    for s, cnt in sorted(segments.items(), key=lambda x: -x[1]):
        logger.info(f"  {s}: {cnt}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Fix deal metadata in insights")
    parser.add_argument("--verify-only", action="store_true", help="Only verify current state")
    parser.add_argument("--skip-reingest", action="store_true", help="Skip HubSpot re-ingestion")
    args = parser.parse_args()

    from db import get_client

    if args.verify_only:
        verify(get_client())
    else:
        # Step 1: Re-ingest HubSpot deals
        if not args.skip_reingest:
            supabase = reingest_hubspot_deals()
        else:
            supabase = get_client()

        # Step 2: Update existing insights
        update_existing_insights(supabase)

        # Step 3: Verify
        verify(supabase)
        logger.info("\nDone!")
