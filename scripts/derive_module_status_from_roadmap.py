"""
Best-effort suggestions for MODULES[code]["status"] based on the real Notion
roadmap (data/roadmap_features.csv).

For each module, searches its display_name + MODULE_ALIASES phrases inside
the roadmap features' text. This is approximate text matching, not an
explicit link -- it NEVER writes anything. It only prints a diff (module,
current status, suggested status, evidence) for a human to review and apply
by hand in taxonomy.py, the same way competitors were added manually earlier
in this project.

A module with no textual match is left alone (no suggestion) -- absence of
evidence in free-text search is not strong enough evidence to downgrade a
module to "missing".

Usage:
    python scripts/derive_module_status_from_roadmap.py
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from taxonomy import MODULES, MODULE_ALIASES, get_roadmap_features


def _module_search_phrases() -> dict[str, list[str]]:
    """module_code -> [display_name, alias1, alias2, ...] (lowercase)."""
    phrases: dict[str, list[str]] = {code: [m["display_name"].lower()] for code, m in MODULES.items()}
    for alias, code in MODULE_ALIASES.items():
        if code in phrases:
            phrases[code].append(alias.lower())
    return phrases


def derive_suggestions() -> list[dict]:
    features = get_roadmap_features()
    if not features:
        raise RuntimeError(
            "data/roadmap_features.csv is empty or missing -- run "
            "scripts/import_roadmap_csv.py first."
        )

    phrases_by_module = _module_search_phrases()
    suggestions = []

    for code, module in MODULES.items():
        phrases = [p for p in phrases_by_module.get(code, []) if len(p) > 3]
        evidence = []
        has_existing = False
        for fid, feat in features.items():
            text = " ".join([
                feat.get("es_feature", ""), feat.get("en_feature", ""),
                feat.get("es_description", ""), feat.get("en_description", ""),
            ]).lower()
            if any(phrase in text for phrase in phrases):
                evidence.append((fid, feat.get("es_feature") or feat.get("en_feature"), feat["status_bucket"]))
                if feat["status_bucket"] == "existing":
                    has_existing = True

        if not evidence:
            continue  # no evidence either way -- don't suggest anything

        suggested = "existing" if has_existing else "roadmap"
        if suggested != module["status"]:
            suggestions.append({
                "code": code,
                "current_status": module["status"],
                "suggested_status": suggested,
                "evidence": evidence[:5],
                "evidence_count": len(evidence),
            })

    return suggestions


def main() -> int:
    suggestions = derive_suggestions()
    if not suggestions:
        print("No suggestions -- current MODULES statuses already match the roadmap evidence found.")
        return 0

    print(f"{len(suggestions)} module(s) with a suggested status change (review manually, nothing applied):\n")
    for s in suggestions:
        print(f"- {s['code']}: {s['current_status']} -> {s['suggested_status']} ({s['evidence_count']} features matched)")
        for fid, name, bucket in s["evidence"]:
            print(f"    {fid} [{bucket}] {name}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
