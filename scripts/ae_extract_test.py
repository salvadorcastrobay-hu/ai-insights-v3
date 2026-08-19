"""
Fase 2 del AE Playbook: prueba de la extraccion AE-side. NO escribe en la DB.

Corre el prompt `ae_v1` sobre una muestra chica de transcripts y evalua tres
cosas de forma automatica, sin juez LLM:

  - FIDELIDAD: cada `verbatim_quote` tiene que aparecer literal en el chunk. Es
    verificable con un substring match, asi que no hace falta un evaluador. Si
    esta metrica no da >=90%, el prompt no esta listo y no tiene sentido gastar
    en el run completo.
  - ATRIBUCION: el `speaker_name` que devuelve el modelo tiene que matchear al
    deal_owner. Si matchea al lead, es un falso positivo grave.
  - COBERTURA: cuantas unidades por chunk y como se reparten por unit_type. Sirve
    para detectar que el modelo se sesga a un solo tipo.

El output queda en artifacts/ae_test_<ts>.json (crudo, para diffear entre
versiones del prompt) y artifacts/ae_test_<ts>.md (legible, para que lo revise
una persona de Sales).

Usage:
    source .venv/bin/activate
    python scripts/ae_extract_test.py --sample 5
    python scripts/ae_extract_test.py --sample 10 --model gpt-4o --validated-only
    python scripts/ae_extract_test.py --transcript-id <recording_id>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ae_models import get_ae_json_schema  # noqa: E402
from ae_prompt_builder import (  # noqa: E402
    AE_PROMPT_VERSION,
    build_ae_system_prompt,
    build_ae_user_prompt,
)
from src.skills.ae_fidelity import check_unit, gate  # noqa: E402
from src.skills.market_filters import build_region_filter_clause  # noqa: E402

# config, psycopg2 y openai se importan dentro de main(): config.py exige
# variables de entorno al importarse, y asi `--help` funciona sin .env.

ARTIFACTS = os.path.join(ROOT, "artifacts")

# Solo columnas que existen en mv_insights_norm (no tiene company_size ni
# verbatim_quote: la MV expone los `*_display` y un subconjunto de los crudos).
META_COLS = [
    "company_name", "region", "country", "industry", "segment",
    "deal_stage", "deal_owner", "call_date", "is_validated",
]


def fetch_sample(cur, region: str, sample: int, validated_only: bool,
                 transcript_id: str | None) -> list[dict]:
    """Trae transcripts con su metadata de deal (una fila por transcript)."""
    if transcript_id:
        where, params = "t.recording_id = %s", [transcript_id]
    else:
        clauses, params = [], []
        if region != "all":
            rc, rp = build_region_filter_clause("m.region", region)
            if rc:
                clauses.append(rc)
                params.extend(rp)
        if validated_only:
            clauses.append("m.is_validated = true")
        where = " AND ".join(clauses) if clauses else "TRUE"

    # DISTINCT ON: la MV tiene una fila por insight y aca queremos una por
    # transcript. El ORDER BY de un DISTINCT ON tiene que arrancar por la
    # expresion distinguida, asi que la muestra se ordena por fecha en el nivel
    # de afuera — importa que sean las llamadas mas recientes: el pitch de hace
    # un año no es el que hay que testear.
    cur.execute(
        f"""
        SELECT * FROM (
            SELECT DISTINCT ON (t.recording_id)
                   t.recording_id, t.transcript_text,
                   {', '.join('m.' + c for c in META_COLS)}
            FROM raw_transcripts t
            JOIN mv_insights_norm m ON m.transcript_id = t.recording_id
            WHERE {where}
              AND LENGTH(COALESCE(t.transcript_text, '')) > 2000
            ORDER BY t.recording_id, m.call_date DESC NULLS LAST
        ) s
        ORDER BY s.call_date DESC NULLS LAST
        LIMIT %s
        """,
        params + [1 if transcript_id else sample],
    )
    out = []
    for row in cur.fetchall():
        rid, text = row[0], row[1]
        out.append({
            "transcript_id": rid,
            "transcript_text": text,
            "metadata": dict(zip(META_COLS, row[2:])),
        })
    return out


def extract_chunk(client, model: str, system_prompt: str,
                  response_format: dict, chunk_text: str, metadata: dict) -> dict:
    resp = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format=response_format,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": build_ae_user_prompt(chunk_text, metadata)},
        ],
    )
    return json.loads(resp.choices[0].message.content)


def main() -> int:
    ap = argparse.ArgumentParser(description="Prueba de extraccion AE-side (no escribe en DB)")
    ap.add_argument("--sample", type=int, default=5)
    ap.add_argument("--region", default="HISPAM")
    ap.add_argument("--model", default="gpt-4o",
                    help="gpt-4o por default: la fidelidad del verbatim ES el producto")
    ap.add_argument("--validated-only", action="store_true",
                    help="Solo demos con is_validated = true")
    ap.add_argument("--transcript-id", default=None, help="Correr sobre un transcript puntual")
    ap.add_argument("--max-chunks", type=int, default=3,
                    help="Chunks por transcript (limita costo del test)")
    args = ap.parse_args()

    os.makedirs(ARTIFACTS, exist_ok=True)

    import config  # noqa: E402
    import psycopg2  # noqa: E402
    from openai import OpenAI  # noqa: E402
    from chunker import chunk_transcript  # noqa: E402  (arrastra tiktoken)

    params = config.get_db_connection_params()
    conn = psycopg2.connect(**params, connect_timeout=15)
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY;")
    cur.execute("SET statement_timeout = '120s';")
    transcripts = fetch_sample(cur, args.region, args.sample, args.validated_only, args.transcript_id)
    conn.close()

    if not transcripts:
        print("Sin transcripts para esos filtros.", file=sys.stderr)
        return 1

    print(f"{len(transcripts)} transcripts | model={args.model} | prompt={AE_PROMPT_VERSION}")

    client = OpenAI(api_key=config.OPENAI_API_KEY)
    system_prompt = build_ae_system_prompt()
    response_format = get_ae_json_schema()

    results, stats = [], Counter()
    types = Counter()
    t0 = time.time()

    for i, t in enumerate(transcripts, 1):
        owner = t["metadata"].get("deal_owner")
        chunks = chunk_transcript(t["transcript_id"], t["transcript_text"])[: args.max_chunks]
        print(f"\n[{i}/{len(transcripts)}] {t['transcript_id'][:16]} "
              f"owner={owner} chunks={len(chunks)}")

        for ch in chunks:
            try:
                raw = extract_chunk(client, args.model, system_prompt,
                                    response_format, ch["text"], t["metadata"])
            except Exception as e:
                stats["errores"] += 1
                print(f"    chunk {ch['chunk_index']}: ERROR {type(e).__name__}: {e}")
                continue

            units = raw.get("units", [])
            stats["chunks"] += 1
            stats["unidades"] += len(units)
            for u in units:
                sc = check_unit(u, ch["text"], owner)
                stats["literal_ok"] += sc["literal"]
                stats[f"attrib_{sc['attrib']}"] += 1
                stats["con_problemas"] += bool(sc["problemas"])
                types[u.get("unit_type")] += 1
                stats["terminos"] += len(u.get("terms") or [])
                results.append({
                    "transcript_id": t["transcript_id"],
                    "chunk_index": ch["chunk_index"],
                    "deal_owner": owner,
                    "metadata": {k: str(v) for k, v in t["metadata"].items()},
                    "unit": u,
                    "check": sc,
                })
            print(f"    chunk {ch['chunk_index']}: {len(units)} unidades")

    n = stats["unidades"]
    print(f"\n{'=' * 60}\nRESULTADO ({round(time.time() - t0, 1)}s)\n{'=' * 60}")
    print(f"  chunks procesados       {stats['chunks']}  (errores: {stats['errores']})")
    por_chunk = f"  ({n / stats['chunks']:.1f} por chunk)" if stats["chunks"] else ""
    print(f"  unidades               {n}{por_chunk}")
    print(f"  terminos de glosario   {stats['terminos']}")
    if n:
        fid = 100 * stats["literal_ok"] / n
        print(f"  FIDELIDAD (cita literal) {fid:.1f}%  ← gate: >=90%")
        print(f"  atribucion ok            {stats['attrib_ok']}"
              f" | mismatch {stats['attrib_mismatch']} | sin dato {stats['attrib_sin_dato']}")
        print(f"  unidades con problemas   {stats['con_problemas']}  ({100 * stats['con_problemas'] / n:.0f}%)")
        print("\n  por tipo:")
        for k, v in types.most_common():
            print(f"    {v:>5}  {k}")

        passed, motivo = gate(stats, n)
        print(f"\n  VEREDICTO: {'PASA' if passed else 'NO PASA'} — {motivo}")
        if not passed:
            print("  Ajustar el prompt antes de gastar en el run completo.")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = os.path.join(ARTIFACTS, f"ae_test_{ts}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "prompt_version": AE_PROMPT_VERSION,
            "model": args.model,
            "region": args.region,
            "validated_only": args.validated_only,
            "stats": dict(stats),
            "by_type": dict(types),
            "results": results,
        }, f, ensure_ascii=False, indent=2)

    md_path = os.path.join(ARTIFACTS, f"ae_test_{ts}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# Prueba extraccion AE-side — {AE_PROMPT_VERSION} / {args.model}\n\n")
        f.write(f"Region: {args.region} · validated_only: {args.validated_only} · "
                f"unidades: {n} · fidelidad: {100 * stats['literal_ok'] / n:.1f}%\n\n"
                if n else "Sin unidades.\n\n")
        for ut, _ in types.most_common():
            f.write(f"\n## {ut}\n")
            for r in [x for x in results if x["unit"].get("unit_type") == ut]:
                u, c = r["unit"], r["check"]
                flag = "" if not c["problemas"] else f"  ⚠ {'; '.join(c['problemas'])}"
                f.write(f"\n**{r['metadata'].get('company_name')}** · {r['deal_owner']}"
                        f" · module=`{u.get('module')}` · conf={u.get('confidence')}{flag}\n\n")
                if u.get("trigger"):
                    f.write(f"> Lead: _{u['trigger']}_\n\n")
                f.write(f"> AE: {u.get('verbatim_quote')}\n\n")
                f.write(f"{u.get('paraphrase')}\n\n")
                for term in u.get("terms") or []:
                    f.write(f"- `{term.get('term')}` → {term.get('gloss')}\n")

    print(f"\n  crudo:    {json_path}")
    print(f"  legible:  {md_path}   ← mandarle esto a Sales para que valide")
    return 0


if __name__ == "__main__":
    sys.exit(main())
