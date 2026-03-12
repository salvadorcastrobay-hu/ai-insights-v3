"""
Process remaining transcripts via Direct API with concurrency.
Uses ThreadPoolExecutor for parallel OpenAI API calls.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import openai

import config
from batch_processor import get_openai_client
from models import get_openai_json_schema
from prompt_builder import build_system_prompt, build_user_prompt
from parser import parse_response, get_new_features
from db import get_client, fetch_transcripts, get_processed_transcript_ids, insert_insights
from chunker import chunk_transcript
from pipeline import save_state

CONCURRENCY = 30
MODEL = "gpt-4o-mini"

# Shared state
_lock = Lock()
_stats = {"parsed": 0, "inserted": 0, "errors": 0, "processed_chunks": 0}
_system_prompt = None
_response_format = None


def _get_prompts():
    global _system_prompt, _response_format
    if _system_prompt is None:
        _system_prompt = build_system_prompt()
        _response_format = get_openai_json_schema()
    return _system_prompt, _response_format


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(min=5, max=120),
    retry=retry_if_exception_type((openai.RateLimitError, openai.APIConnectionError, openai.APITimeoutError)),
)
def process_chunk(client: OpenAI, chunk: dict) -> dict | None:
    """Process a single chunk via direct API with retries."""
    system_prompt, response_format = _get_prompts()
    user_prompt = build_user_prompt(chunk["transcript_text"], chunk["metadata"])

    response = client.chat.completions.create(
        model=MODEL,
        temperature=0,
        response_format=response_format,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    content = response.choices[0].message.content
    return json.loads(content)


def process_and_insert(openai_client: OpenAI, supabase, chunk: dict, total: int) -> None:
    """Process one chunk and insert results."""
    cid = chunk["custom_id"]
    tid = chunk["transcript_id"]
    cidx = chunk["chunk_index"]

    try:
        result = process_chunk(openai_client, chunk)

        rows = parse_response(
            result, tid, cidx, chunk["metadata"],
            model_used=MODEL,
            supabase_client=supabase,
        )

        if rows:
            inserted = insert_insights(supabase, rows)
            with _lock:
                _stats["parsed"] += len(rows)
                _stats["inserted"] += inserted
                _stats["processed_chunks"] += 1
                n = _stats["processed_chunks"]
                if n % 50 == 0 or n == total:
                    logger.info(
                        f"Progress: {n}/{total} chunks | "
                        f"{_stats['parsed']} insights parsed, "
                        f"{_stats['inserted']} inserted, "
                        f"{_stats['errors']} errors"
                    )
        else:
            with _lock:
                _stats["processed_chunks"] += 1

    except Exception as e:
        with _lock:
            _stats["errors"] += 1
            _stats["processed_chunks"] += 1
        logger.error(f"Error {cid}: {e}")


def main():
    logger.info("=" * 60)
    logger.info("DIRECT API PROCESSING (concurrent)")
    logger.info(f"Model: {MODEL}, Concurrency: {CONCURRENCY}")
    logger.info("=" * 60)

    supabase = get_client()
    openai_client = get_openai_client()

    # Fetch all transcripts
    logger.info("Fetching transcripts...")
    transcripts = fetch_transcripts(supabase)
    logger.info(f"Total transcripts: {len(transcripts)}")

    # Filter already processed
    processed_ids = get_processed_transcript_ids(supabase)
    logger.info(f"Already processed: {len(processed_ids)} transcript IDs")
    transcripts = [t for t in transcripts
                   if (t.get("transcript_id") or t.get("id", "unknown")) not in processed_ids]
    logger.info(f"Remaining: {len(transcripts)} transcripts")

    if not transcripts:
        logger.info("Nothing to process!")
        return

    # Chunk all transcripts
    logger.info("Chunking transcripts...")
    all_chunks = []
    for t in transcripts:
        tid = t.get("transcript_id") or t.get("id", "unknown")
        text = t.get("transcript_text") or ""
        if not text:
            continue

        metadata = {
            "transcript_id": tid,
            "deal_id": t.get("deal_id"),
            "deal_name": t.get("deal_name"),
            "company_name": t.get("company_name"),
            "region": t.get("deal_region") or t.get("company_region"),
            "country": t.get("country"),
            "industry": t.get("deal_industry") or t.get("company_industry"),
            "company_size": t.get("company_size"),
            "deal_stage": t.get("deal_stage"),
            "deal_owner": t.get("deal_owner"),
            "call_date": str(t.get("call_date", "")) if t.get("call_date") else None,
        }

        chunks = chunk_transcript(tid, text)
        for c in chunks:
            all_chunks.append({
                "custom_id": f"{tid}__{c['chunk_index']}",
                "transcript_id": tid,
                "chunk_index": c["chunk_index"],
                "transcript_text": c["text"],
                "metadata": metadata,
            })

    logger.info(f"Total chunks to process: {len(all_chunks)}")

    # Pre-build prompts (cache)
    _get_prompts()
    logger.info("System prompt cached. Starting processing...")

    start_time = time.time()

    # Process with thread pool
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = {
            executor.submit(process_and_insert, openai_client, supabase, chunk, len(all_chunks)): chunk
            for chunk in all_chunks
        }

        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                logger.error(f"Unhandled: {e}")

    elapsed = time.time() - start_time

    # Final summary
    logger.info(f"\n{'='*60}")
    logger.info("FINAL SUMMARY")
    logger.info(f"{'='*60}")
    logger.info(f"Chunks processed:      {_stats['processed_chunks']}/{len(all_chunks)}")
    logger.info(f"Insights parsed:       {_stats['parsed']}")
    logger.info(f"Insights inserted:     {_stats['inserted']}")
    logger.info(f"Errors:                {_stats['errors']}")
    logger.info(f"Time:                  {elapsed/60:.1f} minutes")
    logger.info(f"Rate:                  {len(all_chunks)/elapsed:.1f} chunks/sec")

    new_features = get_new_features()
    if new_features:
        logger.info(f"New features discovered: {len(new_features)}")

    save_state({
        "last_completed": "direct_api",
        "completed_at": time.time(),
        "total_parsed": _stats["parsed"],
        "total_inserted": _stats["inserted"],
    })


if __name__ == "__main__":
    main()
