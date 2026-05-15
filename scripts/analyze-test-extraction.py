"""Analiza los 169 insights de la corrida v3.1-test y los compara con v3.0."""
from __future__ import annotations
import os
from collections import Counter
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client

c = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

# Fetch all v3.1-test insights
new = c.table("transcript_insights").select("transcript_id,insight_type,insight_subtype,module,feature_name,gap_priority,competitor_name,summary,verbatim_quote,confidence").eq("prompt_version", "v3.1-test").execute().data
print(f"v3.1-test total: {len(new)} insights\n")

# Transcript ids used
tids = sorted(set(r["transcript_id"] for r in new))
print(f"Transcripts: {len(tids)}")

# Match against v3.0 for the same transcripts
old = c.table("transcript_insights").select("transcript_id,insight_type,insight_subtype,module,feature_name").eq("prompt_version", "v3.0").in_("transcript_id", tids).execute().data
print(f"v3.0 total para los mismos {len(tids)} transcripts: {len(old)} insights\n")

# Type breakdown
def by_type(rows):
    c = Counter(r["insight_type"] for r in rows)
    return dict(c)

print(f"Por insight_type:")
print(f"  v3.0 : {by_type(old)}")
print(f"  v3.1 : {by_type(new)}\n")

# Get seed list (canonical features inserted from CSV)
seeds_resp = c.table("tax_feature_names").select("code,display_name,is_seed").eq("is_seed", True).execute()
seeds = {r["code"]: r["display_name"] for r in seeds_resp.data}
csv_seeds = {r["code"] for r in seeds_resp.data if r.get("display_name")}  # all seeds (includes pre-existing + CSV-imported)

# All features ever (incl auto)
all_feats_resp = c.table("tax_feature_names").select("code,display_name,is_seed").execute()
all_feats = {r["code"]: r for r in all_feats_resp.data}

# Now check: for v3.1, how many product_gap insights matched a canonical code?
gaps_v31 = [r for r in new if r["insight_type"] == "product_gap" and r["feature_name"]]
gaps_v30 = [r for r in old if r["insight_type"] == "product_gap" and r["feature_name"]]

print(f"Product gaps:")
print(f"  v3.0: {len(gaps_v30)}")
print(f"  v3.1: {len(gaps_v31)}\n")

def feat_match_pct(rows):
    matched_seed = sum(1 for r in rows if r["feature_name"] in seeds)
    matched_any = sum(1 for r in rows if r["feature_name"] in all_feats)
    return matched_seed, matched_any, len(rows)

ms_30, ma_30, t_30 = feat_match_pct(gaps_v30)
ms_31, ma_31, t_31 = feat_match_pct(gaps_v31)
print(f"Matches contra `tax_feature_names`:")
print(f"  v3.0: {ms_30}/{t_30} ({ms_30/t_30*100:.0f}%) en seeds | {ma_30}/{t_30} ({ma_30/t_30*100:.0f}%) en cualquier feature")
print(f"  v3.1: {ms_31}/{t_31} ({ms_31/t_31*100:.0f}%) en seeds | {ma_31}/{t_31} ({ma_31/t_31*100:.0f}%) en cualquier feature")

# Top features v3.1
print(f"\nTop 15 features usadas en v3.1:")
ft = Counter(r["feature_name"] for r in gaps_v31)
for code, count in ft.most_common(15):
    info = all_feats.get(code, {})
    is_seed_now = info.get("is_seed", False)
    display = info.get("display_name", code)
    marker = "✓seed" if is_seed_now else "?auto"
    print(f"  {count}x  {display:<50} ({marker})  code={code}")

# Show specific feature display name + count diff v3.0 vs v3.1
print(f"\nFeatures que aparecen SOLO en v3.1 (no en v3.0):")
v30_feats = Counter(r["feature_name"] for r in gaps_v30 if r["feature_name"])
v31_feats = Counter(r["feature_name"] for r in gaps_v31 if r["feature_name"])
new_only = set(v31_feats.keys()) - set(v30_feats.keys())
for code in sorted(new_only, key=lambda c: -v31_feats[c])[:20]:
    info = all_feats.get(code, {})
    display = info.get("display_name", code)
    is_seed = info.get("is_seed", False)
    marker = "✓ canonical" if is_seed else "? auto-new"
    print(f"  {v31_feats[code]}x  {display:<50} {marker}")

print(f"\nFeatures que aparecen SOLO en v3.0 (no en v3.1):")
old_only = set(v30_feats.keys()) - set(v31_feats.keys())
for code in sorted(old_only, key=lambda c: -v30_feats[c])[:15]:
    info = all_feats.get(code, {})
    display = info.get("display_name", code)
    print(f"  {v30_feats[code]}x  {display}")

# Module status of insights
print(f"\nModule breakdown:")
def by_mod(rows):
    return Counter(r["module"] for r in rows if r["module"]).most_common(10)
for mod, count in by_mod(new):
    print(f"  {count:3d}  {mod}")
