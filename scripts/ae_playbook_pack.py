"""
Fase 4/5 del AE Playbook: glosario + formas de explicar, desde ae_speech_units.

Estos son los dos entregables que Marketing pidio primero y que el pipeline
lead-side no podia dar: "un glosario con terminos frecuentes y un resumen de
formas de explicar lo que hace Humand. No quiero citas sueltas."

Ese "no quiero citas sueltas" es el requisito de diseño: la salida son patrones
agrupados con su frecuencia y su lift de exito, cada uno respaldado por 2-3 citas
textuales verificadas — no un listado de quotes.

Read-only por default; escribe en artifacts/. Con --write-db upsertea en
ae_glossary_terms / ae_pitch_patterns con human_status='pending', que es lo que
despues revisa una persona antes de que el bot lo consuma.

Usage:
    source .venv/bin/activate
    python scripts/ae_playbook_pack.py --region HISPAM
    python scripts/ae_playbook_pack.py --region HISPAM --label     # redacta con gpt-4o
    python scripts/ae_playbook_pack.py --region HISPAM --label --write-db
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ae_prompt_builder import AE_PROMPT_VERSION  # noqa: E402
from src.skills.ae_aggregation import (  # noqa: E402
    SUCCESS_METRIC_DEFAULT,
    build_glossary,
    build_pitch_patterns,
    dataset_baseline,
)
from src.skills.faq_clustering import cluster_by_vectors  # noqa: E402
from src.skills.market_filters import build_region_filter_clause  # noqa: E402
from taxonomy import MODULES  # noqa: E402

ARTIFACTS = os.path.join(ROOT, "artifacts")
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 2000
EMBED_BATCH = 100
LABEL_MODEL = "gpt-4o"
PITCH_TYPES = ("pitch_company", "pitch_module", "objection_handling", "proof_point")


def fetch_units(cur, region: str, version: str, only_literal: bool) -> list[dict]:
    """Unidades de discurso del AE del recorte."""
    clauses = ["ae_prompt_version = %s"]
    params: list = [version]
    if region != "all":
        rc, rp = build_region_filter_clause("region", region)
        if rc:
            clauses.append(rc)
            params.extend(rp)
    if only_literal:
        # Solo citas verificadas: una cita que el AE nunca dijo no puede entrar a
        # un playbook ni, mucho menos, a la base de un bot.
        clauses.append("is_literal = true")

    cur.execute(
        f"""
        SELECT id, transcript_id, unit_type, module, verbatim_quote, paraphrase,
               trigger_quote, confidence, attribution, company_name, country,
               deal_owner, deal_stage, is_validated
        FROM ae_speech_units
        WHERE {' AND '.join(clauses)}
        ORDER BY call_date DESC NULLS LAST
        """,
        params,
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def fetch_terms(cur, region: str, version: str) -> list[dict]:
    """Usos de terminos, con la metadata de la unidad que los produjo."""
    clauses = ["u.ae_prompt_version = %s"]
    params: list = [version]
    if region != "all":
        rc, rp = build_region_filter_clause("u.region", region)
        if rc:
            clauses.append(rc)
            params.extend(rp)

    cur.execute(
        f"""
        SELECT t.term, t.term_norm, t.gloss, t.module,
               u.transcript_id, u.country, u.verbatim_quote, u.deal_stage, u.is_validated
        FROM ae_term_usages t
        JOIN ae_speech_units u ON u.id = t.unit_id
        WHERE {' AND '.join(clauses)}
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
        resp = client.embeddings.create(
            model=EMBEDDING_MODEL, dimensions=EMBEDDING_DIMENSIONS,
            input=texts[i:i + EMBED_BATCH],
        )
        out.extend(d.embedding for d in resp.data)
    return out


def label_pattern(client, pattern: dict) -> dict:
    """Le pone nombre y descripcion a un cluster de formas de explicar.

    Este es el paso que convierte un cluster en el "resumen de formas de explicar"
    que pidio Marketing. El prompt tiene prohibido agregar informacion: solo puede
    describir el patron que ya esta en las citas.
    """
    citas = "\n".join(f"- {q}" for q in pattern["example_quotes"][:5])
    resp = client.chat.completions.create(
        model=LABEL_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content":
             "Sos analista de sales enablement en Humand. Te doy citas textuales de AEs "
             "que el sistema agrupo como una misma forma de explicar algo. Devolve JSON con:\n"
             '  "label": nombre corto del patron, max 8 palabras\n'
             '  "description": que dice esta forma de explicar, 1-2 oraciones\n'
             '  "when_to_use": en que momento de la conversacion aparece, 1 oracion\n'
             "Reglas: solo podes usar lo que esta en las citas. Prohibido agregar features, "
             "precios o beneficios que no aparezcan. Si las citas no tienen nada en comun, "
             'devolve label "MEZCLADO" y explicalo en description. Español rioplatense neutro.'},
            {"role": "user", "content":
             f"unit_type: {pattern['unit_type']}\nmodulo: {pattern['module']}\n\nCitas:\n{citas}"},
        ],
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(resp.choices[0].message.content or "{}")
    except json.JSONDecodeError:
        return {}
    return {k: data.get(k) for k in ("label", "description", "when_to_use") if data.get(k)}


UPSERT_GLOSSARY = """
INSERT INTO ae_glossary_terms (
    term_canonical, term_norm, aliases, module, definition, example_quote,
    usages, demos, demos_success, markets, success_metric, human_status
) VALUES (
    %(term_canonical)s, %(term_norm)s, %(aliases)s, %(module)s, %(definition)s,
    %(example_quote)s, %(usages)s, %(demos)s, %(demos_success)s, %(markets)s,
    %(success_metric)s, 'pending'
)
ON CONFLICT (term_norm) DO UPDATE SET
    term_canonical = EXCLUDED.term_canonical,
    aliases = EXCLUDED.aliases,
    module = EXCLUDED.module,
    definition = EXCLUDED.definition,
    example_quote = EXCLUDED.example_quote,
    usages = EXCLUDED.usages,
    demos = EXCLUDED.demos,
    demos_success = EXCLUDED.demos_success,
    markets = EXCLUDED.markets,
    success_metric = EXCLUDED.success_metric,
    generated_at = now()
-- No se toca human_status: si una persona ya aprobo o edito este termino, un
-- recalculo no puede devolverlo a 'pending' y sacarlo del pack del bot.
;
"""

INSERT_PITCH = """
INSERT INTO ae_pitch_patterns (
    unit_type, module, label, description, when_to_use, example_quotes,
    unit_ids, demos, demos_success, success_lift, markets, success_metric, human_status
) VALUES (
    %(unit_type)s, %(module)s, %(label)s, %(description)s, %(when_to_use)s,
    %(example_quotes)s, %(unit_ids)s::uuid[], %(demos)s, %(demos_success)s,
    %(success_lift)s, %(markets)s, %(success_metric)s, 'pending'
);
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="Glosario y formas de explicar desde ae_speech_units")
    ap.add_argument("--region", default="HISPAM")
    ap.add_argument("--version", default=AE_PROMPT_VERSION)
    ap.add_argument("--success", default=SUCCESS_METRIC_DEFAULT, choices=["won", "validated"])
    ap.add_argument("--min-demos", type=int, default=3,
                    help="Minimo de demos distintas para entrar al pack")
    ap.add_argument("--threshold", type=float, default=None,
                    help="Umbral de cosine fijo. Por default no se fija ninguno y se "
                         "busca automaticamente el que evite pozos (ver faq_clustering). "
                         "Fijarlo desactiva esa busqueda")
    ap.add_argument("--keep-non-literal", action="store_true",
                    help="Incluir unidades cuya cita no se verifico como literal")
    ap.add_argument("--label", action="store_true",
                    help=f"Redactar nombre y descripcion de cada patron con {LABEL_MODEL}")
    ap.add_argument("--write-db", action="store_true",
                    help="Upsertear en ae_glossary_terms / ae_pitch_patterns (human_status='pending')")
    args = ap.parse_args()

    os.makedirs(ARTIFACTS, exist_ok=True)

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    params = config.get_db_connection_params()
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '180s';")

    units = fetch_units(cur, args.region, args.version, not args.keep_non_literal)
    terms = fetch_terms(cur, args.region, args.version)

    if not units:
        print(f"Sin unidades para region={args.region} version={args.version}. "
              f"Corriste scripts/ae_extract_run.py?", file=sys.stderr)
        conn.close()
        return 1

    # La tasa base sale de TODAS las unidades del recorte, no de las que entran a
    # cada patron: calcularla por patron daria 1.0 siempre.
    baseline = dataset_baseline(units, args.success)
    demos_total, demos_exito = baseline
    tasa = 100 * demos_exito / demos_total if demos_total else 0
    print(f"{len(units)} unidades · {len(terms)} usos de terminos · "
          f"{demos_total} demos ({demos_exito} exitosas por {args.success}, {tasa:.1f}%)")
    if demos_exito < 10:
        print(f"  ⚠ Solo {demos_exito} demos exitosas: el success_lift va a ser ruido. "
              f"Leerlo como indicativo, no como conclusion.")

    print("\n=== GLOSARIO ===")
    glosario = build_glossary(terms, baseline=baseline,
                             min_demos=args.min_demos, metric=args.success)
    print(f"{len(glosario)} terminos con >= {args.min_demos} demos "
          f"(de {len({t['term_norm'] for t in terms})} distintos)")
    ambiguos = sum(1 for t in glosario if t.get("ambiguous"))
    if ambiguos:
        print(f"  {ambiguos} terminos con definiciones en conflicto (marcados ⚠ en el md)")
    for t in glosario[:15]:
        lift = f"lift {t['success_lift']}" if t["success_lift"] else "sin lift"
        print(f"  {t['demos']:>3} demos · {lift:12} · {t['term_canonical']}"
              f"{'  [' + ', '.join(t['aliases'][:3]) + ']' if t['aliases'] else ''}"
              f"{'  ⚠ ambiguo' if t.get('ambiguous') else ''}")

    print("\n=== FORMAS DE EXPLICAR ===")
    pitch_units = [u for u in units if u["unit_type"] in PITCH_TYPES]
    print(f"{len(pitch_units)} unidades de pitch/objecion/prueba — generando embeddings...")

    # Se embeddea la paraphrase y no el verbatim: el verbatim trae muletillas y
    # nombres propios que empujan el clustering hacia el ruido superficial en vez
    # de hacia la idea que se esta explicando.
    textos = [(u["paraphrase"] or u["verbatim_quote"] or "") for u in pitch_units]
    vecs = embed(textos)
    for u, t in zip(pitch_units, textos):
        u["cluster_text"] = t

    clusters = cluster_by_vectors(pitch_units, vecs, text_key="cluster_text",
                                  threshold=args.threshold)
    patrones = build_pitch_patterns(clusters, baseline, min_demos=args.min_demos,
                                    metric=args.success)
    umbral_usado = clusters[0].get("threshold") if clusters else None
    partidos = sum(1 for c in clusters if c.get("split_from_blob"))
    pozos = sum(1 for c in clusters if c.get("blob_warning"))
    print(f"{len(clusters)} clusters (umbral {umbral_usado}) → {len(patrones)} patrones "
          f"con >= {args.min_demos} demos")
    if partidos:
        print(f"  {partidos} salieron de partir un pozo por k-means: sus fronteras son "
              f"convencionales, dos vecinos pueden ser el mismo discurso")
    if pozos:
        print(f"  ⚠ {pozos} clusters quedaron como pozo sin poder partirse — no confiar en ellos")

    if args.label and patrones:
        from openai import OpenAI
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        print(f"Redactando con {LABEL_MODEL}...")
        for i, p in enumerate(patrones, 1):
            p.update(label_pattern(client, p))
            if i % 5 == 0:
                print(f"  {i}/{len(patrones)}")

    cajones = [p for p in patrones if p.get("catch_all")]
    if cajones:
        print(f"  ⚠ {len(cajones)} patron(es) cubren mas del 25% de las demos: son "
              f"cajones de sastre, no patrones distinguibles")
    for p in patrones[:15]:
        lift = f"lift {p['success_lift']}" if p["success_lift"] else "sin lift"
        mod = f" [{p['module']}]" if p["module"] else ""
        marca = "  ⚠ cajon de sastre" if p.get("catch_all") else ""
        print(f"  {p['demos']:>3} demos · {lift:12} · {p['unit_type']}{mod}: {p['label'][:70]}{marca}")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = f"playbook_{args.region.lower().replace(' ', '')}_{ts}"
    json_path = os.path.join(ARTIFACTS, base_name + ".json")
    md_path = os.path.join(ARTIFACTS, base_name + ".md")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "region": args.region, "version": args.version,
            "success_metric": args.success,
            "threshold": args.threshold, "threshold_usado": umbral_usado,
            "min_demos": args.min_demos,
            "demos_total": demos_total, "demos_success": demos_exito,
            "glosario": glosario, "patrones": patrones,
        }, f, ensure_ascii=False, indent=2, default=str)

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# Playbook de AEs — {args.region}\n\n")
        f.write(f"{len(units)} intervenciones de AEs en {demos_total} demos "
                f"({demos_exito} cerradas). Citas verificadas como textuales"
                f"{' (incluye no verificadas)' if args.keep_non_literal else ''}.\n\n")
        f.write("> Borrador automatico. `lift` = cuanto mas se usa en demos que cerraron "
                f"que en el resto (1.0 = igual). Mide co-ocurrencia, no causa. "
                f"Metrica de exito: {args.success}.\n")

        f.write("\n---\n\n## Glosario — como nombra Sales las cosas\n\n")
        if ambiguos:
            f.write(f"\n⚠ {ambiguos} terminos aparecen con definiciones en conflicto segun el "
                    f"contexto. Estan marcados y necesitan que una persona elija — la "
                    f"definicion que figura es la mas repetida, no la correcta.\n\n")
        f.write("| Termino | Como lo usan | Tambien le dicen | Demos | Lift |\n")
        f.write("|---|---|---|---|---|\n")
        for t in glosario:
            alias = ", ".join(t["aliases"][:4]) or "—"
            marca = " ⚠" if t.get("ambiguous") else ""
            f.write(f"| **{t['term_canonical']}**{marca} | {(t['definition'] or '—')} | {alias} "
                    f"| {t['demos']} | {t['success_lift'] or '—'} |\n")
        for t in glosario:
            if t.get("other_glosses"):
                f.write(f"\n**{t['term_canonical']}** tambien se usa como: "
                        + "; ".join(t["other_glosses"]) + "\n")

        f.write("\n---\n\n## Formas de explicar\n\n")
        actual = None
        for p in patrones:
            if p["unit_type"] != actual:
                titulos = {
                    "pitch_company": "Que es Humand",
                    "pitch_module": "Como se explica cada modulo",
                    "objection_handling": "Como se responden las objeciones",
                    "proof_point": "Que se usa como prueba",
                }
                f.write(f"\n### {titulos.get(p['unit_type'], p['unit_type'])}\n")
                actual = p["unit_type"]
            mod = MODULES.get(p["module"], {}).get("display_name") if p["module"] else None
            f.write(f"\n#### {p['label']}\n\n")
            coh = p.get("coherence")
            f.write(f"`{p['demos']} demos` · `{p['demos_success']} cerradas` · "
                    f"`lift {p['success_lift'] or '—'}`"
                    f"{f' · coherencia {coh}' if coh is not None else ''}"
                    f"{' · *frontera convencional*' if p.get('split_from_blob') else ''}"
                    f"{f' · modulo: {mod}' if mod else ''}"
                    f"{' · ' + ', '.join(p['markets'][:4]) if p['markets'] else ''}\n\n")
            if p.get("catch_all"):
                f.write("⚠ **Cubre mas de un cuarto de las demos.** Probablemente sea "
                        "un cajon de sastre que agrupa varias formas de explicar, no un "
                        "patron unico. Leer las citas antes de usarlo.\n\n")
            if p.get("description"):
                f.write(f"{p['description']}\n\n")
            if p.get("when_to_use"):
                f.write(f"*Cuando aparece:* {p['when_to_use']}\n\n")
            for q in p["example_quotes"]:
                f.write(f"> {q}\n\n")

    if args.write_db:
        print("\nEscribiendo en la DB (human_status='pending')...")
        try:
            for t in glosario:
                cur.execute(UPSERT_GLOSSARY, {**t, "success_metric": args.success})
            # Los patrones se reemplazan enteros: el clustering puede reagrupar y
            # un patron de una corrida anterior no tiene contraparte estable en la
            # nueva. Se borran solo los pending — los revisados por una persona
            # sobreviven al recalculo.
            cur.execute("DELETE FROM ae_pitch_patterns WHERE human_status = 'pending';")
            for p in patrones:
                cur.execute(INSERT_PITCH, {
                    **{k: p.get(k) for k in ("unit_type", "module", "label", "description",
                                             "when_to_use", "demos", "demos_success",
                                             "success_lift")},
                    "example_quotes": p["example_quotes"],
                    "unit_ids": [str(u) for u in p["unit_ids"]],
                    "markets": p["markets"],
                    "success_metric": args.success,
                })
            conn.commit()
            print(f"  {len(glosario)} terminos, {len(patrones)} patrones")
        except Exception as e:
            conn.rollback()
            print(f"  ERROR, rollback: {type(e).__name__}: {e}", file=sys.stderr)

    conn.close()
    print(f"\n  crudo:    {json_path}")
    print(f"  legible:  {md_path}   ← esto es lo que va a Marketing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
