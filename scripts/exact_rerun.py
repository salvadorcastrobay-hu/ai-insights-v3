"""
Run exact date-window reruns that can be submitted or finalized from cloud CI.

Examples:
    python scripts/exact_rerun.py submit \
        --since-date 2026-02-06 \
        --until-date 2026-04-01 \
        --team "Account Executives"

    python scripts/exact_rerun.py finalize \
        --batch-id batch_abc123 \
        --since-date 2026-02-06 \
        --until-date 2026-04-01 \
        --team "Account Executives" \
        --wait
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

import config
from batch_processor import (
    create_batch_jsonl,
    download_batch_errors,
    download_batch_results,
    get_openai_client,
    poll_batch,
    submit_batch,
)
from chunker import chunk_transcript
from db import get_client, insert_insights
from fathom_client import _get, parse_meeting
from ingest import _upsert_batch, run_ingestion
from parser import get_new_features, parse_response


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("exact_rerun")


@dataclass(frozen=True)
class WindowConfig:
    since_date: str
    until_date: str
    timezone: str
    fetch_since_iso: str
    since_window_iso: str
    until_window_iso: str


@dataclass(frozen=True)
class RunPaths:
    base: Path
    state: Path
    jsonl: Path
    results: Path
    backup: Path


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "rerun"


def _build_window(since_date: str, until_date: str, timezone: str) -> WindowConfig:
    tz = ZoneInfo(timezone)
    start_date = date.fromisoformat(since_date)
    end_date = date.fromisoformat(until_date)
    if end_date < start_date:
        raise ValueError("--until-date must be on or after --since-date")

    since_dt = datetime.combine(start_date, dt_time.min, tzinfo=tz)
    until_dt = datetime.combine(end_date + timedelta(days=1), dt_time.min, tzinfo=tz)
    fetch_since_dt = since_dt - timedelta(seconds=1)

    return WindowConfig(
        since_date=since_date,
        until_date=until_date,
        timezone=timezone,
        fetch_since_iso=fetch_since_dt.isoformat(),
        since_window_iso=since_dt.isoformat(),
        until_window_iso=until_dt.isoformat(),
    )


def _build_paths(run_name: str) -> RunPaths:
    base = Path(config.BATCH_DIR) / run_name
    base.parent.mkdir(parents=True, exist_ok=True)
    return RunPaths(
        base=base,
        state=base.with_suffix(".state.json"),
        jsonl=base.with_suffix(".jsonl"),
        results=base.with_suffix(".results.json"),
        backup=base.with_suffix(".backup.json"),
    )


def _load_state(state_path: Path) -> dict:
    if state_path.exists():
        return json.loads(state_path.read_text(encoding="utf-8"))
    return {}


def _write_state(state_path: Path, **updates) -> dict:
    state = _load_state(state_path)
    state.update(updates)
    state["updated_at"] = datetime.utcnow().isoformat() + "Z"
    state_path.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")
    return state


def _db_conn():
    return psycopg2.connect(**config.get_db_connection_params(), sslmode="require")


def _fast_fathom_ingest(team: str, window: WindowConfig, supabase) -> int:
    logger.info(
        "Fast Fathom ingest starting for team=%s from %s through %s (%s)",
        team,
        window.since_date,
        window.until_date,
        window.timezone,
    )
    all_meetings = []
    cursor = None

    while True:
        params = {
            "teams[]": team,
            "include_transcript": "true",
            "include_crm_matches": "true",
            "limit": "100",
            "created_after": window.fetch_since_iso,
            "created_before": window.until_window_iso,
        }
        if cursor:
            params["cursor"] = cursor

        data = _get("/meetings", params)
        meetings = data.get("items", [])
        if not meetings:
            break

        all_meetings.extend(meetings)
        logger.info("Fetched %s meetings (total: %s)", len(meetings), len(all_meetings))
        cursor = data.get("next_cursor")
        if not cursor:
            break
        time.sleep(0.2)

    rows = []
    for meeting in all_meetings:
        meeting["_fathom_summary"] = None
        parsed = parse_meeting(meeting)
        rows.append(
            {
                **parsed,
                "transcript_json": json.dumps(parsed["transcript_json"], ensure_ascii=False)
                if parsed["transcript_json"]
                else None,
                "participants": json.dumps(parsed["participants"], ensure_ascii=False)
                if parsed["participants"]
                else None,
                "fathom_crm_matches": json.dumps(parsed["fathom_crm_matches"], ensure_ascii=False)
                if parsed["fathom_crm_matches"]
                else None,
            }
        )

    _upsert_batch(supabase, "raw_transcripts", rows, "recording_id")
    logger.info("Stored %s raw transcripts", len(rows))
    return len(rows)


def _fetch_target_transcripts(team: str, window: WindowConfig) -> list[dict]:
    with _db_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT v.*
            FROM v_transcripts v
            JOIN raw_transcripts rt ON rt.recording_id = v.transcript_id
            WHERE rt.team = %s
              AND rt.call_date >= %s
              AND rt.call_date < %s
            ORDER BY rt.call_date ASC, v.transcript_id ASC
            """,
            (team, window.since_window_iso, window.until_window_iso),
        )
        return [dict(row) for row in cur.fetchall()]


def _fetch_existing_insights(transcript_ids: list[str]) -> list[dict]:
    with _db_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM transcript_insights WHERE transcript_id = ANY(%s)",
            (transcript_ids,),
        )
        return [dict(row) for row in cur.fetchall()]


def _delete_existing_insights(transcript_ids: list[str]) -> int:
    with _db_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM transcript_insights WHERE transcript_id = ANY(%s)",
            (transcript_ids,),
        )
        deleted = cur.rowcount
        conn.commit()
        return deleted


def _build_chunks(transcripts: list[dict]) -> list[dict]:
    chunks = []
    for transcript in transcripts:
        tid = transcript["transcript_id"]
        text = transcript.get("transcript_text") or ""
        if not text:
            continue

        metadata = {
            "transcript_id": tid,
            "deal_id": transcript.get("deal_id"),
            "deal_name": transcript.get("deal_name"),
            "company_name": transcript.get("company_name"),
            "region": transcript.get("deal_region") or transcript.get("region"),
            "country": transcript.get("deal_country") or transcript.get("country"),
            "industry": transcript.get("industry"),
            "company_size": transcript.get("company_size"),
            "segment": transcript.get("segment"),
            "amount": transcript.get("amount"),
            "deal_stage": transcript.get("deal_stage"),
            "deal_owner": transcript.get("deal_owner"),
            "cx_owner": transcript.get("cx_owner"),
            "call_date": str(transcript.get("call_date", "")) if transcript.get("call_date") else None,
        }

        for chunk in chunk_transcript(tid, text):
            chunks.append(
                {
                    "custom_id": f"{tid}__{chunk['chunk_index']}",
                    "transcript_id": tid,
                    "chunk_index": chunk["chunk_index"],
                    "transcript_text": chunk["text"],
                    "token_count": chunk["token_count"],
                    "metadata": metadata,
                }
            )

    return chunks


def _dedupe_rows(rows: list[dict]) -> list[dict]:
    deduped = {}
    for row in rows:
        key = row.get("content_hash") or "|".join(
            [
                str(row.get("transcript_id", "")),
                str(row.get("transcript_chunk", "")),
                str(row.get("insight_type", "")),
                str(row.get("insight_subtype", "")),
                str(row.get("summary", "")),
            ]
        )
        deduped.setdefault(key, row)
    return list(deduped.values())


def _parse_custom_id(custom_id: str) -> tuple[str, int]:
    transcript_id, _, chunk_index = custom_id.partition("__")
    return transcript_id, int(chunk_index or "0")


def _default_run_name(team: str, window: WindowConfig) -> str:
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return (
        f"exact_rerun_{_slugify(team)}_"
        f"{window.since_date.replace('-', '')}_{window.until_date.replace('-', '')}_{timestamp}"
    )


def _submit(args: argparse.Namespace) -> None:
    window = _build_window(args.since_date, args.until_date, args.timezone)
    run_name = args.run_name or _default_run_name(args.team, window)
    paths = _build_paths(run_name)

    _write_state(
        paths.state,
        status="starting",
        run_name=run_name,
        team=args.team,
        since_date=window.since_date,
        until_date=window.until_date,
        timezone=window.timezone,
        since_window=window.since_window_iso,
        until_window=window.until_window_iso,
        model=args.model,
    )

    supabase = get_client()
    openai_client = get_openai_client()

    fathom_meetings = _fast_fathom_ingest(args.team, window, supabase)
    _write_state(paths.state, status="hubspot_refresh", fathom_meetings=fathom_meetings)

    hubspot_stats = run_ingestion(supabase=supabase, source="hubspot")
    _write_state(paths.state, status="chunking", hubspot_stats=hubspot_stats)

    transcripts = _fetch_target_transcripts(args.team, window)
    chunks = _build_chunks(transcripts)
    transcript_ids = sorted({chunk["transcript_id"] for chunk in chunks})

    logger.info("Target transcripts with content in window: %s", len(transcript_ids))
    logger.info("Target chunks in window: %s", len(chunks))

    if not chunks:
        raise RuntimeError("No transcript chunks found in the requested window")

    jsonl_path = create_batch_jsonl(chunks, output_path=str(paths.jsonl), model=args.model)
    batch_id = submit_batch(openai_client, jsonl_path)
    logger.info("Submitted exact rerun batch: %s", batch_id)

    _write_state(
        paths.state,
        status="batch_submitted",
        transcripts=len(transcript_ids),
        transcript_ids=transcript_ids,
        chunks=len(chunks),
        batch_id=batch_id,
        jsonl_path=jsonl_path,
    )

    print(f"BATCH_ID={batch_id}")
    print(f"STATE_PATH={paths.state}")
    print(f"RUN_NAME={run_name}")


def _finalize(args: argparse.Namespace) -> None:
    window = _build_window(args.since_date, args.until_date, args.timezone)
    run_name = args.run_name or (
        f"finalize_{_slugify(args.team)}_{window.since_date.replace('-', '')}_"
        f"{window.until_date.replace('-', '')}_{args.batch_id[-12:]}"
    )
    paths = _build_paths(run_name)

    _write_state(
        paths.state,
        status="waiting_for_batch" if args.wait else "checking_batch",
        run_name=run_name,
        team=args.team,
        since_date=window.since_date,
        until_date=window.until_date,
        timezone=window.timezone,
        since_window=window.since_window_iso,
        until_window=window.until_window_iso,
        model=args.model,
        batch_id=args.batch_id,
    )

    openai_client = get_openai_client()
    supabase = get_client()

    if args.wait:
        batch_result = poll_batch(openai_client, args.batch_id)
    else:
        batch = openai_client.batches.retrieve(args.batch_id)
        batch_result = {
            "id": batch.id,
            "status": batch.status,
            "output_file_id": batch.output_file_id,
            "error_file_id": batch.error_file_id,
            "total": batch.request_counts.total if batch.request_counts else 0,
            "completed": batch.request_counts.completed if batch.request_counts else 0,
            "failed": batch.request_counts.failed if batch.request_counts else 0,
        }

    _write_state(paths.state, status="batch_finished", batch_result=batch_result)

    if batch_result["status"] != "completed":
        errors = []
        if batch_result.get("error_file_id"):
            errors = download_batch_errors(openai_client, batch_result["error_file_id"])
        paths.results.write_text(
            json.dumps({"batch_result": batch_result, "errors": errors[:100]}, indent=2, default=str),
            encoding="utf-8",
        )
        raise RuntimeError(f"Batch ended with status={batch_result['status']}")

    transcripts = _fetch_target_transcripts(args.team, window)
    chunks = _build_chunks(transcripts)
    transcript_ids = sorted({chunk["transcript_id"] for chunk in chunks})
    metadata_by_tid = {chunk["transcript_id"]: chunk["metadata"] for chunk in chunks}

    logger.info("Finalizing %s transcripts from %s chunks", len(transcript_ids), len(chunks))

    results = download_batch_results(openai_client, batch_result["output_file_id"])
    all_rows = []
    parse_errors = 0

    for item in results:
        response = item.get("response")
        if not response:
            parse_errors += 1
            continue

        transcript_id, chunk_index = _parse_custom_id(item["custom_id"])
        metadata = metadata_by_tid.get(transcript_id, {})
        rows = parse_response(
            response,
            transcript_id,
            chunk_index,
            metadata,
            model_used=args.model,
            batch_id=batch_result["id"],
            supabase_client=supabase,
        )
        all_rows.extend(rows)

    deduped_rows = _dedupe_rows(all_rows)
    paths.results.write_text(
        json.dumps(
            {
                "batch_result": batch_result,
                "transcripts": len(transcript_ids),
                "chunks": len(chunks),
                "parsed_rows": len(all_rows),
                "deduped_rows": len(deduped_rows),
                "parse_errors": parse_errors,
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )
    _write_state(
        paths.state,
        status="parsed",
        transcripts=len(transcript_ids),
        chunks=len(chunks),
        parsed_rows=len(all_rows),
        deduped_rows=len(deduped_rows),
        parse_errors=parse_errors,
    )

    existing_rows = _fetch_existing_insights(transcript_ids)
    paths.backup.write_text(json.dumps(existing_rows, indent=2, default=str), encoding="utf-8")
    _write_state(
        paths.state,
        status="backup_written",
        backup_path=str(paths.backup),
        existing_rows=len(existing_rows),
    )

    deleted = _delete_existing_insights(transcript_ids)
    _write_state(paths.state, status="deleted_old", deleted_rows=deleted)

    inserted = insert_insights(supabase, deduped_rows)
    _write_state(
        paths.state,
        status="completed",
        inserted_rows=inserted,
        new_features=get_new_features(),
    )

    logger.info("Finalize complete: deleted=%s inserted=%s", deleted, inserted)
    print(f"FINALIZED_BATCH={args.batch_id}")
    print(f"STATE_PATH={paths.state}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Submit or finalize exact date-window reruns.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_shared_arguments(subparser: argparse.ArgumentParser, include_batch_id: bool = False) -> None:
        subparser.add_argument("--since-date", required=True, help="Inclusive start date, YYYY-MM-DD")
        subparser.add_argument("--until-date", required=True, help="Inclusive end date, YYYY-MM-DD")
        subparser.add_argument("--team", default=config.FATHOM_TEAM_FILTER, help="Fathom team filter")
        subparser.add_argument("--model", default=config.OPENAI_MODEL, help="OpenAI model to record/use")
        subparser.add_argument(
            "--timezone",
            default="America/Argentina/Cordoba",
            help="IANA timezone used to build exact day boundaries",
        )
        subparser.add_argument("--run-name", default=None, help="Optional run name prefix for state files")
        if include_batch_id:
            subparser.add_argument("--batch-id", required=True, help="OpenAI batch ID to finalize")

    submit_parser = subparsers.add_parser("submit", help="Refresh data, chunk transcripts, and submit batch")
    add_shared_arguments(submit_parser)

    finalize_parser = subparsers.add_parser("finalize", help="Poll an existing batch and load rerun results")
    add_shared_arguments(finalize_parser, include_batch_id=True)
    finalize_parser.add_argument("--wait", action="store_true", help="Poll until the batch finishes")

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "submit":
        _submit(args)
    elif args.command == "finalize":
        _finalize(args)
    else:
        parser.error(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
