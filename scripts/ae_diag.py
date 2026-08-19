"""
Fase 0 del AE Playbook: diagnostico read-only. NO escribe nada, solo SELECT.

Responde las 4 preguntas que dimensionan el resto del proyecto:

  1. Universo: cuantos transcripts hay en el mercado objetivo, cuantos con deal
     matcheado, cuantos con demo "exitosa" (is_validated / Closed Won).
  2. Cobertura de faq_answer: sobre los insights `faq` ya extraidos, en cuantos
     el AE contesto explicitamente. Define si el quick win de FAQs (Fase 0.5)
     alcanza o si hace falta la pasada AE-side.
  3. Distribucion de speaker_role: sospecha previa es que casi todo cae en
     'lead'/'unknown' porque los 6 few-shot de prompt_builder son todos 'lead'.
  4. Fiabilidad de los labels de speaker en raw_transcripts.transcript_text y si
     el nombre del deal_owner aparece como hablante. Este es el riesgo #1: si el
     AE no se puede aislar de forma deterministica, el LLM tiene que inferirlo y
     el error se propaga al pack que despues consume el bot.

Usage:
    source .venv/bin/activate
    python scripts/ae_diag.py                    # HISPAM (default)
    python scripts/ae_diag.py --region Brazil
    python scripts/ae_diag.py --region all
    python scripts/ae_diag.py --sample-speakers 20
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter

# scripts/ no es el root: mismo patron que refresh_mv.py / list_raw_values.py.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src.skills.market_filters import build_region_filter_clause  # noqa: E402

# config y psycopg2 se importan dentro de main(): config.py exige variables de
# entorno al importarse, y asi `--help` funciona sin .env. Mismo patron que
# scripts/list_raw_values.py.

# Los turnos vienen como "Nombre Apellido: texto" o "Nombre (Empresa): texto".
# Mismo criterio laxo que chunker._split_into_turns, pero anclado a inicio de
# linea porque aca queremos contar hablantes, no cortar.
SPEAKER_LINE = re.compile(r"^\s*([A-ZÁÉÍÓÚÑ][^:\n]{1,60}?)\s*:", re.MULTILINE)


def _hr(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def _region_clause(region: str, column: str) -> tuple[str, list]:
    """Devuelve (clausula, params). 'all' -> sin filtro."""
    if region == "all":
        return "TRUE", []
    clause, params = build_region_filter_clause(column, region)
    return (clause or "TRUE"), params


def diag_universe(cur, region: str) -> None:
    _hr(f"1) UNIVERSO — region={region}")

    clause, params = _region_clause(region, "region")
    cur.execute(
        f"""
        SELECT COUNT(DISTINCT transcript_id)                                   AS transcripts,
               COUNT(DISTINCT deal_id)                                         AS deals,
               COUNT(DISTINCT transcript_id) FILTER (WHERE is_validated)       AS transcripts_validated,
               COUNT(DISTINCT deal_id)       FILTER (WHERE is_validated)       AS deals_validated,
               COUNT(DISTINCT transcript_id) FILTER (WHERE deal_stage ILIKE '%%won%%')  AS transcripts_won,
               COUNT(DISTINCT deal_id)       FILTER (WHERE deal_stage ILIKE '%%won%%')  AS deals_won,
               MIN(call_date)                                                  AS desde,
               MAX(call_date)                                                  AS hasta
        FROM mv_insights_norm
        WHERE {clause}
        """,
        params,
    )
    cols = [d[0] for d in cur.description]
    row = dict(zip(cols, cur.fetchone()))
    for k, v in row.items():
        print(f"  {k:24} {v}")

    if row["transcripts_validated"] and row["transcripts"]:
        pct = 100 * row["transcripts_validated"] / row["transcripts"]
        print(f"\n  → {pct:.1f}% de los transcripts son de demos validated.")
    if (row["transcripts_validated"] or 0) < 30:
        print(
            "  ⚠ Menos de 30 transcripts validated: NO filtrar por exito en la\n"
            "    ingesta. Extraer sobre todo el universo y usar is_validated\n"
            "    como peso/filtro en la agregacion."
        )

    print("\n  Etapas presentes (para elegir la definicion de 'exitosa'):")
    cur.execute(
        f"""
        SELECT COALESCE(NULLIF(TRIM(deal_stage), ''), '(vacio)') AS stage,
               COUNT(DISTINCT deal_id) AS deals
        FROM mv_insights_norm
        WHERE {clause}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 15
        """,
        params,
    )
    for stage, deals in cur.fetchall():
        print(f"    {deals:>6}  {stage}")


def diag_faq_coverage(cur, region: str) -> None:
    _hr(f"2) COBERTURA DE faq_answer — region={region}")

    # Join a transcript_insights: la MV no trae `verbatim_quote` ni
    # `insight_subtype`, solo los `*_display`. La MV manda en el FROM porque ya
    # esta recortada a la prompt_version activa (v3.2).
    clause, params = _region_clause(region, "m.region")
    cur.execute(
        f"""
        SELECT COUNT(*)                                                              AS faqs,
               COUNT(*) FILTER (WHERE NULLIF(TRIM(m.faq_answer), '') IS NOT NULL)      AS con_answer,
               COUNT(*) FILTER (WHERE NULLIF(TRIM(i.verbatim_quote), '') IS NOT NULL)  AS con_verbatim,
               ROUND(AVG(LENGTH(m.faq_answer)) FILTER (WHERE m.faq_answer IS NOT NULL)) AS largo_medio_answer,
               COUNT(DISTINCT i.insight_subtype)                                      AS topics
        FROM mv_insights_norm m
        JOIN transcript_insights i ON i.id = m.id
        WHERE m.insight_type = 'faq' AND {clause}
        """,
        params,
    )
    faqs, con_answer, con_verbatim, largo, topics = cur.fetchone()
    print(f"  insights faq             {faqs}")
    print(f"  con faq_answer           {con_answer}"
          f"{f'  ({100 * con_answer / faqs:.1f}%)' if faqs else ''}")
    print(f"  con verbatim_quote       {con_verbatim}"
          f"{f'  ({100 * con_verbatim / faqs:.1f}%)' if faqs else ''}")
    print(f"  largo medio del answer   {largo} chars")
    print(f"  topics distintos         {topics}")

    if faqs and con_answer / faqs < 0.4:
        print(
            "\n  ⚠ Cobertura baja (<40%). El quick win de FAQs sale flaco: la\n"
            "    pasada AE-side (Fase 3) es la que va a traer las respuestas."
        )
    elif faqs:
        print("\n  → Cobertura suficiente para armar ya el primer pack de FAQs.")

    print("\n  Muestra de 10 pares pregunta/respuesta (revisar calidad a ojo):")
    cur.execute(
        f"""
        SELECT i.insight_subtype, i.verbatim_quote, m.faq_answer
        FROM mv_insights_norm m
        JOIN transcript_insights i ON i.id = m.id
        WHERE m.insight_type = 'faq'
          AND NULLIF(TRIM(m.faq_answer), '') IS NOT NULL
          AND {clause}
        ORDER BY m.confidence DESC NULLS LAST
        LIMIT 10
        """,
        params,
    )
    for subtype, q, a in cur.fetchall():
        print(f"\n    [{subtype}]")
        print(f"      Q: {(q or '(sin verbatim)')[:200]}")
        print(f"      A: {(a or '')[:200]}")


def diag_speaker_role(cur, region: str) -> None:
    _hr(f"3) DISTRIBUCION DE speaker_role — region={region}")

    clause, params = _region_clause(region, "region")
    cur.execute(
        f"""
        SELECT insight_type,
               COALESCE(NULLIF(TRIM(speaker_role), ''), '(null)') AS role,
               COUNT(*) AS n
        FROM mv_insights_norm
        WHERE {clause}
        GROUP BY 1, 2 ORDER BY 1, 3 DESC
        """,
        params,
    )
    current = None
    for itype, role, n in cur.fetchall():
        if itype != current:
            print(f"\n  {itype}")
            current = itype
        print(f"    {n:>7}  {role}")

    print(
        "\n  → Si 'ae' es marginal, confirma la hipotesis: el prompt actual no\n"
        "    esta mirando el lado del AE y hace falta extraccion dedicada."
    )


def diag_speaker_labels(cur, region: str, sample: int) -> None:
    _hr(f"4) FIABILIDAD DE LABELS DE SPEAKER — muestra de {sample}")

    clause, params = _region_clause(region, "m.region")
    cur.execute(
        f"""
        SELECT DISTINCT t.recording_id, t.transcript_text, m.deal_owner
        FROM raw_transcripts t
        JOIN mv_insights_norm m ON m.transcript_id = t.recording_id
        WHERE {clause}
        LIMIT %s
        """,
        params + [sample],
    )
    rows = cur.fetchall()
    if not rows:
        print("  Sin transcripts para esa region.")
        return

    con_labels = 0
    owner_matcheado = 0
    detalles = []
    for rid, text, owner in rows:
        speakers = Counter(m.strip() for m in SPEAKER_LINE.findall(text or ""))
        tiene_labels = len(speakers) >= 2
        con_labels += tiene_labels

        match = False
        if owner:
            # Match por nombre de pila o apellido: el transcript suele traer
            # "Salvador" u "Salvador Castro" y HubSpot "Salvador Castro Bay".
            partes = [p.lower() for p in re.split(r"\s+", owner.strip()) if len(p) > 2]
            match = any(
                any(p in sp.lower() for p in partes) for sp in speakers
            )
        owner_matcheado += match
        detalles.append((rid, owner, tiene_labels, match, speakers.most_common(4)))

    n = len(rows)
    print(f"  transcripts con >=2 hablantes etiquetados   {con_labels}/{n}  ({100 * con_labels / n:.0f}%)")
    print(f"  deal_owner encontrado como hablante        {owner_matcheado}/{n}  ({100 * owner_matcheado / n:.0f}%)")

    if owner_matcheado / n >= 0.8:
        print(
            "\n  → VERDE: el AE se puede aislar de forma deterministica por nombre.\n"
            "    La extraccion AE-side recibe SOLO los turnos del AE (mas barato\n"
            "    y sin error de atribucion)."
        )
    elif owner_matcheado / n >= 0.5:
        print(
            "\n  → AMARILLO: match parcial. Aislar por nombre cuando se puede y\n"
            "    caer al LLM en el resto, marcando la unidad con confianza menor."
        )
    else:
        print(
            "\n  → ROJO: no se puede aislar al AE por nombre. El LLM tiene que\n"
            "    inferir el hablante; exigir revision humana antes de publicar\n"
            "    cualquier cosa al bot."
        )

    print("\n  Detalle:")
    for rid, owner, labels, match, top in detalles:
        flag = "ok " if match else "MISS"
        print(f"    [{flag}] {rid[:16]:16} owner={str(owner)[:22]:22} labels={labels} → {[s for s, _ in top]}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Diagnostico read-only para el AE Playbook")
    ap.add_argument("--region", default="HISPAM",
                    help="HISPAM | Brazil | EMEA | ANGLO AMERICA | APAC | MENA | all")
    ap.add_argument("--sample-speakers", type=int, default=15,
                    help="Cuantos transcripts revisar para el chequeo de labels")
    args = ap.parse_args()

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    params = config.get_db_connection_params()
    print(f"Conectando a {params['host']}:{params['port']} (read-only)...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    cur = conn.cursor()
    try:
        # READ ONLY primero: SET TRANSACTION solo aplica si es lo primero de la
        # transaccion. Despues el timeout (SET si esta permitido en read-only).
        cur.execute("SET TRANSACTION READ ONLY;")
        cur.execute("SET statement_timeout = '120s';")
        diag_universe(cur, args.region)
        diag_faq_coverage(cur, args.region)
        diag_speaker_role(cur, args.region)
        diag_speaker_labels(cur, args.region, args.sample_speakers)
    finally:
        conn.close()

    print("\nListo. Con estos numeros se decide: definicion de exito, si el quick")
    print("win de FAQs alcanza, y si el AE se aisla por nombre o lo infiere el LLM.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
