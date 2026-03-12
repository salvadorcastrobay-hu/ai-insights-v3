"""
Supabase client: read transcripts, write insights, manage taxonomy tables.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from supabase import create_client, Client
from tenacity import retry, stop_after_attempt, wait_exponential

import config
from taxonomy import (
    HR_CATEGORIES, MODULES, PAIN_SUBTYPES, DEAL_FRICTION_SUBTYPES,
    FAQ_SUBTYPES, COMPETITIVE_RELATIONSHIPS, COMPETITORS, SEED_FEATURE_NAMES,
)

logger = logging.getLogger(__name__)


def get_client() -> Client:
    return create_client(config.SUPABASE_URL, config.SUPABASE_KEY)


# ── Schema setup ──

def execute_schema_direct() -> None:
    """Execute schema.sql via direct PostgreSQL connection (psycopg2)."""
    import psycopg2

    schema_path = Path(config.SCHEMA_FILE)
    sql = schema_path.read_text(encoding="utf-8")

    db_params = config.get_db_connection_params()
    if not db_params["password"]:
        raise RuntimeError(
            "SUPABASE_DB_PASSWORD not set in .env. "
            "Find it in: Supabase Dashboard > Settings > Database > Database password"
        )

    logger.info(f"Connecting to PostgreSQL at {db_params['host']}...")
    conn = psycopg2.connect(**db_params)
    conn.autocommit = True

    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        logger.info("Schema executed successfully")
    finally:
        conn.close()


# ── Taxonomy seeding ──

def seed_taxonomy(client: Client) -> dict[str, int]:
    """Insert all taxonomy data into reference tables. Returns counts."""
    counts = {}

    # HR Categories
    rows = [
        {"code": code, "display_name": v["display_name"], "sort_order": v["sort_order"]}
        for code, v in HR_CATEGORIES.items()
    ]
    _upsert_batch(client, "tax_hr_categories", rows, "code")
    counts["hr_categories"] = len(rows)

    # Modules
    rows = [
        {
            "code": code,
            "display_name": v["display_name"],
            "hr_category": v["hr_category"],
            "status": v["status"],
            "sort_order": v["sort_order"],
        }
        for code, v in MODULES.items()
    ]
    _upsert_batch(client, "tax_modules", rows, "code")
    counts["modules"] = len(rows)

    # Pain Subtypes
    rows = [
        {
            "code": code,
            "display_name": v["display_name"],
            "description": v.get("description"),
            "theme": v["theme"],
            "module": v.get("module"),
            "sort_order": v.get("sort_order", 0),
        }
        for code, v in PAIN_SUBTYPES.items()
    ]
    _upsert_batch(client, "tax_pain_subtypes", rows, "code")
    counts["pain_subtypes"] = len(rows)

    # Deal Friction Subtypes
    rows = [
        {"code": code, "display_name": v["display_name"], "description": v.get("description")}
        for code, v in DEAL_FRICTION_SUBTYPES.items()
    ]
    _upsert_batch(client, "tax_deal_friction_subtypes", rows, "code")
    counts["deal_friction_subtypes"] = len(rows)

    # FAQ Subtypes
    rows = [
        {"code": code, "display_name": v["display_name"], "description": v.get("description")}
        for code, v in FAQ_SUBTYPES.items()
    ]
    _upsert_batch(client, "tax_faq_subtypes", rows, "code")
    counts["faq_subtypes"] = len(rows)

    # Competitive Relationships
    rows = [
        {"code": code, "display_name": v["display_name"], "description": v.get("description")}
        for code, v in COMPETITIVE_RELATIONSHIPS.items()
    ]
    _upsert_batch(client, "tax_competitive_relationships", rows, "code")
    counts["competitive_relationships"] = len(rows)

    # Competitors
    rows = [
        {"name": name, "region": region}
        for name, region in COMPETITORS.items()
    ]
    _upsert_batch(client, "tax_competitors", rows, "name")
    counts["competitors"] = len(rows)

    # Feature Names (seed)
    rows = [
        {
            "code": code,
            "display_name": v["display_name"],
            "suggested_module": v.get("suggested_module"),
            "is_seed": True,
        }
        for code, v in SEED_FEATURE_NAMES.items()
    ]
    _upsert_batch(client, "tax_feature_names", rows, "code")
    counts["feature_names"] = len(rows)

    return counts


def _upsert_batch(client: Client, table: str, rows: list[dict], pk_column: str) -> None:
    """Upsert rows into a table in batches."""
    if not rows:
        return
    batch_size = 100
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            client.table(table).upsert(batch, on_conflict=pk_column).execute()
        except Exception as e:
            logger.error(f"Upsert error on {table}: {e}")
            raise


# ── Read transcripts ──

def fetch_transcripts(
    client: Client,
    sample: int | None = None,
) -> list[dict]:
    """Fetch transcripts from the Supabase view (paginated)."""
    if sample:
        response = (
            client.table(config.TRANSCRIPT_VIEW_NAME)
            .select("*")
            .limit(sample)
            .execute()
        )
        logger.info(f"Fetched {len(response.data)} transcripts (sample)")
        return response.data

    all_data = []
    offset = 0
    page_size = 200  # Small pages to avoid timeout on large transcript_text blobs
    while True:
        response = (
            client.table(config.TRANSCRIPT_VIEW_NAME)
            .select("*")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_data.extend(response.data)
        if len(response.data) < page_size:
            break
        offset += page_size
        if len(all_data) % 1000 == 0:
            logger.info(f"  Loading transcripts: {len(all_data)} rows...")
    logger.info(f"Fetched {len(all_data)} transcripts")
    return all_data


def get_processed_hashes(client: Client) -> set[str]:
    """Get all content_hash values already in the DB for dedup."""
    all_hashes = set()
    offset = 0
    page_size = 1000
    while True:
        response = (
            client.table("transcript_insights")
            .select("content_hash")
            .not_.is_("content_hash", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_hashes.update(row["content_hash"] for row in response.data)
        if len(response.data) < page_size:
            break
        offset += page_size
    return all_hashes


def get_processed_transcript_ids(client: Client) -> set[str]:
    """Get distinct transcript_ids already processed (for skipping)."""
    all_ids = set()
    offset = 0
    page_size = 1000
    while True:
        response = (
            client.table("transcript_insights")
            .select("transcript_id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_ids.update(row["transcript_id"] for row in response.data)
        if len(response.data) < page_size:
            break
        offset += page_size
    return all_ids


# ── Write insights ──

def compute_content_hash(insight: dict, transcript_id: str, chunk: int) -> str:
    """SHA256 hash of the core insight fields for dedup."""
    key_parts = [
        transcript_id,
        str(chunk),
        insight.get("insight_type", ""),
        insight.get("insight_subtype", ""),
        insight.get("summary", ""),
    ]
    raw = "|".join(key_parts)
    return hashlib.sha256(raw.encode()).hexdigest()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
def insert_insights(client: Client, rows: list[dict]) -> int:
    """Insert insight rows, skipping duplicates via content_hash."""
    if not rows:
        return 0
    inserted = 0
    batch_size = 50
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            result = (
                client.table("transcript_insights")
                .upsert(batch, on_conflict="content_hash")
                .execute()
            )
            inserted += len(result.data)
        except Exception as e:
            logger.error(f"Insert error: {e}")
            # Try one by one for partial success
            for row in batch:
                try:
                    client.table("transcript_insights").upsert(
                        row, on_conflict="content_hash"
                    ).execute()
                    inserted += 1
                except Exception as row_e:
                    logger.warning(f"Skip row: {row_e}")
    return inserted


# ── Extend feature names ──

# ── QA functions ──

def fetch_transcripts_with_insights(client: Client, sample: int | None = None) -> list[dict]:
    """Fetch transcripts that already have insights extracted, with their insights grouped."""
    # Get distinct transcript_ids from insights table (paginated)
    seen = set()
    transcript_ids = []
    offset = 0
    page_size = 1000
    target = sample or 999999
    while len(transcript_ids) < target:
        response = (
            client.table("transcript_insights")
            .select("transcript_id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not response.data:
            break
        for row in response.data:
            tid = row["transcript_id"]
            if tid not in seen:
                seen.add(tid)
                transcript_ids.append(tid)
                if len(transcript_ids) >= target:
                    break
        if len(response.data) < page_size:
            break
        offset += page_size

    if not transcript_ids:
        return []

    results = []
    for tid in transcript_ids:
        # Fetch transcript text
        t_resp = (
            client.table("raw_transcripts")
            .select("recording_id, transcript_text")
            .eq("recording_id", tid)
            .limit(1)
            .execute()
        )
        if not t_resp.data:
            continue

        # Fetch insights for this transcript
        i_resp = (
            client.table("transcript_insights")
            .select("*")
            .eq("transcript_id", tid)
            .execute()
        )

        results.append({
            "transcript_id": tid,
            "transcript_text": t_resp.data[0]["transcript_text"],
            "insights": i_resp.data,
        })

    return results


def insert_qa_results(client: Client, rows: list[dict]) -> int:
    """Insert QA evaluation results."""
    if not rows:
        return 0
    inserted = 0
    for row in rows:
        try:
            client.table("qa_results").insert(row).execute()
            inserted += 1
        except Exception as e:
            logger.warning(f"QA result insert error: {e}")
    return inserted


# ── Extend feature names ──

def insert_new_feature(client: Client, code: str, display_name: str, module: str | None) -> None:
    """Insert a new (non-seed) feature name discovered by the LLM."""
    try:
        client.table("tax_feature_names").upsert(
            {
                "code": code,
                "display_name": display_name,
                "suggested_module": module,
                "is_seed": False,
            },
            on_conflict="code",
        ).execute()
        logger.info(f"New feature registered: {code}")
    except Exception as e:
        logger.warning(f"Could not insert feature {code}: {e}")
