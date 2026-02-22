#!/usr/bin/env python3
"""
Test v3.1 taxonomy extraction on 100 valid transcripts.

- Step 1: DB migration + schema + seed v3.1 taxonomy
- Step 2: Select 100 valid transcripts (has deal, company, >1000 chars)
- Step 3: Extract insights with gpt-4.1-mini (prompt v3.0)
- Step 4: QA evaluation with gpt-4o
- Step 5: Generate report

Results:
  test_v3_report.json    — Full JSON report
  test_v3_extraction.log — Detailed log
"""

from __future__ import annotations

import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone

# ── Project setup ──
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from src import config
from src.connectors.supabase import (
    get_client, fetch_transcripts, insert_insights,
)
from src.connectors.seed_taxonomy import run_seed
from src.skills.chunking import chunk_transcript
from src.skills.batch_processing import get_openai_client, process_single
from src.skills.response_parsing import parse_response, get_new_features
from src.agents.qa_agent import _evaluate_single
from src.skills.qa_prompt_building import build_qa_system_prompt, build_taxonomy_summary
from openai import OpenAI

# ── Constants ──
EXTRACTION_MODEL = "gpt-4.1-mini"
QA_MODEL = "gpt-4o"
SAMPLE_SIZE = 100
REPORT_PATH = os.path.join(PROJECT_ROOT, "test_v3_report.json")
LOG_PATH = os.path.join(PROJECT_ROOT, "test_v3_extraction.log")

# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_PATH, mode="w"),
    ],
)
logger = logging.getLogger("test_v3")

# ── Migration SQL (for existing DB) ──
# Split into individual statements for better error handling
MIGRATION_STATEMENTS = [
    # Create new taxonomy tables (needed before FK references)
    """CREATE TABLE IF NOT EXISTS tax_product_gap_subtypes (
        code TEXT PRIMARY KEY, display_name TEXT NOT NULL, description TEXT
    );""",
    """CREATE TABLE IF NOT EXISTS tax_competitor_categories (
        code TEXT PRIMARY KEY, display_name TEXT NOT NULL, description TEXT
    );""",
    # Allow 'roadmap' in tax_modules.status
    "ALTER TABLE tax_modules DROP CONSTRAINT IF EXISTS tax_modules_status_check;",
    """ALTER TABLE tax_modules ADD CONSTRAINT tax_modules_status_check
        CHECK (status IN ('existing', 'missing', 'roadmap'));""",
    # Add category column to tax_competitors
    """DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tax_competitors' AND column_name = 'category'
        ) THEN
            ALTER TABLE tax_competitors ADD COLUMN category TEXT REFERENCES tax_competitor_categories(code);
        END IF;
    END $$;""",
    # Update the dashboard view to include product_gap subtypes
    """CREATE OR REPLACE VIEW v_insights_dashboard AS
    SELECT
        i.*,
        d.pipeline AS deal_pipeline, d.create_date AS deal_create_date,
        d.close_date AS deal_close_date, d.owner_name AS cx_owner, d.ae_owner_name,
        CASE i.insight_type
            WHEN 'pain' THEN 'Dolor / Problema'
            WHEN 'product_gap' THEN 'Feature Faltante'
            WHEN 'competitive_signal' THEN 'Senal Competitiva'
            WHEN 'deal_friction' THEN 'Friccion del Deal'
            WHEN 'faq' THEN 'Pregunta Frecuente'
        END AS insight_type_display,
        COALESCE(ps.display_name, pgst.display_name, df.display_name, fq.display_name, cr.display_name, i.insight_subtype)
            AS insight_subtype_display,
        m.display_name AS module_display, m.status AS module_status,
        m.hr_category AS hr_category, hc.display_name AS hr_category_display,
        ps.theme AS pain_theme,
        CASE WHEN ps.module IS NOT NULL THEN 'module_linked' ELSE 'general' END AS pain_scope,
        fn.display_name AS feature_display, fn.is_seed AS feature_is_seed,
        crel.display_name AS competitor_relationship_display
    FROM transcript_insights i
    LEFT JOIN raw_deals d ON i.deal_id = d.deal_id
    LEFT JOIN tax_modules m ON i.module = m.code
    LEFT JOIN tax_hr_categories hc ON m.hr_category = hc.code
    LEFT JOIN tax_pain_subtypes ps ON i.insight_subtype = ps.code AND i.insight_type = 'pain'
    LEFT JOIN tax_product_gap_subtypes pgst ON i.insight_subtype = pgst.code AND i.insight_type = 'product_gap'
    LEFT JOIN tax_deal_friction_subtypes df ON i.insight_subtype = df.code AND i.insight_type = 'deal_friction'
    LEFT JOIN tax_faq_subtypes fq ON i.insight_subtype = fq.code AND i.insight_type = 'faq'
    LEFT JOIN tax_competitive_relationships cr ON i.insight_subtype = cr.code AND i.insight_type = 'competitive_signal'
    LEFT JOIN tax_competitive_relationships crel ON i.competitor_relationship = crel.code
    LEFT JOIN tax_feature_names fn ON i.feature_name = fn.code;""",
]


def run_migration():
    """Run migration SQL against live Supabase PostgreSQL (with timeout)."""
    import psycopg2

    db_params = config.get_db_connection_params()
    if not db_params["password"]:
        logger.warning("SUPABASE_DB_PASSWORD not set — skipping migration")
        return False

    logger.info("Connecting to PostgreSQL for migration...")
    db_params["connect_timeout"] = 15  # 15 second timeout
    conn = psycopg2.connect(**db_params)
    conn.autocommit = True

    try:
        with conn.cursor() as cur:
            for i, stmt in enumerate(MIGRATION_STATEMENTS, 1):
                try:
                    cur.execute(stmt)
                    logger.info(f"  Migration statement {i}/{len(MIGRATION_STATEMENTS)}: OK")
                except Exception as e:
                    logger.warning(f"  Migration statement {i}: {e}")
        logger.info("Migration complete")
        return True
    except Exception as e:
        logger.error(f"Migration connection error: {e}")
        return False
    finally:
        conn.close()


def select_valid_transcripts(supabase, n=100):
    """Fetch transcripts and filter for valid ones (has deal, company, >1000 chars text)."""
    logger.info("Fetching all transcripts from v_transcripts...")
    all_transcripts = fetch_transcripts(supabase)
    logger.info(f"Total transcripts in view: {len(all_transcripts)}")

    valid = []
    for t in all_transcripts:
        if not t.get("deal_id") or not t.get("company_name"):
            continue
        text = t.get("transcript_text") or ""
        if len(text) < 1000:
            continue
        valid.append(t)

    logger.info(f"Valid transcripts (deal + company + >1000 chars): {len(valid)}")

    if len(valid) <= n:
        logger.info(f"Using all {len(valid)} valid transcripts")
        return valid

    random.seed(42)
    sample = random.sample(valid, n)

    # Log segment distribution
    segments: dict[str, int] = {}
    for t in sample:
        seg = t.get("segment") or "unknown"
        segments[seg] = segments.get(seg, 0) + 1
    logger.info(f"Sample segment distribution: {dict(sorted(segments.items()))}")

    return sample


def run_extraction(supabase, openai_client, transcripts, model):
    """Extract insights using direct API (one chunk at a time)."""
    all_chunks = []
    for t in transcripts:
        tid = t.get("transcript_id") or t.get("id", "unknown")
        text = t.get("transcript_text") or ""

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
            all_chunks.append({
                "transcript_id": tid,
                "chunk_index": c["chunk_index"],
                "text": c["text"],
                "token_count": c["token_count"],
                "metadata": metadata,
            })

    logger.info(f"Total chunks to process: {len(all_chunks)} (from {len(transcripts)} transcripts)")

    stats = {
        "transcripts": len(transcripts),
        "chunks": len(all_chunks),
        "insights_parsed": 0,
        "insights_inserted": 0,
        "errors": 0,
    }

    for i, chunk in enumerate(all_chunks, 1):
        tid = chunk["transcript_id"]
        cidx = chunk["chunk_index"]
        logger.info(f"[{i}/{len(all_chunks)}] Extracting {tid} chunk {cidx} ({chunk['token_count']} tokens)...")

        try:
            result = process_single(
                openai_client,
                chunk["text"],
                chunk["metadata"],
                model=model,
            )

            rows = parse_response(
                result, tid, cidx, chunk["metadata"],
                model_used=model,
                supabase_client=supabase,
            )

            stats["insights_parsed"] += len(rows)

            if rows:
                inserted = insert_insights(supabase, rows)
                stats["insights_inserted"] += inserted
                logger.info(f"  -> {len(rows)} parsed, {inserted} inserted")
            else:
                logger.info("  -> 0 insights")

        except Exception as e:
            logger.error(f"  Error: {tid}[{cidx}]: {e}")
            stats["errors"] += 1

    return stats


def run_qa_evaluation(supabase, transcript_ids, qa_model):
    """Run QA evaluation on specific transcript IDs — only v3.0 insights."""
    openai_client = OpenAI(api_key=config.OPENAI_API_KEY)
    taxonomy_summary = build_taxonomy_summary()
    qa_system_prompt = build_qa_system_prompt()

    prompt_version = config.PROMPT_VERSION
    logger.info(f"QA will filter insights by prompt_version={prompt_version}")

    all_results = []
    for i, tid in enumerate(transcript_ids, 1):
        logger.info(f"[QA {i}/{len(transcript_ids)}] Evaluating {tid}...")

        # Fetch transcript text
        t_resp = (
            supabase.table("raw_transcripts")
            .select("recording_id, transcript_text")
            .eq("recording_id", tid)
            .limit(1)
            .execute()
        )
        if not t_resp.data:
            logger.warning(f"  Transcript not found in raw_transcripts: {tid}")
            continue

        transcript_text = t_resp.data[0]["transcript_text"]

        # Fetch only v3.0 insights for this transcript
        i_resp = (
            supabase.table("transcript_insights")
            .select("*")
            .eq("transcript_id", tid)
            .eq("prompt_version", prompt_version)
            .execute()
        )

        if not i_resp.data:
            logger.warning(f"  No {prompt_version} insights found for {tid}")
            continue

        logger.info(f"  Found {len(i_resp.data)} insights to evaluate")

        try:
            result = _evaluate_single(
                openai_client,
                qa_system_prompt,
                transcript_text,
                i_resp.data,
                taxonomy_summary,
                model=qa_model,
            )

            scores = [
                result.get("completeness", 0),
                result.get("precision", 0),
                result.get("classification", 0),
                result.get("quotes_accuracy", 0),
            ]
            overall = sum(scores) / len(scores) if scores else 0

            qa_entry = {
                "transcript_id": tid,
                "insights_count": len(i_resp.data),
                "completeness": result.get("completeness"),
                "precision": result.get("precision"),
                "classification": result.get("classification"),
                "quotes_accuracy": result.get("quotes_accuracy"),
                "overall": round(overall, 3),
                "missing_count": len(result.get("missing_insights", [])),
                "wrong_count": len(result.get("wrong_classifications", [])),
                "hallucination_count": len(result.get("hallucinations", [])),
                "taxonomy_suggestion_count": len(result.get("taxonomy_suggestions", [])),
                "notes": result.get("notes"),
                "missing_insights": result.get("missing_insights", []),
                "wrong_classifications": result.get("wrong_classifications", []),
                "hallucinations": result.get("hallucinations", []),
            }
            all_results.append(qa_entry)

            logger.info(
                f"  -> completeness={result.get('completeness')}, "
                f"precision={result.get('precision')}, "
                f"classification={result.get('classification')}, "
                f"quotes={result.get('quotes_accuracy')}, "
                f"overall={overall:.3f}"
            )

        except Exception as e:
            logger.error(f"  QA error for {tid}: {e}")

    return all_results


def generate_report(extraction_stats, qa_results, elapsed):
    """Generate final JSON report with summary and details."""
    n = len(qa_results)

    # Average scores
    avg = {}
    for key in ("completeness", "precision", "classification", "quotes_accuracy", "overall"):
        vals = [r[key] for r in qa_results if r.get(key) is not None]
        avg[key] = round(sum(vals) / len(vals), 3) if vals else 0

    # Overall score distribution
    overall_vals = [r["overall"] for r in qa_results if r.get("overall") is not None]
    dist = {}
    if overall_vals:
        sorted_vals = sorted(overall_vals)
        dist = {
            "min": round(min(sorted_vals), 3),
            "max": round(max(sorted_vals), 3),
            "median": round(sorted_vals[len(sorted_vals) // 2], 3),
            "p25": round(sorted_vals[len(sorted_vals) // 4], 3),
            "p75": round(sorted_vals[3 * len(sorted_vals) // 4], 3),
            "below_0.7": sum(1 for v in sorted_vals if v < 0.7),
            "above_0.9": sum(1 for v in sorted_vals if v >= 0.9),
        }

    # Aggregate issues
    all_missing = []
    all_wrong = []
    all_hallucinations = []
    for r in qa_results:
        all_missing.extend(r.get("missing_insights", []))
        all_wrong.extend(r.get("wrong_classifications", []))
        all_hallucinations.extend(r.get("hallucinations", []))

    # Missing by insight type
    missing_by_type: dict[str, int] = {}
    for m in all_missing:
        t = m.get("insight_type", "unknown")
        missing_by_type[t] = missing_by_type.get(t, 0) + 1

    # Wrong classification patterns
    wrong_patterns: dict[str, int] = {}
    for w in all_wrong:
        pattern = f"{w.get('current_type', '?')}/{w.get('current_subtype', '?')} -> {w.get('suggested_type', '?')}/{w.get('suggested_subtype', '?')}"
        wrong_patterns[pattern] = wrong_patterns.get(pattern, 0) + 1

    # Insights per transcript stats
    insights_counts = [r["insights_count"] for r in qa_results]
    avg_insights = round(sum(insights_counts) / len(insights_counts), 1) if insights_counts else 0

    report = {
        "test_config": {
            "extraction_model": EXTRACTION_MODEL,
            "qa_model": QA_MODEL,
            "sample_size": SAMPLE_SIZE,
            "prompt_version": config.PROMPT_VERSION,
            "run_at": datetime.now(timezone.utc).isoformat(),
            "elapsed_minutes": round(elapsed / 60, 1),
        },
        "extraction_stats": extraction_stats,
        "qa_summary": {
            "evaluated": n,
            "avg_scores": avg,
            "score_distribution": dist,
            "avg_insights_per_transcript": avg_insights,
            "total_missing_insights": len(all_missing),
            "total_wrong_classifications": len(all_wrong),
            "total_hallucinations": len(all_hallucinations),
            "missing_by_type": dict(sorted(missing_by_type.items(), key=lambda x: -x[1])),
            "wrong_patterns": dict(sorted(wrong_patterns.items(), key=lambda x: -x[1])[:10]),
        },
        "qa_per_transcript": [
            {k: v for k, v in r.items()
             if k not in ("missing_insights", "wrong_classifications", "hallucinations")}
            for r in qa_results
        ],
        "sample_issues": {
            "missing_insights": all_missing[:20],
            "wrong_classifications": all_wrong[:20],
            "hallucinations": all_hallucinations[:10],
        },
    }

    return report


def main():
    start = time.time()

    logger.info("=" * 60)
    logger.info("  TEST v3.1 TAXONOMY EXTRACTION")
    logger.info(f"  Extraction: {EXTRACTION_MODEL}")
    logger.info(f"  QA: {QA_MODEL}")
    logger.info(f"  Sample: {SAMPLE_SIZE} valid transcripts")
    logger.info(f"  Prompt version: {config.PROMPT_VERSION}")
    logger.info("=" * 60)

    supabase = get_client()
    openai_client = get_openai_client()

    # ── Step 1: DB migration + seed ──
    logger.info("\n" + "=" * 50)
    logger.info("STEP 1: Database migration + seed taxonomy")
    logger.info("=" * 50)

    try:
        # Run migration SQL (CREATE new tables, ALTER constraints, update views)
        run_migration()
    except Exception as e:
        logger.warning(f"Migration issue: {e}")
        logger.info("Continuing — some statements may have already been applied")

    try:
        # Seed taxonomy data via REST API
        run_seed(supabase)
        logger.info("Taxonomy seeded successfully")
    except Exception as e:
        logger.error(f"Taxonomy seed error: {e}")
        logger.info("Continuing — seeding may partially succeed")

    # ── Step 2: Select valid transcripts ──
    logger.info("\n" + "=" * 50)
    logger.info("STEP 2: Select valid transcripts")
    logger.info("=" * 50)

    transcripts = select_valid_transcripts(supabase, n=SAMPLE_SIZE)
    if not transcripts:
        logger.error("No valid transcripts found! Aborting.")
        return

    transcript_ids = [
        t.get("transcript_id") or t.get("id", "unknown")
        for t in transcripts
    ]
    logger.info(f"Selected {len(transcript_ids)} transcript IDs for processing")

    # ── Step 3: Extract insights ──
    logger.info("\n" + "=" * 50)
    logger.info(f"STEP 3: Extract insights ({EXTRACTION_MODEL})")
    logger.info("=" * 50)

    extraction_stats = run_extraction(supabase, openai_client, transcripts, EXTRACTION_MODEL)

    logger.info("Extraction complete:")
    for k, v in extraction_stats.items():
        logger.info(f"  {k}: {v}")

    # Log new features discovered
    new_features = get_new_features()
    if new_features:
        logger.info(f"New features discovered: {len(new_features)}")
        for code, info in new_features.items():
            logger.info(f"  - {code}: {info['display_name']}")

    # ── Step 4: QA evaluation ──
    logger.info("\n" + "=" * 50)
    logger.info(f"STEP 4: QA evaluation ({QA_MODEL})")
    logger.info("=" * 50)

    qa_results = run_qa_evaluation(supabase, transcript_ids, QA_MODEL)

    # ── Step 5: Report ──
    elapsed = time.time() - start

    logger.info("\n" + "=" * 50)
    logger.info("STEP 5: Generate report")
    logger.info("=" * 50)

    report = generate_report(extraction_stats, qa_results, elapsed)

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # ── Final Summary ──
    avg = report["qa_summary"]["avg_scores"]
    dist = report["qa_summary"]["score_distribution"]

    logger.info("\n" + "=" * 60)
    logger.info("  RESULTS SUMMARY")
    logger.info("=" * 60)
    logger.info(f"  Model:           {EXTRACTION_MODEL}")
    logger.info(f"  Prompt version:  {config.PROMPT_VERSION}")
    logger.info(f"  Transcripts:     {extraction_stats['transcripts']}")
    logger.info(f"  Chunks:          {extraction_stats['chunks']}")
    logger.info(f"  Insights parsed: {extraction_stats['insights_parsed']}")
    logger.info(f"  Inserted:        {extraction_stats['insights_inserted']}")
    logger.info(f"  Errors:          {extraction_stats['errors']}")
    logger.info("")
    logger.info(f"  QA evaluated:    {report['qa_summary']['evaluated']}")
    logger.info(f"  Avg insights/transcript: {report['qa_summary']['avg_insights_per_transcript']}")
    logger.info("")
    logger.info("  QA SCORES (avg):")
    logger.info(f"    Completeness:    {avg.get('completeness', 0):.3f}")
    logger.info(f"    Precision:       {avg.get('precision', 0):.3f}")
    logger.info(f"    Classification:  {avg.get('classification', 0):.3f}")
    logger.info(f"    Quotes:          {avg.get('quotes_accuracy', 0):.3f}")
    logger.info(f"    OVERALL:         {avg.get('overall', 0):.3f}")
    if dist:
        logger.info(f"    Median:          {dist.get('median', '?')}")
        logger.info(f"    Range:           {dist.get('min', '?')} - {dist.get('max', '?')}")
        logger.info(f"    Below 0.7:       {dist.get('below_0.7', '?')}")
        logger.info(f"    Above 0.9:       {dist.get('above_0.9', '?')}")
    logger.info("")
    logger.info(f"  Missing insights:      {report['qa_summary']['total_missing_insights']}")
    logger.info(f"  Wrong classifications: {report['qa_summary']['total_wrong_classifications']}")
    logger.info(f"  Hallucinations:        {report['qa_summary']['total_hallucinations']}")
    logger.info("")
    logger.info(f"  Total time: {elapsed/60:.1f} minutes")
    logger.info(f"  Report: {REPORT_PATH}")
    logger.info(f"  Log:    {LOG_PATH}")
    logger.info("=" * 60)
    logger.info("")
    logger.info("DONE. Review test_v3_report.json for detailed results.")
    logger.info("Waiting for user confirmation before full re-extraction.")


if __name__ == "__main__":
    main()
