"""
Entry point CLI for Humand Sales Insights pipeline.

Usage:
    python main.py setup                              # Create tables + seed taxonomy
    python main.py ingest                             # Fetch Fathom + HubSpot + match deals
    python main.py ingest --source fathom             # Only Fathom
    python main.py ingest --source hubspot            # Only HubSpot
    python main.py ingest --match-only                # Re-run matching only
    python main.py ingest --since 2024-01-01          # Incremental from date
    python main.py run                                # Full batch (all transcripts)
    python main.py run --sample 5 --model gpt-4o      # Direct API, 5 transcripts
    python main.py run --dry-run                      # Generate JSONL only
    python main.py run --resume                       # Resume interrupted batch
    python main.py status                             # Check batch status
    python main.py qa --sample 30                     # QA evaluate 30 transcripts
    python main.py qa --report                        # View last QA report
    python main.py qa --apply                         # Apply QA refinements
    python main.py embed                                # Embed transcripts for RAG search
    python main.py embed --since 2024-06-01             # Incremental embedding
    python main.py embed --force                        # Re-embed everything
    python main.py backfill-summaries                   # Backfill Fathom summaries
"""

from __future__ import annotations

import argparse
import logging
import sys

import config
from db import get_client, execute_schema_direct
from seed_taxonomy import run_seed
from pipeline import run_pipeline, get_batch_status
from ingest import run_ingestion
from fathom_client import fetch_summary
from qa_evaluator import run_qa, print_report, apply_refinements
from embed_transcripts import run_embedding_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def cmd_setup(args: argparse.Namespace) -> None:
    """Create schema and seed taxonomy."""
    logger.info("Starting setup...")

    # Step 1: Execute schema via direct PostgreSQL connection
    logger.info("=" * 50)
    logger.info("STEP 1: Creating database schema...")
    logger.info("=" * 50)
    execute_schema_direct()

    # Step 2: Seed taxonomy via Supabase REST API
    logger.info("=" * 50)
    logger.info("STEP 2: Seeding taxonomy...")
    logger.info("=" * 50)
    client = get_client()
    run_seed(client)

    logger.info("=" * 50)
    logger.info("Setup complete!")
    logger.info("Next: python main.py ingest  (fetch Fathom + HubSpot)")
    logger.info("=" * 50)


def cmd_ingest(args: argparse.Namespace) -> None:
    """Ingest data from Fathom and HubSpot."""
    logger.info("Starting ingestion...")
    supabase = get_client()

    stats = run_ingestion(
        supabase=supabase,
        source=args.source,
        match_only=args.match_only,
        since=args.since,
    )

    logger.info("Ingestion complete.")
    logger.info(f"Next: python main.py run --sample 5 --model gpt-4o  (validate)")


def cmd_run(args: argparse.Namespace) -> None:
    """Run the insight extraction pipeline."""
    logger.info("Starting pipeline...")
    supabase = get_client()

    stats = run_pipeline(
        supabase=supabase,
        sample=args.sample,
        model=args.model,
        dry_run=args.dry_run,
        resume=args.resume,
    )

    if args.dry_run:
        logger.info(f"Dry run complete. JSONL at: {stats.get('jsonl_path', '?')}")
    else:
        logger.info("Pipeline complete.")
        logger.info(f"  Insights inserted: {stats.get('insights_inserted', 0)}")
        if stats.get("errors"):
            logger.warning(f"  Errors: {stats['errors']}")


def cmd_qa(args: argparse.Namespace) -> None:
    """Run QA evaluation, view report, or apply refinements."""
    if args.report:
        print_report()
        return

    supabase = get_client()

    if args.apply:
        logger.info("Applying QA refinements...")
        stats = apply_refinements(supabase)
        if stats.get("applied"):
            logger.info("Refinements applied successfully")
            logger.info(f"  Prompt rules added: {stats.get('prompt_rules_added', 0)}")
            for cat, codes in stats.get("taxonomy_added", {}).items():
                logger.info(f"  {cat}: {', '.join(codes)}")
            logger.info("Next: python main.py run --sample 5 --model gpt-4o  (re-extract with refinements)")
        else:
            logger.error("No refinements to apply")
        return

    # Default: run QA evaluation
    sample = args.sample or 30
    model = args.model or "gpt-4o"
    logger.info(f"Running QA evaluation (sample={sample}, model={model})...")

    stats = run_qa(supabase, sample=sample, model=model)
    logger.info(f"QA complete: {stats.get('evaluated', 0)} transcripts evaluated")
    logger.info("Next: python main.py qa --report  (view results)")


def cmd_status(args: argparse.Namespace) -> None:
    """Check current batch status."""
    status = get_batch_status()
    if not status:
        print("No batch in progress and no history found.")
        return

    if status.get("status") == "no_pending":
        print(f"No batch in progress. Last completed: {status.get('last_completed', '?')}")
        return

    print(f"Batch ID:  {status['batch_id']}")
    print(f"Status:    {status['status']}")
    print(f"Progress:  {status['completed']}/{status['total']} completed")
    if status.get("failed"):
        print(f"Failed:    {status['failed']}")


def cmd_embed(args: argparse.Namespace) -> None:
    """Embed transcripts and Fathom summaries for RAG semantic search."""
    logger.info("Starting embedding pipeline...")
    stats = run_embedding_pipeline(since=args.since, force=args.force)
    logger.info(f"Embedding complete: {stats.get('chunks_embedded', 0)} chunks embedded")
    if stats.get("skipped"):
        logger.info(f"  Skipped (already embedded): {stats['skipped']} transcripts")


def cmd_backfill_summaries(args: argparse.Namespace) -> None:
    """Backfill fathom_summary for existing transcripts that don't have one."""
    import time

    logger.info("Starting summary backfill...")
    supabase = get_client()

    # Fetch recording_ids where fathom_summary is NULL
    all_ids = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            supabase.table("raw_transcripts")
            .select("recording_id")
            .is_("fathom_summary", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_ids.extend(row["recording_id"] for row in response.data)
        if len(response.data) < page_size:
            break
        offset += page_size

    logger.info(f"Found {len(all_ids)} transcripts without summary")

    updated = 0
    skipped = 0
    for i, recording_id in enumerate(all_ids):
        summary = fetch_summary(recording_id)
        if summary:
            supabase.table("raw_transcripts").update(
                {"fathom_summary": summary}
            ).eq("recording_id", recording_id).execute()
            updated += 1
        else:
            skipped += 1

        if (i + 1) % 10 == 0:
            logger.info(f"  Progress: {i + 1}/{len(all_ids)} (updated={updated}, skipped={skipped})")

        time.sleep(1)  # Respect rate limit

    logger.info(f"Backfill complete: {updated} updated, {skipped} skipped (no summary available)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Humand Sales Insights - Transcript Analysis Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py setup                              Setup DB and taxonomy
  python main.py ingest                             Fetch Fathom + HubSpot + match
  python main.py ingest --source fathom --since 2024-06-01
  python main.py ingest --match-only                Re-run deal matching
  python main.py run --sample 5 --model gpt-4o      Validate with 5 transcripts
  python main.py run                                 Full batch (all transcripts)
  python main.py run --resume                        Resume interrupted batch
  python main.py qa --sample 30                      QA evaluate 30 transcripts
  python main.py qa --report                         View last QA report
  python main.py qa --apply                          Apply QA refinements
  python main.py status                              Check batch progress
  python main.py backfill-summaries                  Backfill Fathom summaries
        """,
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # setup
    subparsers.add_parser("setup", help="Create schema and seed taxonomy")

    # ingest
    p_ingest = subparsers.add_parser("ingest", help="Ingest from Fathom + HubSpot")
    p_ingest.add_argument(
        "--source", choices=["fathom", "hubspot"], default=None,
        help="Ingest only from this source (default: both)",
    )
    p_ingest.add_argument(
        "--match-only", action="store_true",
        help="Skip fetching, only re-run deal matching on existing data",
    )
    p_ingest.add_argument(
        "--since", type=str, default=None,
        help="Fetch Fathom meetings created after this date (ISO 8601, e.g. 2024-01-01)",
    )

    # run
    p_run = subparsers.add_parser("run", help="Run insight extraction pipeline")
    p_run.add_argument("--sample", type=int, default=None, help="Process only N transcripts (direct API)")
    p_run.add_argument("--model", type=str, default=None, help=f"Model to use (default: {config.OPENAI_MODEL})")
    p_run.add_argument("--dry-run", action="store_true", help="Generate JSONL without submitting")
    p_run.add_argument("--resume", action="store_true", help="Resume from state.json")

    # qa
    p_qa = subparsers.add_parser("qa", help="QA evaluation of extracted insights")
    p_qa.add_argument("--sample", type=int, default=None, help="Evaluate N transcripts (default: 30)")
    p_qa.add_argument("--model", type=str, default=None, help="Model for QA agent (default: gpt-4o)")
    p_qa.add_argument("--report", action="store_true", help="View last QA report")
    p_qa.add_argument("--apply", action="store_true", help="Apply refinements from last QA report")

    # status
    subparsers.add_parser("status", help="Check batch status")

    # embed
    p_embed = subparsers.add_parser("embed", help="Embed transcripts for RAG semantic search")
    p_embed.add_argument("--since", type=str, default=None, help="Only embed transcripts after this date (YYYY-MM-DD)")
    p_embed.add_argument("--force", action="store_true", help="Re-embed everything (ignore already embedded)")

    # backfill-summaries
    subparsers.add_parser("backfill-summaries", help="Backfill Fathom summaries for existing transcripts")

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    commands = {
        "setup": cmd_setup,
        "ingest": cmd_ingest,
        "run": cmd_run,
        "qa": cmd_qa,
        "status": cmd_status,
        "embed": cmd_embed,
        "backfill-summaries": cmd_backfill_summaries,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
