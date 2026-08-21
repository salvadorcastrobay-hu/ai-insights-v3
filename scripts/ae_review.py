"""
Fase 6 del AE Playbook: revision humana de lo que va a consumir el bot.

Exporta a CSV lo que esta en `pending`, una persona pone su decision en una
columna, y se importa de vuelta. No es un CLI de aprobar-uno-por-uno a proposito:
son cientos de items y quien revisa es Marketing o un AE senior, que trabaja mucho
mas rapido en una planilla que en una terminal.

Este paso no es opcional ni automatizable: el pack alimenta un bot que le habla a
leads reales, y nada de lo que produce el pipeline esta validado por producto.
El endpoint del bot sirve solo `approved`.

Usage:
    source .venv/bin/activate
    python scripts/ae_review.py --export                    # saca el CSV a revisar
    python scripts/ae_review.py --export --tabla glosario   # solo una tabla
    python scripts/ae_review.py --import revision.csv       # aplica las decisiones
    python scripts/ae_review.py --status                    # cuanto falta revisar
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

ARTIFACTS = os.path.join(ROOT, "artifacts")

# Que se muestra de cada tabla para poder decidir sin abrir la DB.
TABLAS = {
    "glosario": {
        "tabla": "ae_glossary_terms",
        "cols": ["term_canonical", "definition", "aliases", "module", "demos", "success_lift"],
        "texto": "definition",
    },
    "pitch": {
        "tabla": "ae_pitch_patterns",
        "cols": ["label", "description", "when_to_use", "unit_type", "module",
                 "demos", "success_lift", "example_quotes"],
        "texto": "description",
    },
    "faq": {
        "tabla": "ae_faq_canonical",
        "cols": ["topic", "question_canonical", "answer_recommended", "has_conflict",
                 "demos", "ae_answers"],
        "texto": "answer_recommended",
    },
}

DECISIONES = {"approved", "rejected", "edited", "pending"}


def exportar(cur, tablas: list[str], solo_pending: bool) -> str:
    filas = []
    for nombre in tablas:
        cfg = TABLAS[nombre]
        where = "WHERE human_status = 'pending'" if solo_pending else ""
        cur.execute(
            f"SELECT id, human_status, {', '.join(cfg['cols'])} "
            f"FROM {cfg['tabla']} {where} ORDER BY demos DESC NULLS LAST"
        )
        nombres = [d[0] for d in cur.description]
        for r in cur.fetchall():
            fila = dict(zip(nombres, r))
            filas.append({
                "tabla": nombre,
                "id": fila["id"],
                # Prellenada con el estado actual: quien revisa cambia solo las
                # que quiere tocar, y re-importar sin cambios no hace nada.
                "decision": fila["human_status"],
                # Columna aparte para reescribir el texto sin perder el original.
                "texto_corregido": "",
                **{k: _plano(v) for k, v in fila.items() if k not in ("id", "human_status")},
            })

    if not filas:
        return ""

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(ARTIFACTS, f"revision_{ts}.csv")
    columnas = ["tabla", "id", "decision", "texto_corregido"]
    for f in filas:
        for k in f:
            if k not in columnas:
                columnas.append(k)

    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=columnas, extrasaction="ignore")
        w.writeheader()
        w.writerows(filas)
    return path


def _plano(v) -> str:
    """Aplana arrays de Postgres para que se lean en una celda."""
    if isinstance(v, list):
        return " | ".join(str(x) for x in v[:4])
    return "" if v is None else str(v)


def importar(conn, cur, path: str) -> dict:
    with open(path, encoding="utf-8-sig") as fh:
        filas = list(csv.DictReader(fh))

    stats = {"aplicadas": 0, "sin_cambio": 0, "invalidas": 0, "editadas": 0}
    for fila in filas:
        nombre = (fila.get("tabla") or "").strip()
        cfg = TABLAS.get(nombre)
        decision = (fila.get("decision") or "").strip().lower()
        fid = (fila.get("id") or "").strip()

        if not cfg or not fid or decision not in DECISIONES:
            stats["invalidas"] += 1
            continue
        if decision == "pending":
            stats["sin_cambio"] += 1
            continue

        correccion = (fila.get("texto_corregido") or "").strip()
        # Un texto corregido implica 'edited' aunque hayan marcado 'approved':
        # el estado tiene que reflejar que lo que se publica no es lo que salio
        # del pipeline.
        if correccion:
            decision = "edited"
            cur.execute(
                f"UPDATE {cfg['tabla']} SET {cfg['texto']} = %s, human_status = %s, "
                f"reviewed_at = now() WHERE id = %s",
                (correccion, decision, fid),
            )
            stats["editadas"] += 1
        else:
            cur.execute(
                f"UPDATE {cfg['tabla']} SET human_status = %s, reviewed_at = now() "
                f"WHERE id = %s",
                (decision, fid),
            )
        stats["aplicadas"] += 1

    conn.commit()
    return stats


def estado(cur) -> None:
    print(f"{'tabla':22} {'pending':>8} {'approved':>9} {'edited':>7} {'rejected':>9}")
    for nombre, cfg in TABLAS.items():
        cur.execute(
            f"SELECT human_status, COUNT(*) FROM {cfg['tabla']} GROUP BY 1"
        )
        c = dict(cur.fetchall())
        print(f"{cfg['tabla']:22} {c.get('pending', 0):>8} {c.get('approved', 0):>9} "
              f"{c.get('edited', 0):>7} {c.get('rejected', 0):>9}")
    print("\nEl endpoint del bot sirve approved + edited. pending y rejected no salen.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Revision humana del AE Playbook")
    ap.add_argument("--export", action="store_true", help="Exportar a CSV para revisar")
    ap.add_argument("--import", dest="importar", metavar="CSV",
                    help="Aplicar las decisiones de un CSV revisado")
    ap.add_argument("--status", action="store_true", help="Cuanto falta revisar")
    ap.add_argument("--tabla", choices=list(TABLAS), action="append",
                    help="Limitar a una tabla (se puede repetir). Default: todas")
    ap.add_argument("--todo", action="store_true",
                    help="Exportar tambien lo ya revisado, no solo pending")
    args = ap.parse_args()

    if not (args.export or args.importar or args.status):
        ap.error("elegi --export, --import o --status")

    os.makedirs(ARTIFACTS, exist_ok=True)

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    conn = psycopg2.connect(**config.get_db_connection_params(), connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        if args.status:
            estado(cur)
        if args.export:
            path = exportar(cur, args.tabla or list(TABLAS), not args.todo)
            if not path:
                print("Nada pendiente de revision.")
            else:
                print(f"CSV para revisar: {path}\n")
                print("Como se usa:")
                print("  1. Abrilo en Google Sheets o Excel.")
                print("  2. En 'decision' poné approved / rejected / edited.")
                print("  3. Si querés cambiar el texto, escribilo en 'texto_corregido'")
                print("     (eso marca la fila como 'edited' automaticamente).")
                print("  4. Exportá a CSV y corré:")
                print(f"     python scripts/ae_review.py --import {path}")
        if args.importar:
            stats = importar(conn, cur, args.importar)
            print(f"aplicadas {stats['aplicadas']} (de las cuales {stats['editadas']} con "
                  f"texto corregido) · sin cambio {stats['sin_cambio']} · "
                  f"invalidas {stats['invalidas']}")
            print()
            estado(cur)
    except Exception as e:
        conn.rollback()
        print(f"ERROR, rollback: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
