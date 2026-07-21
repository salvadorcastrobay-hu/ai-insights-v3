"""QA step: propose consolidation of auto-created (non-seed) FAQ / deal_friction
subtype codes against the seed taxonomy, using gpt-4o (project convention: QA
always uses gpt-4o, never mini).

For each non-seed code it proposes ONE of:
  - alias   : same meaning as an existing seed code -> add to *_ALIASES
  - promote : genuinely new, distinct topic         -> add to seed SUBTYPES
  - mislotted: not a real subtype (it's a module/feature name in the wrong field)
              -> prompt fix, not a taxonomy change

Output is a reviewable JSON + printed table. Applies NOTHING automatically.
"""

from __future__ import annotations

import json
import os
import sys

import config
from openai import OpenAI

INPUT = "/tmp/consolidation_input.json"
OUTPUT = "/tmp/consolidation_proposal.json"
MODEL = "gpt-4o"  # QA convention

SYSTEM = """Sos un analista de taxonomía para una herramienta de sales insights (Humand, HR software).
Te doy, para un tipo de insight, la lista de códigos "seed" (taxonomía oficial curada) y una lista
de códigos "non-seed" que la IA auto-creó al extraer (porque no matchearon exacto con la seed).

Para CADA código non-seed decidí una de tres acciones:
- "alias": significa lo mismo que un código seed existente. Devolvé 'target' = el code seed.
- "promote": es un topic genuinamente nuevo y distinto, que merece ser código oficial. 'target' = null.
- "mislotted": NO es un subtipo válido de este tipo de insight (ej: es el nombre de un MÓDULO o
  FEATURE del producto metido en el campo equivocado, no un topic de FAQ / motivo de fricción).
  'target' = null. Esto indica un problema de prompting, no de taxonomía.

Respondé SOLO JSON válido con esta forma:
{"decisions":[{"code":"...","action":"alias|promote|mislotted","target":"seed_code_or_null","reason":"breve"}]}"""


def build_user(itype: str, seed: list, nonseed: list) -> str:
    seed_lines = "\n".join(f'  {s["code"]} — {s["display_name"]}' for s in seed)
    ns_lines = "\n".join(
        f'  {n["code"]} (freq {n["freq"]}) ej: {" | ".join((n.get("examples") or [])[:2])[:220]}'
        for n in nonseed
    )
    return (
        f"TIPO DE INSIGHT: {itype}\n\n"
        f"CÓDIGOS SEED (taxonomía oficial):\n{seed_lines}\n\n"
        f"CÓDIGOS NON-SEED A EVALUAR:\n{ns_lines}"
    )


def main():
    data = json.load(open(INPUT))
    client = OpenAI(api_key=config.OPENAI_API_KEY)
    result = {}
    for itype, blk in data.items():
        print(f"\n{'='*70}\n{itype.upper()} — {len(blk['nonseed'])} non-seed codes -> gpt-4o\n{'='*70}")
        resp = client.chat.completions.create(
            model=MODEL,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": build_user(itype, blk["seed"], blk["nonseed"])},
            ],
        )
        decisions = json.loads(resp.choices[0].message.content).get("decisions", [])
        # attach freq for prioritisation
        freq = {n["code"]: n["freq"] for n in blk["nonseed"]}
        for d in decisions:
            d["freq"] = freq.get(d["code"], 0)
        decisions.sort(key=lambda d: (-{"alias": 0, "promote": 1, "mislotted": 2}[d["action"]], -d["freq"]))
        result[itype] = decisions
        # print grouped
        for action in ("alias", "promote", "mislotted"):
            rows = [d for d in decisions if d["action"] == action]
            if not rows:
                continue
            print(f"\n  --- {action.upper()} ({len(rows)}) ---")
            for d in rows:
                tgt = f" -> {d['target']}" if d.get("target") else ""
                print(f"    [{d['freq']:>4}] {d['code']}{tgt}  ({d['reason']})")
    json.dump(result, open(OUTPUT, "w"), ensure_ascii=False, indent=2)
    print(f"\nsaved {OUTPUT}")


if __name__ == "__main__":
    main()
