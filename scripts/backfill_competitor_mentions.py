"""Task 2a: backfill competitor_name on existing v3.2 pain / deal_friction /
product_gap / faq rows that mention a known competitor in their text but were
left with competitor_name = NULL (only competitive_signal got it populated).

Conservative text matching:
  - whole-word, accent-insensitive
  - search terms = COMPETITORS canonical names + COMPETITOR_ALIASES keys
  - excludes ambiguous/common-word terms (STOPLIST) and terms < 4 chars to
    avoid false positives (e.g. "senior", "flow", "quick", "book")
  - first (longest) match wins, normalized via normalize_competitor()

Dry-run by default; --apply to write. Prints per-competitor breakdown + samples
so the match quality can be eyeballed before applying.
"""

from __future__ import annotations

import re
import sys
import unicodedata

import config
import psycopg2
from taxonomy import COMPETITORS, COMPETITOR_ALIASES, normalize_competitor

PV = "v3.2"
TYPES = ("pain", "deal_friction", "product_gap", "faq")

# Names/aliases that are common words or too generic to match safely in free text.
STOPLIST = {
    "senior", "flow", "quick", "book", "buc", "plurals", "best german",
    "napsic", "premium", "modular", "people", "company", "scope", "email",
    "chat", "search", "logs", "events", "surveys", "learning", "onboarding",
    # Brand names that collide with common ES/PT words -> too many false positives
    "gusto",      # "con gusto", "a gusto", "gosto" (PT)
    "dialog",     # "diálogo"
    "interact",   # "interactuar"/"interacción"
    "threads",    # generic
    "flip", "sage", "worky", "tress", "blink", "glint",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def build_terms():
    raw = set(COMPETITORS.keys()) | set(COMPETITOR_ALIASES.keys())
    terms = []
    for t in raw:
        key = strip_accents(t).lower().strip()
        if key in STOPLIST or len(key) < 4:
            continue
        terms.append((key, t))
    # longest first so multi-word brands win over substrings
    terms.sort(key=lambda x: -len(x[0]))
    return terms


def main():
    apply = "--apply" in sys.argv
    terms = build_terms()
    # one big alternation for the SQL prefilter (accent-insensitive done in py)
    alt = "|".join(re.escape(k) for k, _ in terms)
    prefilter = re.compile(r"\b(" + alt + r")\b", re.I)
    compiled = [(re.compile(r"\b" + re.escape(k) + r"\b", re.I), orig) for k, orig in terms]

    p = dict(config.get_db_connection_params()); p.update(keepalives=1, keepalives_idle=30)
    conn = psycopg2.connect(**p, connect_timeout=20); conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "SELECT id, insight_type, coalesce(summary,'')||' || '||coalesce(verbatim_quote,'') "
        "FROM transcript_insights WHERE prompt_version=%s AND insight_type = ANY(%s) "
        "AND competitor_name IS NULL",
        (PV, list(TYPES)),
    )
    rows = cur.fetchall()
    print(f"scanning {len(rows)} null-competitor rows in {TYPES}...")

    from collections import Counter, defaultdict
    updates = []
    per_comp = Counter()
    samples = defaultdict(list)
    for rid, itype, txt in rows:
        norm_txt = strip_accents(txt)
        if not prefilter.search(norm_txt):
            continue
        for rx, orig in compiled:  # longest-first
            if rx.search(norm_txt):
                canonical = normalize_competitor(orig) or orig
                updates.append((rid, canonical))
                per_comp[canonical] += 1
                if len(samples[canonical]) < 2:
                    samples[canonical].append((itype, txt[:120]))
                break

    print(f"\n=== would populate competitor_name on {len(updates)} rows ===")
    for comp, n in per_comp.most_common():
        print(f"  {n:>4}  {comp}")
    print("\n--- samples (top comps) ---")
    for comp, _ in per_comp.most_common(8):
        for itype, snip in samples[comp]:
            print(f"  [{comp}|{itype}] {snip}")

    if apply and updates:
        psycopg2.extras = __import__("psycopg2.extras", fromlist=["extras"])
        import psycopg2.extras as extras
        extras.execute_values(
            cur,
            "UPDATE transcript_insights AS t SET competitor_name = v.cn "
            "FROM (VALUES %s) AS v(id, cn) WHERE t.id = v.id::uuid",
            updates,
        )
        print(f"\nAPPLIED: updated {len(updates)} rows")
    elif not apply:
        print("\n(dry-run — pass --apply to write)")
    conn.close()


if __name__ == "__main__":
    main()
