"""Re-normalize existing v3.2 rows after the QA consolidation added new
FAQ_ALIASES / FRICTION_ALIASES to taxonomy.py.

Adding an alias only affects FUTURE extractions; rows already in the DB still
carry the fragmented non-seed code (e.g. faq insight_subtype='billing'). This
script folds those into their canonical seed code so the dashboard shows the
consolidated topic.

We deliberately DO NOT recompute content_hash: v3.2 transcripts are already
processed and will never be re-extracted (the pipeline filters them out), and
any future run uses a different prompt_version (separate hash namespace), so a
stale hash cannot cause a duplicate. Keeping it simple avoids unique-constraint
juggling on content_hash.

Dry-run by default; pass --apply to write.
"""

from __future__ import annotations

import sys

import config
import psycopg2
import psycopg2.extras
from taxonomy import FAQ_ALIASES, FRICTION_ALIASES

PV = "v3.2"
PLANS = [("faq", FAQ_ALIASES), ("deal_friction", FRICTION_ALIASES)]


def main():
    apply = "--apply" in sys.argv
    conn = psycopg2.connect(**config.get_db_connection_params(), connect_timeout=20)
    conn.autocommit = True
    cur = conn.cursor()

    grand = 0
    for itype, aliases in PLANS:
        print(f"\n=== {itype} ===")
        for nonseed, seed in sorted(aliases.items()):
            cur.execute(
                "SELECT count(*) FROM transcript_insights "
                "WHERE prompt_version=%s AND insight_type=%s AND insight_subtype=%s",
                (PV, itype, nonseed),
            )
            n = cur.fetchone()[0]
            if n == 0:
                continue
            grand += n
            print(f"  {n:>5}  {nonseed} -> {seed}")
            if apply:
                cur.execute(
                    "UPDATE transcript_insights SET insight_subtype=%s "
                    "WHERE prompt_version=%s AND insight_type=%s AND insight_subtype=%s",
                    (seed, PV, itype, nonseed),
                )

    print(f"\nTotal rows {'updated' if apply else 'that would change'}: {grand}")
    if not apply:
        print("(dry-run — pass --apply to write)")
    conn.close()


if __name__ == "__main__":
    main()
