"""Targeted v3.2 gap-fill: extract ONLY the transcripts missing from v3.2
(the recent ones the daily pipeline wrote under v3.0), under gpt-5.4-mini.

Why not `main.py run`:
  - fetch_transcripts() does all_data.extend(response.data); under Supabase
    flakiness a page can come back as a raw string -> extend() explodes it
    char-by-char (observed: 8.4M "rows"). Fragile full-corpus REST fetch.
  - get_processed_transcript_ids() paginates .range() WITHOUT ORDER BY ->
    non-deterministic paging undercounts the processed set (7285 vs 9867),
    which would make the run reprocess ~2500 already-done transcripts.

This script sidesteps both: computes the exact missing set + fetches only
those rows via a single psycopg2 query, then reuses the batch machinery.
"""

from __future__ import annotations

import json
import logging
import os

import config
import psycopg2
import psycopg2.extras
from chunker import chunk_transcript
from parser import parse_response, get_new_features
from db import get_client, insert_insights
from batch_processor import get_openai_client, create_batch_jsonl, submit_batch, poll_batch, download_batch_results

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("gapfill")

MODEL = "gpt-5.4-mini"

FETCH_SQL = """
SELECT transcript_id, transcript_text, deal_id, deal_name, company_name,
       deal_region, region, deal_country, country, industry, company_size,
       segment, amount, deal_stage, deal_owner, cx_owner, call_date
FROM v_transcripts vt
WHERE vt.transcript_id NOT IN (
    SELECT DISTINCT transcript_id FROM transcript_insights WHERE prompt_version = 'v3.2'
)
"""


def main():
    assert config.PROMPT_VERSION == "v3.2", f"PROMPT_VERSION debe ser v3.2, es {config.PROMPT_VERSION}"
    p = dict(config.get_db_connection_params())
    p.update(keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    conn = psycopg2.connect(**p, connect_timeout=25)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SET statement_timeout = '120s';")
    log.info("Fetching missing transcripts (not in v3.2) via psycopg2...")
    cur.execute(FETCH_SQL)
    rows = cur.fetchall()
    conn.close()
    log.info(f"Missing transcripts to process: {len(rows)}")
    if not rows:
        log.info("Nothing to process. v3.2 is up to date.")
        return

    # Build chunks (same shape as pipeline), dedup custom_ids
    chunks = []
    seen = set()
    for t in rows:
        tid = t["transcript_id"]
        text = t.get("transcript_text") or ""
        if not text.strip():
            continue
        meta = {
            "transcript_id": tid, "deal_id": t.get("deal_id"), "deal_name": t.get("deal_name"),
            "company_name": t.get("company_name"), "region": t.get("deal_region") or t.get("region"),
            "country": t.get("deal_country") or t.get("country"), "industry": t.get("industry"),
            "company_size": t.get("company_size"), "segment": t.get("segment"), "amount": t.get("amount"),
            "deal_stage": t.get("deal_stage"), "deal_owner": t.get("deal_owner"), "cx_owner": t.get("cx_owner"),
            "call_date": str(t.get("call_date", "")) if t.get("call_date") else None,
        }
        for c in chunk_transcript(tid, text):
            cid = f"{tid}__{c['chunk_index']}"
            if cid in seen:
                continue
            seen.add(cid)
            chunks.append({"custom_id": cid, "transcript_id": tid, "chunk_index": c["chunk_index"],
                           "transcript_text": c["text"], "token_count": c["token_count"], "metadata": meta})
    log.info(f"Total chunks: {len(chunks)}")

    supabase = get_client()
    client = get_openai_client()
    jsonl = os.path.join(config.BATCH_DIR, "gapfill_v32.jsonl")
    os.makedirs(config.BATCH_DIR, exist_ok=True)
    jsonl = create_batch_jsonl(chunks, output_path=jsonl, model=MODEL)
    chunk_map = {c["custom_id"]: {"transcript_id": c["transcript_id"], "chunk_index": c["chunk_index"], "metadata": c["metadata"]} for c in chunks}

    batch_id = submit_batch(client, jsonl)
    log.info(f"Submitted {batch_id}, polling...")
    result = poll_batch(client, batch_id)
    if result["status"] != "completed":
        log.error(f"Batch ended {result['status']}")
        return

    results = download_batch_results(client, result["output_file_id"])
    all_rows = []
    for item in results:
        if not item["response"]:
            continue
        info = chunk_map.get(item["custom_id"], {})
        tid = info.get("transcript_id", item["custom_id"].split("__")[0])
        rows_ = parse_response(item["response"], tid, info.get("chunk_index", 0), info.get("metadata", {}),
                               model_used=MODEL, batch_id=result["id"], supabase_client=supabase)
        all_rows.extend(rows_)
    inserted = insert_insights(supabase, all_rows) if all_rows else 0
    log.info(f"DONE parsed={len(all_rows)} inserted={inserted}")
    nf = get_new_features()
    if nf:
        log.info(f"new feature codes: {len(nf)}")


if __name__ == "__main__":
    main()
