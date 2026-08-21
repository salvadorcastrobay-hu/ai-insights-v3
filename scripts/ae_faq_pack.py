"""
Fase 0.5 del AE Playbook: pack de FAQs con los datos que YA estan extraidos.
Read-only sobre la DB — solo escribe archivos en artifacts/.

No necesita la pasada AE-side: los insights `faq` ya traen la pregunta textual del
lead en `verbatim_quote` y, cuando el AE la contesto explicito, la respuesta en
`faq_answer`. Lo que falta es canonicalizar: hoy el dashboard agrupa por topic de
taxonomia y por `summary`, y por eso solo se ven "temas generales" en vez de
preguntas concretas con sus respuestas.

Sirve para validar el FORMATO del entregable con Sales antes de gastar en la
extraccion AE-side completa.

Como agrupa: embeddings (text-embedding-3-large, igual que embed_transcripts.py)
dentro de cada topic de la taxonomia. Dentro del topic porque el topic ya es una
particion buena y barata, y limita que se mezclen preguntas de precio con las de
seguridad por parecido superficial.

Usage:
    source .venv/bin/activate
    python scripts/ae_faq_pack.py                          # HISPAM, todas las demos
    python scripts/ae_faq_pack.py --only-success           # solo demos que cerraron (won)
    python scripts/ae_faq_pack.py --min-cluster 3 --synthesize
    python scripts/ae_faq_pack.py --no-embeddings          # fallback lexico, sin costo
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src.skills.ae_aggregation import SUCCESS_METRIC_DEFAULT, success_predicate  # noqa: E402
from src.skills.faq_clustering import (  # noqa: E402
    cluster_by_tokens,
    cluster_by_vectors,
    looks_like_question,
)
from src.skills.market_filters import build_region_filter_clause  # noqa: E402
from taxonomy import FAQ_SUBTYPES  # noqa: E402

# config y psycopg2 se importan dentro de main(): config.py exige variables de
# entorno al importarse, y asi `--help` funciona sin .env.

ARTIFACTS = os.path.join(ROOT, "artifacts")
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 2000
EMBED_BATCH = 100
SYNTH_MODEL = "gpt-4o"

INSERT_FAQ = """
INSERT INTO ae_faq_canonical (
    topic, question_canonical, question_variants, ae_answers, answer_recommended,
    has_conflict, demos, demos_success, unanswered, markets, success_metric, human_status
) VALUES (
    %(topic)s, %(question_canonical)s, %(question_variants)s, %(ae_answers)s,
    %(answer_recommended)s, %(has_conflict)s, %(demos)s, %(demos_success)s,
    %(unanswered)s, %(markets)s, %(success_metric)s, 'pending'
);
"""


def fetch_faqs(cur, region: str, only_success: bool, success: str, since: str | None) -> list[dict]:
    """FAQs con la pregunta textual del lead.

    Join MV + transcript_insights porque la MV solo trae los `*_display` y no
    `verbatim_quote` ni `insight_subtype`. La MV aporta region/country ya
    normalizados, `is_validated`, y el recorte a la prompt_version activa (v3.2),
    asi que arrancar por ella evita contar versiones viejas del prompt.
    """
    clauses = ["m.insight_type = 'faq'", "NULLIF(TRIM(i.verbatim_quote), '') IS NOT NULL"]
    params: list = []
    if region != "all":
        rc, rp = build_region_filter_clause("m.region", region)
        if rc:
            clauses.append(rc)
            params.extend(rp)
    if only_success:
        # El filtro se hace en SQL para no traer 39k filas y descartarlas en Python.
        clauses.append("m.is_validated = true" if success == "validated"
                       else "m.deal_stage ILIKE '%%won%%'")
    if since:
        clauses.append("m.call_date >= %s")
        params.append(since)

    cur.execute(
        f"""
        SELECT i.insight_subtype, i.verbatim_quote, m.faq_answer, i.summary,
               m.company_name, m.country, m.segment, m.deal_owner, m.deal_stage,
               m.is_validated, m.transcript_id, m.confidence
        FROM mv_insights_norm m
        JOIN transcript_insights i ON i.id = m.id
        WHERE {' AND '.join(clauses)}
        ORDER BY m.call_date DESC NULLS LAST
        """,
        params,
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def embed(texts: list[str]) -> list[list[float]]:
    import config
    from openai import OpenAI

    client = OpenAI(api_key=config.OPENAI_API_KEY)
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i:i + EMBED_BATCH]
        resp = client.embeddings.create(
            model=EMBEDDING_MODEL, dimensions=EMBEDDING_DIMENSIONS, input=batch
        )
        out.extend(d.embedding for d in resp.data)
        print(f"  embeddings {min(i + EMBED_BATCH, len(texts))}/{len(texts)}")
    return out


def redact(text: str | None, company: str | None) -> str:
    """Saca el nombre de la empresa de la cita.

    El pack lo va a consumir un bot que le habla a leads: no puede filtrarse el
    nombre de otro cliente. Se saca por reemplazo directo, no se confia en el LLM.
    """
    s = text or ""
    if company and len(company) > 3:
        s = re.sub(re.escape(company), "[cliente]", s, flags=re.IGNORECASE)
    return s.strip()


def synthesize_answer(client, topic: str, question: str, answers: list[str]) -> str:
    """Una respuesta recomendada a partir de como contestaron los AEs.

    Explicitamente NO se le permite agregar informacion: solo consolidar. Si los
    AEs se contradicen, tiene que decirlo en vez de elegir.
    """
    resp = client.chat.completions.create(
        model=SYNTH_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content":
             "Sos analista de sales enablement en Humand. Te doy una pregunta frecuente de "
             "prospectos y como la contestaron distintos AEs en llamadas reales. Escribi UNA "
             "respuesta recomendada, en español rioplatense neutro, de 2 a 4 oraciones, apta "
             "para que la use un bot de WhatsApp que califica leads.\n"
             "Reglas estrictas:\n"
             "- Solo podes usar informacion que aparezca en las respuestas de los AEs.\n"
             "- Prohibido inventar precios, plazos, features, integraciones o numeros.\n"
             "- Si los AEs se contradicen en algo, no elijas: escribi la parte en la que "
             "coinciden y agrega al final 'REVISAR: los AEs responden distinto sobre X'.\n"
             "- Si las respuestas no alcanzan para responder, devolve exactamente "
             "'INSUFICIENTE'."},
            {"role": "user", "content":
             f"Topic: {topic}\nPregunta: {question}\n\nRespuestas de AEs:\n" +
             "\n".join(f"- {a}" for a in answers[:8])},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="Pack de FAQs desde los insights ya extraidos")
    ap.add_argument("--region", default="HISPAM")
    ap.add_argument("--success", default=SUCCESS_METRIC_DEFAULT, choices=["won", "validated"],
                    help="Que cuenta como demo exitosa. Default 'won': is_validated cubre el "
                         "78.9%% de HISPAM, es higiene y no exito (ver ae_aggregation)")
    ap.add_argument("--only-success", action="store_true",
                    help="Quedarse solo con las demos exitosas segun --success")
    ap.add_argument("--since", default=None, help="YYYY-MM-DD: acotar por fecha de llamada")
    ap.add_argument("--min-cluster", type=int, default=2,
                    help="Minimo de apariciones para que una pregunta entre al pack")
    ap.add_argument("--no-embeddings", action="store_true",
                    help="Agrupar con Jaccard en vez de embeddings (gratis, peor)")
    ap.add_argument("--synthesize", action="store_true",
                    help="Generar una respuesta recomendada por pregunta con gpt-4o")
    ap.add_argument("--write-db", action="store_true",
                    help="Guardar en ae_faq_canonical con human_status='pending' para revision")
    args = ap.parse_args()

    os.makedirs(ARTIFACTS, exist_ok=True)

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    params = config.get_db_connection_params()
    conn = psycopg2.connect(**params, connect_timeout=15)
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY;")
    cur.execute("SET statement_timeout = '120s';")
    faqs = fetch_faqs(cur, args.region, args.only_success, args.success, args.since)
    conn.close()
    # Conexion aparte para la escritura: la de lectura se cierra antes de los
    # embeddings, que tardan minutos y dejarian la transaccion abierta al vicio.
    conn2 = psycopg2.connect(**params, connect_timeout=15) if args.write_db else None

    if not faqs:
        print("Sin FAQs para esos filtros.", file=sys.stderr)
        return 1

    # El prompt v3.2 guardo en verbatim_quote tanto preguntas del lead como
    # afirmaciones del AE. Sin filtrar, el pack lista respuestas bajo "como la
    # preguntan" y el clustering agrupa preguntas con respuestas.
    antes = len(faqs)
    faqs = [f for f in faqs if looks_like_question(f["verbatim_quote"])]
    descartadas = antes - len(faqs)
    if descartadas:
        print(f"{descartadas} de {antes} verbatims no parecen preguntas "
              f"({100 * descartadas / antes:.0f}%) — descartados")
    if not faqs:
        print("Ninguna pregunta quedo despues del filtro.", file=sys.stderr)
        return 1

    con_answer = sum(1 for f in faqs if (f.get("faq_answer") or "").strip())
    demos = len({f["transcript_id"] for f in faqs})
    print(f"{len(faqs)} preguntas | {demos} demos | {con_answer} con respuesta del AE "
          f"({100 * con_answer / len(faqs):.0f}%)")

    # Agrupar dentro de cada topic de la taxonomia.
    por_topic: dict[str, list[dict]] = {}
    for f in faqs:
        f["question"] = f["verbatim_quote"]
        por_topic.setdefault(f["insight_subtype"] or "(sin topic)", []).append(f)

    if not args.no_embeddings:
        print("Generando embeddings de las preguntas...")
        todos = [f["question"] for f in faqs]
        vecs = embed(todos)
        by_q = {id(f): v for f, v in zip(faqs, vecs)}

    es_exito = success_predicate(args.success)
    packs = []
    for topic, items in sorted(por_topic.items(), key=lambda kv: -len(kv[1])):
        if args.no_embeddings:
            clusters = cluster_by_tokens(items)
        else:
            clusters = cluster_by_vectors(items, [by_q[id(i)] for i in items])
        for c in clusters:
            if c["size"] < args.min_cluster:
                continue
            miembros = c["items"]
            answers = [redact(m.get("faq_answer"), m.get("company_name"))
                       for m in miembros if (m.get("faq_answer") or "").strip()]
            packs.append({
                "topic": topic,
                "topic_display": FAQ_SUBTYPES.get(topic, {}).get("display_name") or topic,
                "question": c["canonical"],
                "variants": c["variants"][:6],
                "demos": len({m["transcript_id"] for m in miembros}),
                "veces": c["size"],
                "en_demos_exitosas": len({m["transcript_id"] for m in miembros if es_exito(m)}),
                "answers": answers[:5],
                "sin_respuesta": c["size"] - len(answers),
                "coherence": c.get("coherence"),
                "threshold": c.get("threshold"),
                "split_from_blob": c.get("split_from_blob", False),
                "paises": sorted({m["country"] for m in miembros if m.get("country")}),
                "aes": sorted({m["deal_owner"] for m in miembros if m.get("deal_owner")}),
            })

    packs.sort(key=lambda p: (-p["demos"], -p["veces"]))
    print(f"\n{len(packs)} preguntas canonicas con >= {args.min_cluster} apariciones")
    pozos = [p for p in packs if p.get("coherence") is not None and p["coherence"] < 0.6]
    if pozos:
        print(f"  ⚠ {len(pozos)} con coherencia < 0.6: son mezclas, no temas. "
              f"Revisar antes de mostrarlas.")
    mayor = max((p["demos"] for p in packs), default=0)
    if demos and mayor / demos > 0.25:
        print(f"  ⚠ La pregunta mas grande cubre {100 * mayor / demos:.0f}% de las demos "
              f"— sigue siendo un pozo.")

    if args.synthesize:
        from openai import OpenAI
        client = OpenAI(api_key=config.OPENAI_API_KEY)  # noqa: F821 — importado arriba en main
        print(f"Sintetizando respuestas recomendadas con {SYNTH_MODEL}...")
        for i, p in enumerate(packs, 1):
            if not p["answers"]:
                p["respuesta_recomendada"] = "SIN DATOS — ningun AE la contesto explicito"
                continue
            try:
                p["respuesta_recomendada"] = synthesize_answer(
                    client, p["topic_display"], p["question"], p["answers"])
            except Exception as e:
                p["respuesta_recomendada"] = f"ERROR: {type(e).__name__}"
            if i % 10 == 0:
                print(f"  {i}/{len(packs)}")

    if args.write_db:
        # Se reemplazan solo los pending: el clustering puede reagrupar entre
        # corridas y no hay contraparte estable, pero lo que ya reviso una persona
        # no se pierde por un recalculo.
        try:
            cur2 = conn2.cursor()
            cur2.execute("DELETE FROM ae_faq_canonical WHERE human_status = 'pending';")
            for p in packs:
                cur2.execute(INSERT_FAQ, {
                    "topic": p["topic"],
                    "question_canonical": p["question"],
                    "question_variants": p["variants"],
                    "ae_answers": p["answers"],
                    "answer_recommended": p.get("respuesta_recomendada"),
                    # La sintesis marca REVISAR cuando los AEs se contradicen. Eso
                    # tiene que viajar como flag y no solo como texto: es lo que
                    # frena una respuesta contradictoria antes de llegar al bot.
                    "has_conflict": "REVISAR" in (p.get("respuesta_recomendada") or ""),
                    "demos": p["demos"],
                    "demos_success": p["en_demos_exitosas"],
                    "unanswered": p["sin_respuesta"],
                    "markets": p["paises"],
                    "success_metric": args.success,
                })
            conn2.commit()
            print(f"  guardadas {len(packs)} preguntas en ae_faq_canonical (pending)")
        except Exception as e:
            conn2.rollback()
            print(f"  ERROR al guardar, rollback: {type(e).__name__}: {e}", file=sys.stderr)
        finally:
            conn2.close()

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    suf = f"_{args.success}" if args.only_success else ""
    json_path = os.path.join(ARTIFACTS, f"faq_pack_{args.region.lower().replace(' ', '')}{suf}_{ts}.json")
    md_path = json_path.replace(".json", ".md")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "region": args.region, "only_success": args.only_success,
            "success_metric": args.success, "since": args.since,
            "preguntas_totales": len(faqs), "demos": demos,
            "cobertura_respuesta": round(100 * con_answer / len(faqs), 1),
            "agrupado": "tokens" if args.no_embeddings else EMBEDDING_MODEL,
            "packs": packs,
        }, f, ensure_ascii=False, indent=2)

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# FAQs de demos — {args.region}"
                f"{f' (solo demos exitosas por {args.success})' if args.only_success else ''}\n\n")
        f.write(f"{len(faqs)} preguntas en {demos} demos · {100 * con_answer / len(faqs):.0f}% "
                f"con respuesta del AE · {len(packs)} preguntas canonicas\n\n")
        f.write("> Borrador generado automaticamente. Las respuestas son citas de AEs en "
                "llamadas reales, sin validar por producto.\n")
        actual = None
        for p in packs:
            if p["topic"] != actual:
                f.write(f"\n---\n\n## {p['topic_display']}\n")
                actual = p["topic"]
            f.write(f"\n### {p['question']}\n\n")
            coh = p.get("coherence")
            f.write(f"`{p['demos']} demos` · `{p['veces']} veces`"
                    f"{f' · coherencia {coh}' if coh is not None else ''}"
                    f" · `{p['en_demos_exitosas']} en demos exitosas ({args.success})`"
                    f"{' · ' + ', '.join(p['paises']) if p['paises'] else ''}\n\n")
            if p.get("respuesta_recomendada"):
                f.write(f"**Respuesta recomendada:** {p['respuesta_recomendada']}\n\n")
            if p["variants"][1:]:
                f.write("Como la preguntan:\n" + "".join(f"- _{v}_\n" for v in p["variants"][1:]) + "\n")
            if p["answers"]:
                f.write("Como la contestaron los AEs:\n")
                for a in p["answers"]:
                    f.write(f"- {a}\n")
            else:
                f.write("_Ningun AE la contesto explicito en los transcripts._\n")
            if p["sin_respuesta"]:
                f.write(f"\n<sub>{p['sin_respuesta']} apariciones quedaron sin respuesta registrada.</sub>\n")

    print(f"\n  crudo:    {json_path}")
    print(f"  legible:  {md_path}   ← esto es lo que se le manda a Dana para validar formato")
    return 0


if __name__ == "__main__":
    sys.exit(main())
