"""
Backfill roadmap_match_id on existing product_gap insights.

Runs match_feature_to_roadmap() against feature_name/gap_description of
insights already in the DB -- no re-extraction needed, since the matching
is a pure function of text that's already stored. Safe to re-run any time
data/roadmap_features.csv is refreshed (scripts/import_roadmap_csv.py).

Requires the `roadmap_match_id` column to already exist on
transcript_insights (see the schema migration step in the plan).

Usage:
    python scripts/backfill_roadmap_matches.py --dry-run
    python scripts/backfill_roadmap_matches.py
"""
from __future__ import annotations

import argparse
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

import config
import psycopg2
import psycopg2.extras

from db import get_client
from taxonomy import match_feature_to_roadmap, get_roadmap_features

PAGE_SIZE = 1000


def _fetch_product_gaps(client) -> list[dict]:
    rows = []
    offset = 0
    while True:
        resp = (
            client.table("transcript_insights")
            .select("id,feature_name,gap_description,roadmap_match_id")
            .eq("insight_type", "product_gap")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def backfill(dry_run: bool = False) -> dict:
    client = get_client()
    features = get_roadmap_features()
    if not features:
        raise RuntimeError(
            "data/roadmap_features.csv is empty or missing -- run "
            "scripts/import_roadmap_csv.py first."
        )

    rows = _fetch_product_gaps(client)
    print(f"Found {len(rows)} product_gap insights")

    updates = []
    matched = 0
    changed = 0
    for row in rows:
        match_id = match_feature_to_roadmap(row.get("feature_name"), row.get("gap_description"))
        if match_id:
            matched += 1
        if match_id != row.get("roadmap_match_id"):
            changed += 1
            updates.append({"id": row["id"], "roadmap_match_id": match_id})

    print(f"Matched: {matched}/{len(rows)}")
    print(f"Rows to update: {changed}")

    if dry_run:
        print("Dry run -- no writes performed.")
        return {"total": len(rows), "matched": matched, "updated": 0}

    # Bulk UPDATE ... FROM (VALUES ...) via psycopg2, not a REST upsert:
    # upsert() with a partial column set builds a real INSERT under the
    # hood, which fails NOT NULL constraints on columns we didn't include
    # (e.g. transcript_id) even though the row already exists and only the
    # UPDATE branch should ever fire. A plain UPDATE only touches the one
    # column we're changing.
    params = config.get_db_connection_params()
    conn = psycopg2.connect(**params, connect_timeout=15)
    updated = 0
    try:
        with conn.cursor() as cur:
            batch_size = 500
            for i in range(0, len(updates), batch_size):
                batch = updates[i : i + batch_size]
                values = [(u["id"], u["roadmap_match_id"]) for u in batch]
                psycopg2.extras.execute_values(
                    cur,
                    "UPDATE transcript_insights AS t SET roadmap_match_id = v.roadmap_match_id "
                    "FROM (VALUES %s) AS v (id, roadmap_match_id) "
                    "WHERE t.id = v.id::uuid",
                    values,
                )
                updated += len(batch)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(f"Updated {updated} rows.")
    return {"total": len(rows), "matched": matched, "updated": updated}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Compute matches without writing to the DB")
    args = parser.parse_args()
    backfill(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
