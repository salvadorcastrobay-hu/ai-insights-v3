"""
Orchestrator: fetch -> chunk -> batch -> parse -> load.
Manages the full pipeline with state tracking for resume capability.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from supabase import Client as SupabaseClient
from openai import OpenAI

from src import config
from src.skills.chunking import chunk_transcript, count_tokens
from src.connectors.supabase import (
    fetch_transcripts,
    get_processed_hashes,
    get_processed_transcript_ids,
    insert_insights,
)
from src.skills.batch_processing import (
    get_openai_client,
    process_single,
    create_batch_jsonl,
    submit_batch,
    poll_batch,
    download_batch_results,
    download_batch_errors,
)
from src.skills.response_parsing import parse_response, get_new_features

logger = logging.getLogger(__name__)


# ── State management ──

def load_state() -> dict:
    if os.path.exists(config.STATE_FILE):
        with open(config.STATE_FILE, "r") as f:
            return json.load(f)
    return {}


def save_state(state: dict) -> None:
    with open(config.STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, default=str)


# ── Pipeline ──

def run_pipeline(
    supabase: SupabaseClient,
    sample: int | None = None,
    model: str | None = None,
    dry_run: bool = False,
    resume: bool = False,
    force: bool = False,
) -> dict:
    """
    Run the full pipeline.

    Args:
        supabase: Supabase client
        sample: If set, process only N transcripts using direct API
        model: Model override (default from config)
        dry_run: Generate JSONL but don't submit
        resume: Resume from state.json

    Returns:
        Summary dict with counts and stats.
    """
    model = model or config.OPENAI_MODEL
    openai_client = get_openai_client()
    state = load_state() if resume else {}
    stats = {"transcripts": 0, "chunks": 0, "insights_parsed": 0, "insights_inserted": 0, "errors": 0}

    # ── Step 1: Check for pending batch (resume) ──
    if resume and state.get("pending_batch_id"):
        logger.info(f"Resuming batch: {state['pending_batch_id']}")
        return _resume_batch(
            supabase, openai_client, state, model, stats
        )

    # ── Step 2: Fetch transcripts ──
    logger.info("Fetching transcripts from Supabase...")
    transcripts = fetch_transcripts(supabase, sample=sample)
    if not transcripts:
        logger.warning("No transcripts found")
        return stats
    stats["transcripts"] = len(transcripts)
    logger.info(f"Found {len(transcripts)} transcripts")

    # ── Step 3: Filter already processed ──
    if force:
        logger.info("Force mode: skipping already-processed filter")
    else:
        processed_ids = get_processed_transcript_ids(supabase, prompt_version=config.PROMPT_VERSION)
        logger.info(f"Found {len(processed_ids)} already-processed transcript IDs (version={config.PROMPT_VERSION})")
        if not sample:
            before = len(transcripts)
            transcripts = [t for t in transcripts
                           if (t.get("transcript_id") or t.get("id", "unknown")) not in processed_ids]
            logger.info(f"Filtered: {before} -> {len(transcripts)} transcripts remaining")

    # ── Step 3b: Deduplicate by transcript_id (view may return duplicates) ──
    seen_tids: set[str] = set()
    unique_transcripts = []
    for t in transcripts:
        tid = t.get("transcript_id") or t.get("id", "unknown")
        if tid not in seen_tids:
            seen_tids.add(tid)
            unique_transcripts.append(t)
    if len(unique_transcripts) < len(transcripts):
        logger.info(f"Deduplicated: {len(transcripts)} -> {len(unique_transcripts)} unique transcripts")
    transcripts = unique_transcripts

    # ── Step 4: Chunk transcripts ──
    all_chunks = []
    for t in transcripts:
        tid = t.get("transcript_id") or t.get("id", "unknown")
        text = t.get("transcript_text") or t.get("text") or t.get("content", "")
        if not text:
            logger.warning(f"Empty transcript: {tid}")
            continue

        metadata = {
            "transcript_id": tid,
            "deal_id": t.get("deal_id"),
            "deal_name": t.get("deal_name"),
            "company_name": t.get("company_name"),
            "region": t.get("deal_region") or t.get("region"),
            "country": t.get("deal_country") or t.get("country"),
            "industry": t.get("industry"),
            "company_size": t.get("company_size"),
            "segment": t.get("segment"),
            "amount": t.get("amount"),
            "deal_stage": t.get("deal_stage"),
            "deal_owner": t.get("deal_owner"),
            "call_date": str(t.get("call_date", "")) if t.get("call_date") else None,
        }

        chunks = chunk_transcript(tid, text)
        for c in chunks:
            custom_id = f"{tid}__{c['chunk_index']}"
            all_chunks.append({
                "custom_id": custom_id,
                "transcript_id": tid,
                "chunk_index": c["chunk_index"],
                "transcript_text": c["text"],
                "token_count": c["token_count"],
                "metadata": metadata,
            })

    stats["chunks"] = len(all_chunks)
    logger.info(f"Total chunks to process: {len(all_chunks)}")

    if not all_chunks:
        logger.info("Nothing to process")
        return stats

    # ── Step 5: Process ──
    if sample:
        # Direct API mode for small samples
        return _process_direct(
            supabase, openai_client, all_chunks, model, stats
        )
    elif dry_run:
        # Generate JSONL only
        jsonl_path = create_batch_jsonl(all_chunks, model=model)
        logger.info(f"Dry run: JSONL created at {jsonl_path}")
        stats["jsonl_path"] = jsonl_path
        return stats
    else:
        # Batch API mode
        return _process_batch(
            supabase, openai_client, all_chunks, model, stats
        )


def _process_direct(
    supabase: SupabaseClient,
    openai_client: OpenAI,
    chunks: list[dict],
    model: str,
    stats: dict,
) -> dict:
    """Process chunks one by one via direct API (for --sample mode)."""
    logger.info(f"Processing {len(chunks)} chunks via direct API ({model})...")

    for i, chunk in enumerate(chunks, 1):
        tid = chunk["transcript_id"]
        cidx = chunk["chunk_index"]
        logger.info(f"[{i}/{len(chunks)}] Processing {tid} chunk {cidx}...")

        try:
            result = process_single(
                openai_client,
                chunk["transcript_text"],
                chunk["metadata"],
                model=model,
            )

            rows = parse_response(
                result,
                tid,
                cidx,
                chunk["metadata"],
                model_used=model,
                supabase_client=supabase,
            )

            stats["insights_parsed"] += len(rows)

            if rows:
                inserted = insert_insights(supabase, rows)
                stats["insights_inserted"] += inserted
                logger.info(f"  -> {len(rows)} insights parsed, {inserted} inserted")

        except Exception as e:
            logger.error(f"Error processing {tid}[{cidx}]: {e}")
            stats["errors"] += 1

    _log_summary(stats)
    return stats


MAX_REQUESTS_PER_BATCH = 2000  # Stay under OpenAI's 40M enqueued token limit


def _process_batch(
    supabase: SupabaseClient,
    openai_client: OpenAI,
    chunks: list[dict],
    model: str,
    stats: dict,
) -> dict:
    """Process all chunks via Batch API, splitting into sub-batches if needed."""
    logger.info(f"Total requests: {len(chunks)} ({model})")

    if len(chunks) <= MAX_REQUESTS_PER_BATCH:
        jsonl_path = create_batch_jsonl(chunks, model=model)
        return _submit_and_process_single_batch(
            supabase, openai_client, chunks, jsonl_path, model, stats
        )

    # Split into sub-batches
    num_batches = (len(chunks) + MAX_REQUESTS_PER_BATCH - 1) // MAX_REQUESTS_PER_BATCH
    requests_per_batch = MAX_REQUESTS_PER_BATCH
    logger.info(
        f"Splitting into {num_batches} sub-batches of ~{requests_per_batch} requests each."
    )

    for batch_idx in range(num_batches):
        start = batch_idx * requests_per_batch
        end = min(start + requests_per_batch, len(chunks))
        sub_chunks = chunks[start:end]
        logger.info(f"\n--- Sub-batch {batch_idx + 1}/{num_batches}: {len(sub_chunks)} requests ---")

        sub_jsonl = create_batch_jsonl(sub_chunks, model=model)
        _submit_and_process_single_batch(
            supabase, openai_client, sub_chunks, sub_jsonl, model, stats
        )

        if batch_idx + 1 < num_batches:
            time.sleep(5)  # Brief pause between sub-batches

    _log_summary(stats)
    return stats


def _submit_and_process_single_batch(
    supabase: SupabaseClient,
    openai_client: OpenAI,
    chunks: list[dict],
    jsonl_path: str,
    model: str,
    stats: dict,
) -> dict:
    """Submit a single batch JSONL, poll, and process results."""
    # Submit batch
    batch_id = submit_batch(openai_client, jsonl_path)

    # Save state for resume
    chunk_map = {c["custom_id"]: c for c in chunks}
    state = {
        "pending_batch_id": batch_id,
        "jsonl_path": jsonl_path,
        "model": model,
        "chunk_count": len(chunks),
        "started_at": time.time(),
        "chunk_map_path": jsonl_path.replace(".jsonl", "_map.json"),
    }
    with open(state["chunk_map_path"], "w") as f:
        json.dump(
            {cid: {"transcript_id": c["transcript_id"], "chunk_index": c["chunk_index"], "metadata": c["metadata"]}
             for cid, c in chunk_map.items()},
            f, default=str,
        )
    save_state(state)

    # Poll until done
    logger.info(f"Polling batch {batch_id}...")
    result = poll_batch(openai_client, batch_id)

    if result["status"] != "completed":
        logger.error(f"Batch {batch_id} ended with status: {result['status']}")
        if result.get("error_file_id"):
            errors = download_batch_errors(openai_client, result["error_file_id"])
            for err in errors[:10]:
                logger.error(f"  Batch error: {err}")
        stats["errors"] += result.get("failed", 0)
        save_state({**state, "batch_status": result["status"]})
        return stats

    # Download and parse results
    return _process_batch_results(
        supabase, openai_client, result, state, model, stats
    )


def _resume_batch(
    supabase: SupabaseClient,
    openai_client: OpenAI,
    state: dict,
    model: str,
    stats: dict,
) -> dict:
    """Resume a pending batch."""
    batch_id = state["pending_batch_id"]
    model = state.get("model", model)

    result = poll_batch(openai_client, batch_id)

    if result["status"] != "completed":
        logger.error(f"Batch {batch_id} status: {result['status']}")
        stats["errors"] = result.get("failed", 0)
        return stats

    return _process_batch_results(
        supabase, openai_client, result, state, model, stats
    )


def _process_batch_results(
    supabase: SupabaseClient,
    openai_client: OpenAI,
    batch_result: dict,
    state: dict,
    model: str,
    stats: dict,
) -> dict:
    """Download batch results, parse, and load into DB."""
    # Load chunk map
    chunk_map_path = state.get("chunk_map_path")
    if chunk_map_path and os.path.exists(chunk_map_path):
        with open(chunk_map_path, "r") as f:
            chunk_map = json.load(f)
    else:
        chunk_map = {}

    # Download results
    results = download_batch_results(openai_client, batch_result["output_file_id"])
    stats["chunks"] = len(results)

    all_rows = []
    for item in results:
        custom_id = item["custom_id"]
        response = item["response"]

        if not response:
            stats["errors"] += 1
            continue

        # Get metadata from chunk map
        chunk_info = chunk_map.get(custom_id, {})
        tid = chunk_info.get("transcript_id", custom_id.split("__")[0])
        cidx = chunk_info.get("chunk_index", 0)
        metadata = chunk_info.get("metadata", {})

        rows = parse_response(
            response,
            tid,
            cidx,
            metadata,
            model_used=model,
            batch_id=batch_result["id"],
            supabase_client=supabase,
        )
        all_rows.extend(rows)

    stats["insights_parsed"] = len(all_rows)

    # Insert all rows
    if all_rows:
        inserted = insert_insights(supabase, all_rows)
        stats["insights_inserted"] = inserted

    # Clear state
    save_state({"last_completed_batch": batch_result["id"], "completed_at": time.time()})

    _log_summary(stats)

    # Log new features discovered
    new_features = get_new_features()
    if new_features:
        logger.info(f"New features discovered: {len(new_features)}")
        for code, info in new_features.items():
            logger.info(f"  - {code}: {info['display_name']} (module: {info.get('module', '—')})")

    return stats


def _log_summary(stats: dict) -> None:
    logger.info("=" * 50)
    logger.info("Pipeline Summary:")
    logger.info(f"  Transcripts:      {stats.get('transcripts', 0)}")
    logger.info(f"  Chunks processed: {stats.get('chunks', 0)}")
    logger.info(f"  Insights parsed:  {stats.get('insights_parsed', 0)}")
    logger.info(f"  Insights inserted:{stats.get('insights_inserted', 0)}")
    logger.info(f"  Errors:           {stats.get('errors', 0)}")
    logger.info("=" * 50)


def get_batch_status(openai_client: OpenAI | None = None) -> dict | None:
    """Check current batch status from state.json."""
    state = load_state()
    batch_id = state.get("pending_batch_id")
    if not batch_id:
        last = state.get("last_completed_batch")
        if last:
            return {"status": "no_pending", "last_completed": last}
        return None

    if openai_client is None:
        openai_client = get_openai_client()

    batch = openai_client.batches.retrieve(batch_id)
    return {
        "batch_id": batch.id,
        "status": batch.status,
        "total": batch.request_counts.total if batch.request_counts else 0,
        "completed": batch.request_counts.completed if batch.request_counts else 0,
        "failed": batch.request_counts.failed if batch.request_counts else 0,
    }
