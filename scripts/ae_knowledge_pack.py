"""
Fase 5 del AE Playbook: el pack que consume el bot de WhatsApp.

Distinto del playbook para humanos: aca el limite es el presupuesto de tokens del
system prompt del bot, no la completitud. Salen los items de mas cobertura, en
texto compacto, sin metricas ni citas de contexto — al bot no le sirve saber que un
patron tiene lift 1.46, le sirve saber que decir.

Sirve SOLO `approved` y `edited` por default. `pending` requiere --incluir-pending y
sale con una advertencia: son textos que ningun humano valido, y el consumidor le
habla a leads reales.

Usage:
    source .venv/bin/activate
    python scripts/ae_knowledge_pack.py                      # solo aprobado
    python scripts/ae_knowledge_pack.py --incluir-pending    # borrador, para probar
    python scripts/ae_knowledge_pack.py --formato json
    python scripts/ae_knowledge_pack.py --presupuesto 3000
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

ARTIFACTS = os.path.join(ROOT, "artifacts")

# Presupuesto por defecto en tokens. Un system prompt de bot que ademas tiene sus
# instrucciones de calificacion no puede llevarse 20k tokens de contexto.
PRESUPUESTO_DEFAULT = 4000
# Aproximacion de tokens por caracter en español. Alcanza para un presupuesto:
# el conteo exacto necesitaria tiktoken y el error de +-10% no cambia decisiones.
CHARS_POR_TOKEN = 3.6

ESTADOS_PUBLICABLES = ("approved", "edited")


def fetch(cur, tabla: str, cols: str, estados: tuple[str, ...], orden: str) -> list[dict]:
    cur.execute(
        f"SELECT {cols} FROM {tabla} WHERE human_status = ANY(%s) ORDER BY {orden}",
        [list(estados)],
    )
    nombres = [d[0] for d in cur.description]
    return [dict(zip(nombres, r)) for r in cur.fetchall()]


def armar_markdown(glosario, patrones, faqs, presupuesto: int) -> tuple[str, dict]:
    """Arma el pack recortando por presupuesto, no truncando al final.

    Se reparte el presupuesto entre las tres secciones y se cortan los items menos
    frecuentes de cada una. Truncar el texto final dejaria una seccion completa
    afuera y la otra a mitad de una oracion.
    """
    cupos = {"glosario": 0.30, "pitch": 0.40, "faq": 0.30}
    stats = {}
    partes = []

    def cabe(bloques: list[str], limite_tokens: float) -> list[str]:
        limite_chars = limite_tokens * CHARS_POR_TOKEN
        usado, salida = 0, []
        for b in bloques:
            if usado + len(b) > limite_chars:
                break
            salida.append(b)
            usado += len(b)
        return salida

    # Glosario: termino → definicion en una linea. Los alias importan porque el
    # lead puede escribir cualquiera de las variantes.
    bloques = []
    for t in glosario:
        alias = t.get("aliases") or []
        extra = f" (tambien: {', '.join(alias[:3])})" if alias else ""
        bloques.append(f"- **{t['term_canonical']}**{extra}: {t.get('definition') or ''}\n")
    usados = cabe(bloques, presupuesto * cupos["glosario"])
    stats["glosario"] = f"{len(usados)}/{len(bloques)}"
    if usados:
        partes.append("## Glosario\n\n" + "".join(usados))

    # Formas de explicar: que decir, sin las citas. El bot no cita a un AE.
    bloques = []
    for p in patrones:
        cuando = f" Usar cuando: {p['when_to_use']}" if p.get("when_to_use") else ""
        bloques.append(f"- **{p['label']}**: {p.get('description') or ''}{cuando}\n")
    usados = cabe(bloques, presupuesto * cupos["pitch"])
    stats["pitch"] = f"{len(usados)}/{len(bloques)}"
    if usados:
        partes.append("## Como explicar Humand\n\n" + "".join(usados))

    # FAQs: pregunta → respuesta. Las que tienen conflicto no salen: si los AEs se
    # contradicen, el bot no puede elegir por ellos.
    bloques = []
    for f in faqs:
        if f.get("has_conflict") or not (f.get("answer_recommended") or "").strip():
            continue
        bloques.append(f"**{f['question_canonical']}**\n{f['answer_recommended']}\n\n")
    usados = cabe(bloques, presupuesto * cupos["faq"])
    stats["faq"] = f"{len(usados)}/{len(bloques)}"
    if usados:
        partes.append("## Preguntas frecuentes\n\n" + "".join(usados))

    return "\n".join(partes), stats


def main() -> int:
    ap = argparse.ArgumentParser(description="Pack de conocimiento para el bot de WhatsApp")
    ap.add_argument("--incluir-pending", action="store_true",
                    help="Incluir items sin revisar. Solo para probar el bot, NUNCA en produccion")
    ap.add_argument("--formato", choices=["markdown", "json"], default="markdown")
    ap.add_argument("--presupuesto", type=int, default=PRESUPUESTO_DEFAULT,
                    help=f"Tokens maximos del pack (default {PRESUPUESTO_DEFAULT})")
    args = ap.parse_args()

    os.makedirs(ARTIFACTS, exist_ok=True)

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    estados = ESTADOS_PUBLICABLES + (("pending",) if args.incluir_pending else ())

    conn = psycopg2.connect(**config.get_db_connection_params(), connect_timeout=15)
    cur = conn.cursor()
    try:
        cur.execute("SET TRANSACTION READ ONLY;")
        glosario = fetch(cur, "ae_glossary_terms",
                         "term_canonical, definition, aliases, demos",
                         estados, "demos DESC NULLS LAST")
        patrones = fetch(cur, "ae_pitch_patterns",
                         "label, description, when_to_use, demos",
                         estados, "demos DESC NULLS LAST")
        faqs = fetch(cur, "ae_faq_canonical",
                     "question_canonical, answer_recommended, has_conflict, demos",
                     estados, "demos DESC NULLS LAST")
    finally:
        conn.close()

    total = len(glosario) + len(patrones) + len(faqs)
    if total == 0:
        print("No hay nada publicable.", file=sys.stderr)
        if not args.incluir_pending:
            print("Todo esta en 'pending': falta que alguien lo revise.\n"
                  "  python scripts/ae_review.py --export", file=sys.stderr)
        return 1

    if args.incluir_pending:
        print("⚠ INCLUYE ITEMS SIN REVISAR. Esto no va a produccion: son textos "
              "generados que ningun humano valido, y el bot le habla a leads reales.")

    texto, stats = armar_markdown(glosario, patrones, faqs, args.presupuesto)
    tokens = int(len(texto) / CHARS_POR_TOKEN)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    suf = "_BORRADOR" if args.incluir_pending else ""
    if args.formato == "json":
        path = os.path.join(ARTIFACTS, f"knowledge_pack{suf}_{ts}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "generado": ts,
                "estados_incluidos": list(estados),
                "glosario": glosario, "patrones": patrones,
                "faqs": [f for f in faqs if not f.get("has_conflict")],
            }, f, ensure_ascii=False, indent=2, default=str)
    else:
        path = os.path.join(ARTIFACTS, f"knowledge_pack{suf}_{ts}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(texto)

    print(f"\n~{tokens} tokens (presupuesto {args.presupuesto})")
    for k, v in stats.items():
        print(f"  {k:10} {v} items incluidos")
    descartadas = sum(1 for f in faqs if f.get("has_conflict"))
    if descartadas:
        print(f"  {descartadas} FAQ(s) excluidas por contradiccion entre AEs: el bot no "
              f"puede elegir cual respuesta es la correcta")
    print(f"\n  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
