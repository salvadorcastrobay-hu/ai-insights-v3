"""
Backend-safe competitor normalization helpers.

The advisor should reason over canonical competitor names instead of raw CRM /
transcript variants like "Book" vs "Buk" or casing / spacing differences.
"""
from __future__ import annotations

import unicodedata

from taxonomy import COMPETITORS


OWN_BRAND_COMPETITOR_ALIASES = {"humand", "human", "human d"}

# Manual aliases discovered in live data or already normalized elsewhere in the app.
COMPETITOR_NORMALIZATION = {
    "humand": "Humand",
    "human": "Humand",
    "human d": "Humand",
    "be home": "Beehome",
    "behome": "Beehome",
    "bee home": "Beehome",
    "book": "Buk",
    "buk hr": "Buk",
    "bukhr": "Buk",
    "odu": "Odoo",
    "solides": "Solides",
    "solides tecnologia": "Solides",
    "solids": "Solides",
    "totus": "Totvs",
    "tots": "Totvs",
}


def _normalize_competitor_key(value: str) -> str:
    collapsed = " ".join(value.strip().split()).lower()
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", collapsed) if not unicodedata.combining(ch)
    )


CANONICAL_COMPETITORS_BY_KEY = {
    _normalize_competitor_key(name): name for name in COMPETITORS.keys()
}


def normalize_competitor_name(value) -> str | None:
    """Returns a canonical competitor label when possible."""
    if not isinstance(value, str):
        return value

    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return None

    normalized_key = _normalize_competitor_key(cleaned)
    if normalized_key in OWN_BRAND_COMPETITOR_ALIASES:
        return "Humand"

    manual_match = COMPETITOR_NORMALIZATION.get(normalized_key)
    if manual_match:
        manual_key = _normalize_competitor_key(manual_match)
        return CANONICAL_COMPETITORS_BY_KEY.get(manual_key, manual_match)

    return CANONICAL_COMPETITORS_BY_KEY.get(normalized_key, cleaned)


def is_own_brand_competitor(value) -> bool:
    if not isinstance(value, str):
        return False
    return _normalize_competitor_key(value) in OWN_BRAND_COMPETITOR_ALIASES
