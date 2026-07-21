"""
One-off parallel orchestrator for the v3.2 mass re-run.

Context: main.py run submits sub-batches SERIALLY (one completes+inserts
before the next is submitted), which made the run crawl behind OpenAI's
variable batch queue. This script:

  1. ADOPTS the already-in-flight sub-batch 4 (batch id from state.json,
     chunk map already on disk) -- polls + inserts it when it completes.
     No cancel, no waste of its in-progress work.
  2. Reconstructs the full chunk list and excludes every custom_id already
     submitted in sub-batches 1-4 (read from their _map.json files), leaving
     exactly the sub-batches 5-14 chunks -- at the chunk level, so no
     boundary transcript is lost.
  3. Submits the remaining chunks as parallel batches in a bounded pool
     (default 5 concurrent) to stay under OpenAI's enqueued-token limit,
     inserting each as it completes.

Run with PROMPT_VERSION=v3.2 in the env (parser stamps config.PROMPT_VERSION).
"""

from __future__ import annotations

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import config
from db import get_client, fetch_transcripts, insert_insights
from chunker import chunk_transcript
from parser import parse_response, get_new_features
from batch_processor import (
    get_openai_client,
    create_batch_jsonl,
    submit_batch,
    poll_batch,
    download_batch_results,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("parallel_rerun")

MODEL = "gpt-5.4-mini"
SUBBATCH_SIZE = 1000
MAX_CONCURRENT = 5

# Sub-batches 1-4 of THIS v3.2 run (Jul 15-16). Their custom_ids are already
# submitted; exclude them so we only send 5-14.
THIS_RUN_MAP_FILES = [
    "batch_input_1784120888_map.json",  # sub-batch 1 (done)
    "batch_input_1784129442_map.json",  # sub-batch 2 (done)
    "batch_input_1784133554_map.json",  # sub-batch 3 (done)
    "batch_input_1784206397_map.json",  # sub-batch 4 (in flight, adopted below)
]
ADOPT_BATCH_ID = "batch_6a58d45bc8dc8190b653c3a059e2dca2"  # sub-batch 4
ADOPT_MAP_FILE = "batch_input_1784206397_map.json"


def _build_metadata(t: dict, tid: str) -> dict:
    return {
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
        "cx_owner": t.get("cx_owner"),
        "call_date": str(t.get("call_date", "")) if t.get("call_date") else None,
    }


def _insert_results(supabase, client, batch_result, chunk_map, label) -> int:
    """Download + parse + insert one completed batch. Returns inserted count."""
    results = download_batch_results(client, batch_result["output_file_id"])
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
            model_used=MODEL, batch_id=batch_result["id"], supabase_client=supabase,
        )
        all_rows.extend(rows)
    inserted = insert_insights(supabase, all_rows) if all_rows else 0
    logger.info(f"[{label}] parsed={len(all_rows)} inserted={inserted} errors={errors}")
    return inserted


def _submit_with_retry(client, jsonl_path, label, max_retries=6) -> str:
    """Submit a batch; back off and retry if OpenAI rejects for queue/token limits."""
    for attempt in range(1, max_retries + 1):
        try:
            return submit_batch(client, jsonl_path)
        except Exception as e:
            msg = str(e).lower()
            transient = any(k in msg for k in ("token_limit", "enqueued", "rate", "limit", "429", "timeout"))
            if not transient or attempt == max_retries:
                raise
            wait = min(600, 60 * attempt)
            logger.warning(f"[{label}] submit rejected ({e}); retry {attempt}/{max_retries} in {wait}s")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def _process_group(chunks, label) -> dict:
    """Full lifecycle for one new sub-batch: jsonl -> submit -> poll -> insert."""
    supabase = get_client()
    client = get_openai_client()
    logger.info(f"[{label}] creating JSONL for {len(chunks)} chunks...")
    # Unique path per worker -- create_batch_jsonl's default name is int(time.time()),
    # which collides when several threads start in the same second (they'd clobber
    # each other's file). Pin an explicit, label-scoped path instead.
    os.makedirs(config.BATCH_DIR, exist_ok=True)
    jsonl_path = os.path.join(config.BATCH_DIR, f"batch_input_v32par_{label}.jsonl")
    jsonl_path = create_batch_jsonl(chunks, output_path=jsonl_path, model=MODEL)
    chunk_map = {
        c["custom_id"]: {
            "transcript_id": c["transcript_id"],
            "chunk_index": c["chunk_index"],
            "metadata": c["metadata"],
        }
        for c in chunks
    }
    # Persist the map so this sub-batch can be adopted/resumed if the run dies.
    with open(jsonl_path.replace(".jsonl", "_map.json"), "w") as f:
        json.dump(chunk_map, f, default=str)
    batch_id = _submit_with_retry(client, jsonl_path, label)
    logger.info(f"[{label}] submitted {batch_id}, polling...")
    result = poll_batch(client, batch_id)
    if result["status"] != "completed":
        logger.error(f"[{label}] batch {batch_id} ended {result['status']}")
        return {"label": label, "batch_id": batch_id, "status": result["status"], "inserted": 0}
    inserted = _insert_results(supabase, client, result, chunk_map, label)
    return {"label": label, "batch_id": batch_id, "status": "completed", "inserted": inserted}


def _adopt_batch4() -> dict:
    """Poll the already-in-flight sub-batch 4 and insert when done."""
    label = "adopt-sb4"
    supabase = get_client()
    client = get_openai_client()
    with open(os.path.join(config.BATCH_DIR, ADOPT_MAP_FILE)) as f:
        chunk_map = json.load(f)
    logger.info(f"[{label}] polling adopted batch {ADOPT_BATCH_ID}...")
    result = poll_batch(client, ADOPT_BATCH_ID)
    if result["status"] != "completed":
        logger.error(f"[{label}] batch ended {result['status']}")
        return {"label": label, "batch_id": ADOPT_BATCH_ID, "status": result["status"], "inserted": 0}
    inserted = _insert_results(supabase, client, result, chunk_map, label)
    return {"label": label, "batch_id": ADOPT_BATCH_ID, "status": "completed", "inserted": inserted}


def main():
    logger.info(f"PROMPT_VERSION={config.PROMPT_VERSION}  MODEL={MODEL}")

    # 1. custom_ids already submitted in sub-batches 1-4
    submitted = set()
    for mf in THIS_RUN_MAP_FILES:
        path = os.path.join(config.BATCH_DIR, mf)
        with open(path) as f:
            submitted.update(json.load(f).keys())
    logger.info(f"Already-submitted custom_ids (sub-batches 1-4): {len(submitted)}")

    # 2. Reconstruct full chunk list, exclude already-submitted
    supabase = get_client()
    logger.info("Fetching transcripts...")
    transcripts = fetch_transcripts(supabase)
    logger.info(f"Fetched {len(transcripts)} transcripts; chunking...")
    remaining = []
    seen_cids: set[str] = set()
    dupes = 0
    for t in transcripts:
        tid = t.get("transcript_id") or t.get("id", "unknown")
        text = t.get("transcript_text") or t.get("text") or ""
        if not text:
            continue
        metadata = _build_metadata(t, tid)
        for c in chunk_transcript(tid, text):
            cid = f"{tid}__{c['chunk_index']}"
            if cid in submitted:
                continue
            # v_transcripts returns a transcript once per associated deal, so the
            # same (transcript_id, chunk_index) can appear multiple times. Dedupe
            # by custom_id -- OpenAI rejects a batch with duplicate custom_ids,
            # and each chunk only needs to be extracted once.
            if cid in seen_cids:
                dupes += 1
                continue
            seen_cids.add(cid)
            remaining.append({
                "custom_id": cid,
                "transcript_id": tid,
                "chunk_index": c["chunk_index"],
                "transcript_text": c["text"],
                "token_count": c["token_count"],
                "metadata": metadata,
            })
    logger.info(f"Remaining chunks to submit in parallel: {len(remaining)} (deduped {dupes} duplicate custom_ids)")

    groups = [remaining[i:i + SUBBATCH_SIZE] for i in range(0, len(remaining), SUBBATCH_SIZE)]
    logger.info(f"Split into {len(groups)} parallel sub-batches (pool={MAX_CONCURRENT})")

    total_inserted = 0
    results = []

    # 3. Run adopt(sb4) + all new groups in a bounded pool
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT) as pool:
        futures = []
        futures.append(pool.submit(_adopt_batch4))
        for i, g in enumerate(groups, start=5):  # sub-batches 5,6,7,...
            futures.append(pool.submit(_process_group, g, f"sb{i}"))
        for fut in as_completed(futures):
            try:
                r = fut.result()
                results.append(r)
                total_inserted += r.get("inserted", 0)
                logger.info(f"DONE {r['label']}: {r['status']} (+{r.get('inserted',0)}) | running total inserted={total_inserted}")
            except Exception as e:
                logger.error(f"A worker crashed: {e}", exc_info=True)

    logger.info("=" * 60)
    logger.info(f"ALL DONE. Sub-batches processed: {len(results)}  Total inserted this run: {total_inserted}")
    failed = [r for r in results if r["status"] != "completed"]
    if failed:
        logger.warning(f"Failed/incomplete sub-batches: {[(r['label'], r['status']) for r in failed]}")
    nf = get_new_features()
    if nf:
        logger.info(f"New feature codes discovered: {len(nf)}")


if __name__ == "__main__":
    main()
