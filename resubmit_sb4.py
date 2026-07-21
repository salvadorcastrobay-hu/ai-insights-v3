"""Resubmit sub-batch 4 (was cancelled while stuck at 544/1000) as a fresh batch.

Reuses the exact JSONL already on disk (1000 valid, unique custom_ids) and its
saved chunk map -- no reconstruction needed. Runs independently of the main
parallel orchestrator; the orchestrator's adopt-sb4 worker already saw the
cancel and exited without inserting, so there is no double-insert.
"""

from __future__ import annotations

import json
import logging
import os

import config
from db import get_client, insert_insights
from parser import parse_response
from batch_processor import get_openai_client, submit_batch, poll_batch, download_batch_results

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("resubmit_sb4")

MODEL = "gpt-5.4-mini"
JSONL = os.path.join(config.BATCH_DIR, "batch_input_1784206397.jsonl")
MAP = os.path.join(config.BATCH_DIR, "batch_input_1784206397_map.json")


def main():
    logger.info(f"PROMPT_VERSION={config.PROMPT_VERSION}  resubmitting {JSONL}")
    supabase = get_client()
    client = get_openai_client()
    with open(MAP) as f:
        chunk_map = json.load(f)

    batch_id = submit_batch(client, JSONL)
    logger.info(f"[resub-sb4] submitted {batch_id}, polling...")
    result = poll_batch(client, batch_id)
    if result["status"] != "completed":
        logger.error(f"[resub-sb4] ended {result['status']}")
        return

    results = download_batch_results(client, result["output_file_id"])
    all_rows = []
    errors = 0
    for item in results:
        cid = item["custom_id"]
        response = item["response"]
        if not response:
            errors += 1
            continue
        info = chunk_map.get(cid, {})
        tid = info.get("transcript_id", cid.split("__")[0])
        cidx = info.get("chunk_index", 0)
        metadata = info.get("metadata", {})
        rows = parse_response(
            response, tid, cidx, metadata,
            model_used=MODEL, batch_id=result["id"], supabase_client=supabase,
        )
        all_rows.extend(rows)
    inserted = insert_insights(supabase, all_rows) if all_rows else 0
    logger.info(f"[resub-sb4] DONE parsed={len(all_rows)} inserted={inserted} errors={errors}")


if __name__ == "__main__":
    main()
