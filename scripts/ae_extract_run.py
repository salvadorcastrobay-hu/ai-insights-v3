"""
Fase 3 del AE Playbook: run de extraccion AE-side sobre un recorte del dataset.
ESCRIBE en ae_speech_units / ae_term_usages.

No correr sin haber pasado el gate de scripts/ae_extract_test.py. El costo de un
run completo con gpt-4o no es trivial y un prompt que parafrasea produce un
dataset que hay que tirar.

Idempotente: dedup por `content_hash` (transcript + chunk + unit_type + module +
verbatim normalizado + ae_prompt_version) con ON CONFLICT DO NOTHING. Se puede
cortar y reanudar, y re-correrlo no duplica nada.

Concurrencia: las llamadas a OpenAI van en threads; los INSERT van en el thread
principal sobre una sola conexion. Es mas simple que un pool y el cuello de
botella es la API, no Postgres.

Usage:
    source .venv/bin/activate
    python scripts/ae_extract_run.py --region HISPAM --dry-run
    python scripts/ae_extract_run.py --region HISPAM --limit 20
    python scripts/ae_extract_run.py --region HISPAM            # recorte completo
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ae_models import get_ae_json_schema  # noqa: E402
from ae_parser import parse_ae_response  # noqa: E402
from ae_prompt_builder import (  # noqa: E402
    AE_PROMPT_VERSION,
    build_ae_system_prompt,
    build_ae_user_prompt,
)
from src.skills.market_filters import build_region_filter_clause  # noqa: E402

# config / psycopg2 / openai se importan dentro de main(): ver ae_diag.py.

CONCURRENCY = 8

# USD por millon de tokens de INPUT. Sirve solo para la estimacion del --dry-run:
# es una constante en el codigo, no un precio consultado a la API, asi que hay que
# verificar el vigente antes de decidir un gasto. La salida no se estima porque en
# esta tarea es chica al lado del input (unidades cortas, no texto largo).
PRECIO_INPUT_POR_MTOK = {
    "gpt-4o": 2.50,
    "gpt-4o-mini": 0.15,
}
META_COLS = [
    "company_name", "region", "country", "industry", "segment",
    "deal_stage", "deal_owner", "call_date", "is_validated",
]

INSERT_UNIT = """
INSERT INTO ae_speech_units (
    transcript_id, transcript_chunk, deal_id, company_name, region, country,
    industry, segment, deal_stage, deal_owner, call_date, is_validated,
    unit_type, module, verbatim_quote, paraphrase, trigger_quote, speaker_name,
    confidence, is_literal, attribution, model_used, ae_prompt_version,
    batch_id, content_hash
) VALUES (
    %(transcript_id)s, %(transcript_chunk)s, %(deal_id)s, %(company_name)s,
    %(region)s, %(country)s, %(industry)s, %(segment)s, %(deal_stage)s,
    %(deal_owner)s, %(call_date)s, %(is_validated)s, %(unit_type)s, %(module)s,
    %(verbatim_quote)s, %(paraphrase)s, %(trigger_quote)s, %(speaker_name)s,
    %(confidence)s, %(is_literal)s, %(attribution)s, %(model_used)s,
    %(ae_prompt_version)s, %(batch_id)s, %(content_hash)s
)
ON CONFLICT (content_hash) DO NOTHING
RETURNING id;
"""

INSERT_TERM = """
INSERT INTO ae_term_usages (unit_id, term, term_norm, module, gloss)
VALUES (%(unit_id)s, %(term)s, %(term_norm)s, %(module)s, %(gloss)s);
"""


def fetch_transcripts(cur, region: str, validated_only: bool, since: str | None,
                      limit: int | None, skip_done: bool) -> list[dict]:
    """Transcripts del recorte, con la metadata de deal, mas recientes primero."""
    clauses, params = [], []
    if region != "all":
        rc, rp = build_region_filter_clause("m.region", region)
        if rc:
            clauses.append(rc)
            params.extend(rp)
    if validated_only:
        clauses.append("m.is_validated = true")
    if since:
        clauses.append("m.call_date >= %s")
        params.append(since)
    if skip_done:
        # Reanudable: saltea transcripts que ya tienen unidades de ESTA version
        # del prompt. Con otra version, se re-extrae (es un dataset nuevo).
        clauses.append("""NOT EXISTS (
            SELECT 1 FROM ae_speech_units u
            WHERE u.transcript_id = t.recording_id
              AND u.ae_prompt_version = %s
        )""")
        params.append(AE_PROMPT_VERSION)
    where = " AND ".join(clauses) if clauses else "TRUE"

    sql = f"""
        SELECT * FROM (
            SELECT DISTINCT ON (t.recording_id)
                   t.recording_id, t.transcript_text, m.deal_id,
                   {', '.join('m.' + c for c in META_COLS)}
            FROM raw_transcripts t
            JOIN mv_insights_norm m ON m.transcript_id = t.recording_id
            WHERE {where}
              AND LENGTH(COALESCE(t.transcript_text, '')) > 2000
            ORDER BY t.recording_id, m.call_date DESC NULLS LAST
        ) s
        ORDER BY s.call_date DESC NULLS LAST
    """
    if limit:
        sql += " LIMIT %s"
        params.append(limit)

    cur.execute(sql, params)
    out = []
    for row in cur.fetchall():
        rid, text, deal_id = row[0], row[1], row[2]
        meta = dict(zip(META_COLS, row[3:]))
        meta["deal_id"] = deal_id
        out.append({"transcript_id": rid, "transcript_text": text, "metadata": meta})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Run de extraccion AE-side (escribe en DB)")
    ap.add_argument("--region", default="HISPAM")
    ap.add_argument("--model", default="gpt-4o")
    ap.add_argument("--validated-only", action="store_true")
    ap.add_argument("--since", default=None, help="YYYY-MM-DD")
    ap.add_argument("--limit", type=int, default=None, help="Cuantos transcripts como maximo")
    ap.add_argument("--max-chunks", type=int, default=None,
                    help="Chunks por transcript (default: todos)")
    ap.add_argument("--keep-non-literal", action="store_true",
                    help="Guardar tambien las unidades cuya cita no es literal (por default se descartan)")
    ap.add_argument("--min-confidence", type=float, default=0.0)
    ap.add_argument("--no-resume", action="store_true",
                    help="No saltear transcripts ya procesados con esta version del prompt")
    ap.add_argument("--dry-run", action="store_true",
                    help="Cuenta el recorte y estima el costo, sin llamar a OpenAI ni escribir")
    args = ap.parse_args()

    import config  # noqa: E402
    import psycopg2  # noqa: E402
    from openai import OpenAI  # noqa: E402
    from chunker import chunk_transcript  # noqa: E402

    params = config.get_db_connection_params()
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '300s';")

    transcripts = fetch_transcripts(
        cur, args.region, args.validated_only, args.since, args.limit,
        skip_done=not args.no_resume,
    )
    if not transcripts:
        print("Nada para procesar (o todo ya procesado con esta version del prompt).")
        conn.close()
        return 0

    # Chunkear primero: es local y permite estimar el costo antes de gastar.
    trabajo = []
    for t in transcripts:
        chunks = chunk_transcript(t["transcript_id"], t["transcript_text"])
        if args.max_chunks:
            chunks = chunks[: args.max_chunks]
        for ch in chunks:
            trabajo.append((t, ch))

    tokens_in = sum(ch["token_count"] for _, ch in trabajo)
    print(f"{len(transcripts)} transcripts · {len(trabajo)} chunks · ~{tokens_in:,} tokens de input")
    print(f"model={args.model} · prompt={AE_PROMPT_VERSION} · region={args.region}")

    if args.dry_run:
        # ~2.3k tokens de system prompt por llamada, cacheados parcialmente por
        # OpenAI pero se cuentan igual. La salida es chica al lado del input.
        total = tokens_in + len(trabajo) * 2300
        precio = PRECIO_INPUT_POR_MTOK.get(args.model)
        print(f"\nDRY RUN — sin llamadas ni escrituras.")
        print(f"  input estimado (con system prompt): ~{total:,} tokens")
        if precio is None:
            print(f"  COSTO ESTIMADO: sin precio conocido para {args.model} — verificar a mano")
        else:
            print(f"  COSTO ESTIMADO ({args.model}): ~USD {total / 1_000_000 * precio:.2f}")
            print(f"  (solo input, al precio de la tabla en este script — verificar el vigente)")
        conn.close()
        return 0

    batch_id = f"ae_{int(time.time())}"
    client = OpenAI(api_key=config.OPENAI_API_KEY)
    system_prompt = build_ae_system_prompt()
    response_format = get_ae_json_schema()
    stats = Counter()

    def llamar(par):
        t, ch = par
        resp = client.chat.completions.create(
            model=args.model,
            temperature=0,
            response_format=response_format,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": build_ae_user_prompt(ch["text"], t["metadata"])},
            ],
        )
        return t, ch, json.loads(resp.choices[0].message.content)

    t0 = time.time()
    hechos = 0
    try:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            futuros = {pool.submit(llamar, par): par for par in trabajo}
            for fut in as_completed(futuros):
                t, ch = futuros[fut]
                hechos += 1
                try:
                    _, _, raw = fut.result()
                except Exception as e:
                    stats["errores_api"] += 1
                    print(f"  [{hechos}/{len(trabajo)}] {t['transcript_id'][:14]}#{ch['chunk_index']} "
                          f"ERROR {type(e).__name__}: {str(e)[:80]}")
                    continue

                rows, s = parse_ae_response(
                    raw, t["transcript_id"], ch["chunk_index"], ch["text"], t["metadata"],
                    model_used=args.model, prompt_version=AE_PROMPT_VERSION,
                    drop_non_literal=not args.keep_non_literal,
                    min_confidence=args.min_confidence,
                )
                for k, v in s.items():
                    stats[k] += v

                # Escritura en el thread principal, una transaccion por chunk:
                # si algo falla, se pierde ese chunk y no el run entero.
                try:
                    for row in rows:
                        terms = row.pop("_terms", [])
                        row["batch_id"] = batch_id
                        cur.execute(INSERT_UNIT, row)
                        got = cur.fetchone()
                        if got is None:
                            # Conflicto: la unidad ya estaba. Sus terminos tambien.
                            stats["ya_existian"] += 1
                            continue
                        unit_id = got[0]
                        stats["insertadas"] += 1
                        for term in terms:
                            cur.execute(INSERT_TERM, {"unit_id": unit_id, **term})
                            stats["terminos"] += 1
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    stats["errores_db"] += 1
                    print(f"  DB error en {t['transcript_id'][:14]}#{ch['chunk_index']}: "
                          f"{type(e).__name__}: {str(e)[:100]}")

                if hechos % 20 == 0 or hechos == len(trabajo):
                    print(f"  [{hechos}/{len(trabajo)}] insertadas={stats['insertadas']} "
                          f"descartadas_no_literal={stats['descartadas_no_literal']} "
                          f"errores={stats['errores_api'] + stats['errores_db']}")
    except KeyboardInterrupt:
        print("\nInterrumpido. Lo insertado queda commiteado; re-corriendo se reanuda.")
    finally:
        cur.close()
        conn.close()

    dur = round(time.time() - t0, 1)
    print(f"\n{'=' * 60}\nRUN {batch_id} ({dur}s)\n{'=' * 60}")
    recibidas = stats["recibidas"] or 1
    for k in ["recibidas", "insertables", "insertadas", "ya_existian", "terminos",
              "descartadas_no_literal", "descartadas_sin_quote",
              "descartadas_tipo_invalido", "descartadas_confianza",
              "atribucion_mismatch", "errores_api", "errores_db"]:
        print(f"  {k:28} {stats[k]}")
    print(f"\n  tasa de descarte por cita no literal: "
          f"{100 * stats['descartadas_no_literal'] / recibidas:.1f}%")
    if stats["descartadas_no_literal"] / recibidas > 0.15:
        print("  ⚠ Descarte alto. El prompt esta parafraseando: revisar antes de seguir.")
    print(f"\n  batch_id para auditar: {batch_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
