"""
Match Fathom calls to the best HubSpot deal.

Strategy:
1. PRIMARY: Use Fathom crm_matches.companies → find company_id →
   find deals associated to that company in raw_deals → pick best deal
2. FALLBACK: If no company, use participant emails + call title +
   temporal proximity to find the best deal
3. Scoring: exclude [BDR] deals, prefer temporal proximity, then amount > 0
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


def match_call_to_deal(
    transcript: dict,
    deals_by_company: dict[str, list[dict]],
    deals_by_id: dict[str, dict],
) -> dict:
    """
    Match a transcript to the best HubSpot deal.

    Args:
        transcript: row from raw_transcripts (needs fathom_crm_matches, call_date, title)
        deals_by_company: {company_id: [deal_rows]} pre-built index
        deals_by_id: {deal_id: deal_row} for lookups

    Returns:
        {matched_deal_id, match_method, match_score, match_details}
    """
    crm = transcript.get("fathom_crm_matches") or {}
    if isinstance(crm, str):
        import json
        crm = json.loads(crm)

    call_date = _parse_date(transcript.get("call_date"))

    # ── Step 1: Try matching via Fathom company ──
    fathom_companies = crm.get("companies", [])
    company_ids = _extract_ids(fathom_companies, "company")

    if company_ids:
        candidate_deals = []
        for cid in company_ids:
            candidate_deals.extend(deals_by_company.get(cid, []))

        if candidate_deals:
            best = _pick_best_deal(candidate_deals, call_date)
            if best:
                return {
                    "matched_deal_id": best["deal_id"],
                    "match_method": "fathom_company",
                    "match_score": best["_score"],
                    "match_details": {
                        "fathom_companies": [c.get("name") for c in fathom_companies],
                        "company_ids": company_ids,
                        "candidates_found": len(candidate_deals),
                        "chosen_deal": best["deal_name"],
                    },
                }

    # ── Step 2: Fallback — try Fathom deal URLs directly ──
    fathom_deals = crm.get("deals", [])
    fathom_deal_ids = _extract_ids(fathom_deals, "deal")

    if fathom_deal_ids:
        candidate_deals = [
            deals_by_id[did] for did in fathom_deal_ids if did in deals_by_id
        ]
        if candidate_deals:
            best = _pick_best_deal(candidate_deals, call_date)
            if best:
                return {
                    "matched_deal_id": best["deal_id"],
                    "match_method": "fathom_deal",
                    "match_score": best["_score"],
                    "match_details": {
                        "fathom_deal_ids": fathom_deal_ids,
                        "candidates_found": len(candidate_deals),
                        "chosen_deal": best["deal_name"],
                    },
                }

    # ── Step 3: No match ──
    return {
        "matched_deal_id": None,
        "match_method": "none",
        "match_score": 0.0,
        "match_details": {
            "fathom_companies": [c.get("name") for c in fathom_companies],
            "fathom_deals": [d.get("name") for d in fathom_deals],
            "reason": "no_company_deals_found" if company_ids else "no_company_in_fathom",
        },
    }


def _pick_best_deal(deals: list[dict], call_date: datetime | None) -> dict | None:
    """Score and pick the best deal from candidates."""
    if not deals:
        return None

    scored = []
    for d in deals:
        deal_name = d.get("deal_name") or ""

        # Skip [BDR] deals (prospection, not real sales deals)
        if deal_name.strip().startswith("[BDR]"):
            continue

        score = 0.0

        # Temporal proximity (0 to 0.6) — most important signal
        deal_create = _parse_date(d.get("create_date"))
        if call_date and deal_create:
            days_diff = abs((call_date - deal_create).days)
            if days_diff <= 365:
                score += 0.6 * max(0, 1 - (days_diff / 365))

        # Has amount (0.3)
        amount = d.get("amount")
        if amount and float(amount) > 0:
            score += 0.3

        # Small tiebreaker: prefer more recent deals
        if deal_create:
            epoch_days = (deal_create - datetime(2020, 1, 1, tzinfo=deal_create.tzinfo)).days
            score += 0.1 * min(1, epoch_days / 2200)  # normalize ~6 years

        d["_score"] = round(score, 3)
        scored.append(d)

    if not scored:
        # All candidates were [BDR], fall back to including them
        for d in deals:
            deal_create = _parse_date(d.get("create_date"))
            score = 0.0
            if call_date and deal_create:
                days_diff = abs((call_date - deal_create).days)
                if days_diff <= 365:
                    score += 0.6 * max(0, 1 - (days_diff / 365))
            d["_score"] = round(score, 3)
            scored.append(d)

    if not scored:
        return None

    return max(scored, key=lambda d: d["_score"])


def _extract_ids(items: list[dict], entity_type: str) -> list[str]:
    """Extract HubSpot IDs from Fathom record_url fields."""
    ids = []
    pattern = f"/{entity_type}/(\\d+)"
    for item in items:
        url = item.get("record_url", "")
        match = re.search(pattern, url)
        if match:
            ids.append(match.group(1))
    return list(dict.fromkeys(ids))  # dedupe preserving order


def _parse_date(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    try:
        s = str(val).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None
