"""
Import a raw Notion "Humand Features" export into data/roadmap_features.csv.

Regenerates the trimmed reference file used by taxonomy.get_roadmap_features()
for matching product_gap feature mentions against the real roadmap. Re-run
this whenever a new Notion export is available -- no manual editing needed.

Usage:
    python scripts/import_roadmap_csv.py --input "/path/to/Humand Features export.csv"
"""
from __future__ import annotations

import argparse
import csv
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_PATH = os.path.join(ROOT, "data", "roadmap_features.csv")

OUTPUT_COLUMNS = [
    "id", "es_feature", "en_feature", "es_description", "en_description",
    "status_raw", "status_bucket", "tribe",
]

# Released -> existing. Everything else that appears in Notion is at least on
# product's radar (even if not committed), so it maps to "roadmap". Only
# features that don't appear in this dataset at all count as "missing" --
# that's resolved at matching time (no match found), not here.
STATUS_TO_BUCKET = {
    "Released": "existing",
}
DEFAULT_BUCKET = "roadmap"


def _status_bucket(status_raw: str) -> str:
    return STATUS_TO_BUCKET.get(status_raw.strip(), DEFAULT_BUCKET)


def import_roadmap_csv(input_path: str, output_path: str = OUTPUT_PATH) -> dict:
    with open(input_path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    out_rows = []
    skipped_no_name = 0
    for row in rows:
        es_feature = (row.get("[ES] Feature") or "").strip()
        en_feature = (row.get("[EN] Feature") or "").strip()
        if not es_feature and not en_feature:
            skipped_no_name += 1
            continue

        feature_id = (row.get("ID") or "").strip()
        status_raw = (row.get("Status") or "").strip()
        out_rows.append({
            "id": feature_id,
            "es_feature": es_feature,
            "en_feature": en_feature,
            "es_description": (row.get("[ES] Description") or "").strip(),
            "en_description": (row.get("[EN] Description") or "").strip(),
            "status_raw": status_raw,
            "status_bucket": _status_bucket(status_raw),
            "tribe": (row.get("Tribe") or "").strip(),
        })

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(out_rows)

    existing_count = sum(1 for r in out_rows if r["status_bucket"] == "existing")
    return {
        "input_rows": len(rows),
        "skipped_no_name": skipped_no_name,
        "output_rows": len(out_rows),
        "existing": existing_count,
        "roadmap": len(out_rows) - existing_count,
        "output_path": output_path,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Path to the raw Notion CSV export")
    parser.add_argument("--output", default=OUTPUT_PATH, help="Output path (default: data/roadmap_features.csv)")
    args = parser.parse_args()

    stats = import_roadmap_csv(args.input, args.output)
    print(f"Input rows: {stats['input_rows']}")
    print(f"Skipped (no ES/EN feature name): {stats['skipped_no_name']}")
    print(f"Output rows: {stats['output_rows']}")
    print(f"  existing: {stats['existing']}")
    print(f"  roadmap:  {stats['roadmap']}")
    print(f"Written to: {stats['output_path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
