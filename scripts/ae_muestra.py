"""
Describe la muestra que se uso en un run del AE Playbook. Read-only.

Existe porque "de que fechas son estas llamadas" es la primera pregunta que hace
cualquiera que lee el playbook, y la respuesta tiene que salir del dato y no de
acordarse que flags se pasaron.

Usage:
    source .venv/bin/activate
    python scripts/ae_muestra.py
    python scripts/ae_muestra.py --region HISPAM --detalle
"""
from __future__ import annotations

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ae_prompt_builder import AE_PROMPT_VERSION  # noqa: E402
from src.skills.market_filters import build_region_filter_clause  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Describe la muestra de un run AE-side")
    ap.add_argument("--region", default="HISPAM")
    ap.add_argument("--version", default=AE_PROMPT_VERSION)
    ap.add_argument("--detalle", action="store_true",
                    help="Listar las llamadas una por una (empresa, fecha, AE)")
    args = ap.parse_args()

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    where, params = "ae_prompt_version = %s", [args.version]
    if args.region != "all":
        rc, rp = build_region_filter_clause("region", args.region)
        if rc:
            where += f" AND {rc}"
            params.extend(rp)

    conn = psycopg2.connect(**config.get_db_connection_params(), connect_timeout=15)
    cur = conn.cursor()
    try:
        cur.execute("SET TRANSACTION READ ONLY;")

        cur.execute(
            f"""SELECT COUNT(DISTINCT transcript_id), COUNT(DISTINCT deal_id),
                       MIN(call_date), MAX(call_date), COUNT(*),
                       COUNT(DISTINCT deal_owner), COUNT(DISTINCT country)
                FROM ae_speech_units WHERE {where}""",
            params,
        )
        demos, deals, desde, hasta, unidades, aes, paises = cur.fetchone()
        if not demos:
            print(f"Sin datos para region={args.region} version={args.version}",
                  file=sys.stderr)
            return 1

        print(f"MUESTRA — {args.region} · prompt {args.version}\n")
        print(f"  llamadas          {demos}")
        print(f"  deals             {deals}")
        print(f"  intervenciones    {unidades}")
        print(f"  AEs distintos     {aes}")
        print(f"  paises            {paises}")
        print(f"  desde             {desde}")
        print(f"  hasta             {hasta}")

        print("\n  Por mes:")
        cur.execute(
            f"""SELECT to_char(call_date, 'YYYY-MM') AS mes,
                       COUNT(DISTINCT transcript_id) AS llamadas
                FROM ae_speech_units WHERE {where}
                GROUP BY 1 ORDER BY 1""",
            params,
        )
        for mes, n in cur.fetchall():
            print(f"    {mes or '(sin fecha)'}   {n:>4}  {'█' * min(n, 50)}")

        print("\n  Por pais:")
        cur.execute(
            f"""SELECT COALESCE(NULLIF(TRIM(country), ''), '(sin dato)'),
                       COUNT(DISTINCT transcript_id)
                FROM ae_speech_units WHERE {where}
                GROUP BY 1 ORDER BY 2 DESC""",
            params,
        )
        for pais, n in cur.fetchall():
            print(f"    {n:>4}  {pais}")

        print("\n  Por etapa del deal:")
        cur.execute(
            f"""SELECT COALESCE(NULLIF(TRIM(deal_stage), ''), '(sin dato)'),
                       COUNT(DISTINCT transcript_id)
                FROM ae_speech_units WHERE {where}
                GROUP BY 1 ORDER BY 2 DESC""",
            params,
        )
        for etapa, n in cur.fetchall():
            print(f"    {n:>4}  {etapa}")

        print("\n  Top AEs:")
        cur.execute(
            f"""SELECT COALESCE(NULLIF(TRIM(deal_owner), ''), '(sin dato)'),
                       COUNT(DISTINCT transcript_id)
                FROM ae_speech_units WHERE {where}
                GROUP BY 1 ORDER BY 2 DESC LIMIT 12""",
            params,
        )
        for ae, n in cur.fetchall():
            print(f"    {n:>4}  {ae}")

        if args.detalle:
            print("\n  Detalle de llamadas:")
            cur.execute(
                f"""SELECT DISTINCT call_date, company_name, country, deal_owner, deal_stage
                    FROM ae_speech_units WHERE {where}
                    ORDER BY call_date DESC NULLS LAST""",
                params,
            )
            for fecha, empresa, pais, owner, etapa in cur.fetchall():
                print(f"    {str(fecha):12} {str(empresa)[:32]:32} {str(pais)[:14]:14} "
                      f"{str(owner)[:22]:22} {etapa}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
