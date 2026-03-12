"""
QA Evaluator: evaluate extraction quality, identify patterns, suggest refinements.

Usage via CLI:
    python main.py qa --sample 30          # Evaluate 30 transcripts
    python main.py qa --report             # Print last QA report
    python main.py qa --apply              # Apply suggested refinements
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openai import OpenAI
from supabase import Client as SupabaseClient
from tenacity import retry, stop_after_attempt, wait_exponential

import config
from db import fetch_transcripts_with_insights, insert_qa_results
from qa_prompt_builder import (
    build_qa_system_prompt,
    build_qa_user_prompt,
    build_taxonomy_summary,
)

logger = logging.getLogger(__name__)

QA_REPORT_PATH = os.path.join(os.path.dirname(__file__), "qa_report.json")
REFINEMENTS_PATH = os.path.join(os.path.dirname(__file__), "prompt_refinements.json")


def run_qa(
    supabase: SupabaseClient,
    sample: int = 30,
    model: str = "gpt-4o",
) -> dict:
    """
    Run QA evaluation on transcripts that already have insights.

    1. Fetch N transcripts with their extracted insights
    2. For each: send transcript + insights to QA agent
    3. Parse results -> store in qa_results table
    4. Aggregate -> generate qa_report.json
    """
    logger.info(f"Starting QA evaluation (sample={sample}, model={model})...")

    # Step 1: Fetch transcripts with insights
    data = fetch_transcripts_with_insights(supabase, sample=sample)
    if not data:
        logger.warning("No transcripts with insights found")
        return {"evaluated": 0}

    logger.info(f"Found {len(data)} transcripts with insights to evaluate")

    # Prepare taxonomy summary (reused across all evaluations)
    taxonomy_summary = build_taxonomy_summary()
    qa_system_prompt = build_qa_system_prompt()

    openai_client = OpenAI(api_key=config.OPENAI_API_KEY)

    # Step 2: Evaluate each transcript
    all_results = []
    for i, item in enumerate(data, 1):
        tid = item["transcript_id"]
        logger.info(f"[{i}/{len(data)}] Evaluating {tid}...")

        try:
            result = _evaluate_single(
                openai_client,
                qa_system_prompt,
                item["transcript_text"],
                item["insights"],
                taxonomy_summary,
                model=model,
            )

            # Compute overall score
            scores = [
                result.get("completeness", 0),
                result.get("precision", 0),
                result.get("classification", 0),
                result.get("quotes_accuracy", 0),
            ]
            overall = sum(scores) / len(scores) if scores else 0

            qa_row = {
                "transcript_id": tid,
                "completeness": result.get("completeness"),
                "precision_score": result.get("precision"),
                "classification": result.get("classification"),
                "quotes_accuracy": result.get("quotes_accuracy"),
                "overall_score": round(overall, 3),
                "missing_insights": json.dumps(result.get("missing_insights", [])),
                "wrong_classifications": json.dumps(result.get("wrong_classifications", [])),
                "hallucinations": json.dumps(result.get("hallucinations", [])),
                "taxonomy_suggestions": json.dumps(result.get("taxonomy_suggestions", [])),
                "notes": result.get("notes"),
                "model_used": model,
            }

            all_results.append({**qa_row, "_raw": result})
            logger.info(
                f"  -> completeness={result.get('completeness', '?')}, "
                f"precision={result.get('precision', '?')}, "
                f"classification={result.get('classification', '?')}, "
                f"quotes={result.get('quotes_accuracy', '?')}, "
                f"overall={overall:.2f}"
            )

        except Exception as e:
            logger.error(f"Error evaluating {tid}: {e}")
            continue

    if not all_results:
        logger.error("No evaluations completed")
        return {"evaluated": 0}

    # Step 3: Store in DB
    db_rows = [{k: v for k, v in r.items() if k != "_raw"} for r in all_results]
    inserted = insert_qa_results(supabase, db_rows)
    logger.info(f"Inserted {inserted} QA results into DB")

    # Step 4: Generate report
    report = _generate_report(all_results)
    with open(QA_REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    logger.info(f"QA report saved to {QA_REPORT_PATH}")

    return {"evaluated": len(all_results), "inserted": inserted, "report_path": QA_REPORT_PATH}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=60))
def _evaluate_single(
    client: OpenAI,
    system_prompt: str,
    transcript_text: str,
    insights: list[dict],
    taxonomy_summary: str,
    model: str = "gpt-4o",
) -> dict:
    """Evaluate a single transcript's insights via the QA agent."""
    # Simplify insights for the prompt (keep only relevant fields)
    simplified_insights = []
    for ins in insights:
        simplified_insights.append({
            "insight_type": ins.get("insight_type"),
            "insight_subtype": ins.get("insight_subtype"),
            "module": ins.get("module"),
            "summary": ins.get("summary"),
            "verbatim_quote": ins.get("verbatim_quote"),
            "confidence": ins.get("confidence"),
            "competitor_name": ins.get("competitor_name"),
            "competitor_relationship": ins.get("competitor_relationship"),
            "feature_name": ins.get("feature_name"),
            "gap_description": ins.get("gap_description"),
            "gap_priority": ins.get("gap_priority"),
            "faq_topic": ins.get("faq_topic"),
        })

    user_prompt = build_qa_user_prompt(transcript_text, simplified_insights, taxonomy_summary)

    response = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    content = response.choices[0].message.content
    return json.loads(content)


def _generate_report(results: list[dict]) -> dict:
    """Aggregate individual QA results into a summary report."""
    n = len(results)

    # Average scores
    avg_scores = {}
    for key in ("completeness", "precision_score", "classification", "quotes_accuracy", "overall_score"):
        vals = [r.get(key) for r in results if r.get(key) is not None]
        display_key = key.replace("precision_score", "precision").replace("overall_score", "overall")
        avg_scores[display_key] = round(sum(vals) / len(vals), 3) if vals else 0

    # Collect all issues
    all_missing = []
    all_wrong = []
    all_hallucinations = []
    all_taxonomy_suggestions = []
    all_notes = []

    for r in results:
        raw = r.get("_raw", {})
        all_missing.extend(raw.get("missing_insights", []))
        all_wrong.extend(raw.get("wrong_classifications", []))
        all_hallucinations.extend(raw.get("hallucinations", []))
        all_taxonomy_suggestions.extend(raw.get("taxonomy_suggestions", []))
        if raw.get("notes"):
            all_notes.append(raw["notes"])

    # Find common patterns in issues
    common_issues = _find_common_issues(all_missing, all_wrong, all_hallucinations, all_notes)

    # Generate prompt refinements from patterns
    prompt_refinements = _suggest_prompt_refinements(all_missing, all_wrong, all_notes)

    # Aggregate taxonomy additions
    taxonomy_additions = _aggregate_taxonomy_suggestions(all_taxonomy_suggestions)

    report = {
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "sample_size": n,
        "avg_scores": avg_scores,
        "common_issues": common_issues,
        "prompt_refinements": prompt_refinements,
        "taxonomy_additions": taxonomy_additions,
        "details": {
            "missing_insights_count": len(all_missing),
            "wrong_classifications_count": len(all_wrong),
            "hallucinations_count": len(all_hallucinations),
            "taxonomy_suggestions_count": len(all_taxonomy_suggestions),
        },
        "all_missing": all_missing[:20],
        "all_wrong": all_wrong[:20],
        "all_hallucinations": all_hallucinations[:10],
    }

    return report


def _find_common_issues(
    missing: list[dict],
    wrong: list[dict],
    hallucinations: list[dict],
    notes: list[str],
) -> list[str]:
    """Extract common issue patterns from QA results."""
    issues = []

    # Count missing by type
    missing_by_type: dict[str, int] = {}
    for m in missing:
        t = m.get("insight_type", "unknown")
        missing_by_type[t] = missing_by_type.get(t, 0) + 1

    for t, count in sorted(missing_by_type.items(), key=lambda x: -x[1]):
        if count >= 2:
            issues.append(f"Insights de tipo '{t}' se pierden frecuentemente ({count} veces)")

    # Count wrong classifications by pattern
    wrong_patterns: dict[str, int] = {}
    for w in wrong:
        pattern = f"{w.get('current_type', '?')}->{w.get('suggested_type', '?')}"
        wrong_patterns[pattern] = wrong_patterns.get(pattern, 0) + 1

    for pattern, count in sorted(wrong_patterns.items(), key=lambda x: -x[1]):
        if count >= 2:
            issues.append(f"Clasificacion erronea frecuente: {pattern} ({count} veces)")

    if hallucinations:
        issues.append(f"Se detectaron {len(hallucinations)} alucinaciones en total")

    return issues


def _suggest_prompt_refinements(
    missing: list[dict],
    wrong: list[dict],
    notes: list[str],
) -> list[str]:
    """Generate prompt refinement suggestions from QA patterns."""
    refinements = []

    # Analyze missing patterns
    missing_by_type: dict[str, list[str]] = {}
    for m in missing:
        t = m.get("insight_type", "unknown")
        desc = m.get("description", "")
        missing_by_type.setdefault(t, []).append(desc)

    for t, descriptions in missing_by_type.items():
        if len(descriptions) >= 2:
            examples = "; ".join(descriptions[:3])
            refinements.append(
                f"Prestar especial atencion a insights de tipo '{t}' que se pierden. "
                f"Ejemplos: {examples}"
            )

    # Analyze wrong classifications
    for w in wrong:
        reason = w.get("reason", "")
        if reason:
            refinements.append(reason)

    # Deduplicate similar refinements
    seen = set()
    unique = []
    for r in refinements:
        key = r[:50].lower()
        if key not in seen:
            seen.add(key)
            unique.append(r)

    return unique[:10]


def _aggregate_taxonomy_suggestions(suggestions: list[dict]) -> dict:
    """Aggregate and deduplicate taxonomy addition suggestions."""
    result: dict[str, list[dict]] = {
        "pain_subtypes": [],
        "deal_friction": [],
        "faq": [],
        "competitors": [],
        "modules": [],
    }

    seen_codes: set[str] = set()
    for s in suggestions:
        code = s.get("suggested_code", "")
        if code in seen_codes:
            continue
        seen_codes.add(code)

        category = s.get("category", "")
        entry = {
            "code": code,
            "display_name": s.get("display_name", code),
            "reason": s.get("reason", ""),
        }

        if category in result:
            result[category].append(entry)

    # Remove empty categories
    return {k: v for k, v in result.items() if v}


def print_report() -> None:
    """Print the last QA report in a human-readable format."""
    if not os.path.exists(QA_REPORT_PATH):
        print("No QA report found. Run 'python main.py qa --sample N' first.")
        return

    with open(QA_REPORT_PATH, "r", encoding="utf-8") as f:
        report = json.load(f)

    print("\n" + "=" * 60)
    print("  QA REPORT")
    print("=" * 60)
    print(f"\nEvaluated at: {report.get('evaluated_at', '?')}")
    print(f"Sample size:  {report.get('sample_size', '?')}")

    # Scores
    print("\n--- Scores Promedio ---")
    scores = report.get("avg_scores", {})
    for dim, score in scores.items():
        bar = _score_bar(score)
        print(f"  {dim:20s} {score:.3f}  {bar}")

    # Common issues
    issues = report.get("common_issues", [])
    if issues:
        print("\n--- Issues Comunes ---")
        for issue in issues:
            print(f"  - {issue}")

    # Details
    details = report.get("details", {})
    print("\n--- Detalles ---")
    print(f"  Missing insights:      {details.get('missing_insights_count', 0)}")
    print(f"  Wrong classifications: {details.get('wrong_classifications_count', 0)}")
    print(f"  Hallucinations:        {details.get('hallucinations_count', 0)}")
    print(f"  Taxonomy suggestions:  {details.get('taxonomy_suggestions_count', 0)}")

    # Prompt refinements
    refinements = report.get("prompt_refinements", [])
    if refinements:
        print("\n--- Ajustes Sugeridos al Prompt ---")
        for i, r in enumerate(refinements, 1):
            print(f"  {i}. {r}")

    # Taxonomy additions
    additions = report.get("taxonomy_additions", {})
    if additions:
        print("\n--- Adiciones Sugeridas a Taxonomia ---")
        for category, items in additions.items():
            print(f"  [{category}]")
            for item in items:
                print(f"    - {item['code']}: {item['display_name']} ({item.get('reason', '')})")

    # Sample missing insights
    missing = report.get("all_missing", [])
    if missing:
        print(f"\n--- Ejemplo Missing Insights (top {min(5, len(missing))}) ---")
        for m in missing[:5]:
            print(f"  [{m.get('insight_type', '?')}] {m.get('description', '?')}")
            if m.get("evidence"):
                print(f"     > \"{m['evidence'][:100]}...\"")

    # Sample hallucinations
    hallucinations = report.get("all_hallucinations", [])
    if hallucinations:
        print(f"\n--- Alucinaciones (top {min(5, len(hallucinations))}) ---")
        for h in hallucinations[:5]:
            print(f"  - {h.get('summary', '?')}: {h.get('reason', '?')}")

    print("\n" + "=" * 60)
    print("Para aplicar ajustes: python main.py qa --apply")
    print("=" * 60 + "\n")


def _score_bar(score: float, width: int = 20) -> str:
    """Simple ASCII bar for a 0-1 score."""
    filled = int(score * width)
    return "[" + "#" * filled + "." * (width - filled) + "]"


def apply_refinements(supabase: SupabaseClient) -> dict:
    """
    Read the last QA report and apply refinements:
    1. Generate prompt_refinements.json with additional rules
    2. Insert new taxonomy entries into DB if suggested
    """
    if not os.path.exists(QA_REPORT_PATH):
        logger.error("No QA report found. Run QA first.")
        return {"applied": False}

    with open(QA_REPORT_PATH, "r", encoding="utf-8") as f:
        report = json.load(f)

    stats = {"prompt_rules_added": 0, "taxonomy_added": {}}

    # 1. Generate prompt_refinements.json
    refinements = report.get("prompt_refinements", [])
    if refinements:
        # Determine revision number (increment from previous)
        prev_revision = 0
        if os.path.exists(REFINEMENTS_PATH):
            try:
                with open(REFINEMENTS_PATH, "r", encoding="utf-8") as f:
                    prev_data = json.load(f)
                prev_revision = prev_data.get("revision", 0)
            except Exception:
                pass

        revision = prev_revision + 1
        refinement_data = {
            "additional_rules": refinements,
            "revision": revision,
            "applied_at": datetime.now(timezone.utc).isoformat(),
            "source_report": report.get("evaluated_at", "unknown"),
        }
        with open(REFINEMENTS_PATH, "w", encoding="utf-8") as f:
            json.dump(refinement_data, f, ensure_ascii=False, indent=2)
        stats["prompt_rules_added"] = len(refinements)
        stats["prompt_version"] = f"v2.0+qa{revision}"
        logger.info(f"Saved {len(refinements)} prompt refinements (revision {revision}) to {REFINEMENTS_PATH}")
    else:
        logger.info("No prompt refinements to apply")

    # 2. Insert taxonomy additions
    additions = report.get("taxonomy_additions", {})

    # Pain subtypes
    for item in additions.get("pain_subtypes", []):
        try:
            supabase.table("tax_pain_subtypes").upsert(
                {
                    "code": item["code"],
                    "display_name": item["display_name"],
                    "description": item.get("reason", ""),
                    "theme": "auto_discovered",
                    "module": item.get("module"),
                },
                on_conflict="code",
            ).execute()
            stats["taxonomy_added"].setdefault("pain_subtypes", []).append(item["code"])
            logger.info(f"Added pain subtype: {item['code']}")
        except Exception as e:
            logger.warning(f"Could not add pain subtype {item['code']}: {e}")

    # Competitors
    for item in additions.get("competitors", []):
        try:
            supabase.table("tax_competitors").upsert(
                {
                    "name": item.get("display_name", item["code"]),
                    "region": item.get("region", "latam"),
                },
                on_conflict="name",
            ).execute()
            stats["taxonomy_added"].setdefault("competitors", []).append(item["code"])
            logger.info(f"Added competitor: {item.get('display_name', item['code'])}")
        except Exception as e:
            logger.warning(f"Could not add competitor {item['code']}: {e}")

    # Deal friction
    for item in additions.get("deal_friction", []):
        try:
            supabase.table("tax_deal_friction_subtypes").upsert(
                {
                    "code": item["code"],
                    "display_name": item["display_name"],
                    "description": item.get("reason", ""),
                },
                on_conflict="code",
            ).execute()
            stats["taxonomy_added"].setdefault("deal_friction", []).append(item["code"])
            logger.info(f"Added deal friction subtype: {item['code']}")
        except Exception as e:
            logger.warning(f"Could not add deal friction {item['code']}: {e}")

    # FAQ
    for item in additions.get("faq", []):
        try:
            supabase.table("tax_faq_subtypes").upsert(
                {
                    "code": item["code"],
                    "display_name": item["display_name"],
                    "description": item.get("reason", ""),
                },
                on_conflict="code",
            ).execute()
            stats["taxonomy_added"].setdefault("faq", []).append(item["code"])
            logger.info(f"Added FAQ subtype: {item['code']}")
        except Exception as e:
            logger.warning(f"Could not add FAQ subtype {item['code']}: {e}")

    logger.info("Refinements applied successfully")
    logger.info(f"  Prompt rules: {stats['prompt_rules_added']}")
    for cat, codes in stats.get("taxonomy_added", {}).items():
        logger.info(f"  {cat}: {len(codes)} added ({', '.join(codes)})")

    return {"applied": True, **stats}
