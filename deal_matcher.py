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
import unicodedata
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# Palabras de titulo de reunion que NO son parte del nombre de la empresa.
_TITLE_STOP = {
    "humand", "demo", "kick", "off", "kickoff", "seguimiento", "mock", "reunion",
    "meeting", "google", "meet", "impromptu", "call", "llamada", "intro", "sync",
    "introduccion", "onboarding", "implementacion", "followup", "follow", "up",
    "weekly", "semanal", "presentacion", "propuesta", "cierre", "review", "catch",
}
# Sufijos corporativos y ruido de fecha en deal_name.
_CORP_SUFFIX = {"sa", "srl", "sas", "ltda", "ltd", "inc", "llc", "sac", "spa", "cia", "co", "sl", "eirl"}
_DATE_NOISE = {
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto",
    "setembro", "outubro", "novembro", "dezembro", "q1", "q2", "q3", "q4",
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("\xa0", " ").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _company_tokens(s: str, stop: set[str]) -> set[str]:
    toks = set()
    for t in _norm(s).split():
        if t in stop or t in _CORP_SUFFIX or t in _DATE_NOISE:
            continue
        if t.isdigit():  # años/números sueltos
            continue
        if len(t) < 3:
            continue
        toks.add(t)
    return toks


def extract_company_from_title(title: str | None) -> set[str]:
    """Tokens candidatos a nombre de empresa desde el titulo de la reunion.
    Devuelve set vacio si el titulo no parece contener una empresa (mock,
    solo nombres de personas, 'Impromptu Meeting', etc.)."""
    if not title:
        return set()
    # sacar parentesis (suelen ser nombres de persona: "(Violeta Alcibar)")
    t = re.sub(r"\([^)]*\)", " ", title)
    # partir por conectores tipicos y quedarse con los segmentos sin 'humand'
    segments = re.split(r"[+&|:/]| - ", t)
    cand = set()
    for seg in segments:
        seg_norm = _norm(seg)
        if not seg_norm or "humand" in seg_norm.split():
            continue
        cand |= _company_tokens(seg, _TITLE_STOP)
    return cand


def _deal_name_tokens(name: str | None) -> set[str]:
    """Tokens de empresa desde deal_name, quitando tags internos entre corchetes
    ([Inbound], [LUMO], [PRODE 2026], [Naaloo]...) y ruido de fecha."""
    cleaned = re.sub(r"\[[^\]]*\]", " ", name or "")
    return _company_tokens(cleaned, set())


def build_deal_name_index(deals: list[dict]) -> dict[str, list[dict]]:
    """Indice invertido token -> deals, desde deal_name (sin tags ni fechas)."""
    index: dict[str, list[dict]] = {}
    for d in deals:
        for tok in _deal_name_tokens(d.get("deal_name")):
            index.setdefault(tok, []).append(d)
    return index


def match_by_company_name(
    title: str | None,
    name_index: dict[str, list[dict]],
    call_date: datetime | None,
) -> dict | None:
    """Fallback: matchear por nombre de empresa extraido del titulo contra deal_name.
    Conservador: exige que TODOS los tokens de empresa del titulo esten en el
    deal_name (containment), y al menos un token de largo >= 4."""
    cand = extract_company_from_title(title)
    if not cand or not any(len(t) >= 4 for t in cand):
        return None
    # candidatos: deals que comparten al menos un token
    seen: dict[str, dict] = {}
    for tok in cand:
        for d in name_index.get(tok, ()):
            seen[d["deal_id"]] = d
    # Candidato de 1 token: riesgo de nombre de persona ("Carla", "Carlos") o
    # palabra generica ("internacional"). Discriminador = RAREZA: un token de
    # empresa distintivo (Fibertex, Siendorrhh, Polpetta) aparece en poquitos
    # deals; un nombre comun aparece en muchos. Solo aceptamos 1 token si es raro.
    if len(cand) == 1:
        tok = next(iter(cand))
        if len(name_index.get(tok, ())) > 6:
            return None

    matches = []
    for d in seen.values():
        deal_toks = _deal_name_tokens(d.get("deal_name"))
        # containment: todos los tokens candidatos deben estar en el deal_name
        if cand <= deal_toks:
            matches.append(d)
    if not matches:
        return None
    best = _pick_best_deal(matches, call_date)
    if not best:
        return None
    return {
        "matched_deal_id": best["deal_id"],
        "match_method": "title_company",
        "match_score": best["_score"],
        "match_details": {
            "title_tokens": sorted(cand),
            "chosen_deal": best["deal_name"],
            "candidates_found": len(matches),
        },
    }


def match_call_to_deal(
    transcript: dict,
    deals_by_company: dict[str, list[dict]],
    deals_by_id: dict[str, dict],
    deal_name_index: dict[str, list[dict]] | None = None,
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

    # ── Step 3: Fallback — empresa del titulo de la reunion vs deal_name ──
    # Recupera demos reales que Fathom no asocio a company/deal en crm_matches
    # (la empresa esta en el titulo, ej. "Demo Humand & Industrias Ttaio").
    if deal_name_index:
        by_title = match_by_company_name(transcript.get("title"), deal_name_index, call_date)
        if by_title:
            return by_title

    # ── Step 4: No match ──
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
