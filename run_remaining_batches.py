"""
Submit and process 4 batch parts sequentially (token limit: 20M per batch).
Each part has ~1,389 chunks from the remaining 4,049 transcripts.
"""
from __future__ import annotations

import json
import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

from batch_processor import get_openai_client, submit_batch, poll_batch, download_batch_results
from parser import parse_response, get_new_features
from db import get_client, insert_insights
from pipeline import save_state

N_PARTS = 4
BASE_PATH = "/Users/juanbautistascelzi/ai-insights-v3/batches/batch_input_1770588940"
CHUNK_MAP_PATH = f"{BASE_PATH}_map.json"
MODEL = "gpt-4o-mini"

# Part 1 already submitted, resume polling it
RESUME_BATCH = {1: "batch_69890d7f8d008190b2454c5d48f9cc86"}


def main():
    supabase = get_client()
    openai_client = get_openai_client()

    # Load chunk map (maps custom_id -> metadata)
    with open(CHUNK_MAP_PATH, "r") as f:
        chunk_map = json.load(f)
    logger.info(f"Loaded chunk map: {len(chunk_map)} entries")

    total_parsed = 0
    total_inserted = 0
    total_errors = 0

    for part in range(1, N_PARTS + 1):
        part_path = f"{BASE_PATH}_p{part}of{N_PARTS}.jsonl"
        logger.info(f"\n{'='*60}")
        logger.info(f"PART {part}/{N_PARTS}: {part_path}")
        logger.info(f"{'='*60}")

        # Resume existing batch or submit new one
        if part in RESUME_BATCH:
            batch_id = RESUME_BATCH[part]
            logger.info(f"Resuming existing batch: {batch_id}")
        else:
            batch_id = submit_batch(openai_client, part_path)
            logger.info(f"Submitted: {batch_id}")

        save_state({
            "pending_batch_id": batch_id,
            "part": part,
            "total_parts": N_PARTS,
            "model": MODEL,
        })

        # Poll until done
        result = poll_batch(openai_client, batch_id, poll_interval=60)
        logger.info(f"Batch finished: {result['status']} ({result['completed']}/{result['total']})")

        if result["status"] != "completed":
            logger.error(f"Batch {batch_id} failed: {result['status']}")
            total_errors += result.get("failed", 0)
            continue

        # Download and parse results
        results = download_batch_results(openai_client, result["output_file_id"])
        logger.info(f"Downloaded {len(results)} results")

        all_rows = []
        for item in results:
            custom_id = item["custom_id"]
            response = item["response"]

            if not response:
                total_errors += 1
                continue

            chunk_info = chunk_map.get(custom_id, {})
            tid = chunk_info.get("transcript_id", custom_id.split("__")[0])
            cidx = chunk_info.get("chunk_index", 0)
            metadata = chunk_info.get("metadata", {})

            rows = parse_response(
                response, tid, cidx, metadata,
                model_used=MODEL, batch_id=batch_id,
                supabase_client=supabase,
            )
            all_rows.extend(rows)

        logger.info(f"Part {part}: {len(all_rows)} insights parsed")
        total_parsed += len(all_rows)

        if all_rows:
            inserted = insert_insights(supabase, all_rows)
            total_inserted += inserted
            logger.info(f"Part {part}: {inserted} insights inserted")

    # Final summary
    logger.info(f"\n{'='*60}")
    logger.info("FINAL SUMMARY")
    logger.info(f"{'='*60}")
    logger.info(f"Total insights parsed:  {total_parsed}")
    logger.info(f"Total insights inserted: {total_inserted}")
    logger.info(f"Total errors:           {total_errors}")

    new_features = get_new_features()
    if new_features:
        logger.info(f"New features discovered: {len(new_features)}")

    save_state({
        "last_completed": "all_4_parts",
        "completed_at": time.time(),
        "total_parsed": total_parsed,
        "total_inserted": total_inserted,
    })


if __name__ == "__main__":
    main()
