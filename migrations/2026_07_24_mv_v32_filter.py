"""Filtrar mv_insights_norm a la version de prompt activa (v3.2).

CONTEXTO
--------
mv_insights_norm mezclaba TODAS las prompt_versions (v2.0, v3.0, v3.1,
v3.1-test, v3.2 ~= 494k filas). Pero el camino de agregacion del dashboard
solo consulta la version activa (v3.2). El REFRESH sobre 494k filas x funciones
por-fila (_norm_region, _normkey, ...) tardaba 15+ min, se colgaba via el pooler
transaction-mode (6543) y dejaba REFRESH huerfanos que bloqueaban la MV.

Filtrando la MV a v3.2 baja a ~194k filas -> refresh mucho mas rapido/confiable.
NO se pierde dato: transcript_insights (fuente de verdad) conserva todas las
versiones; la MV es solo un cache derivado. Para volver a incluir otra version,
cambiar VERSIONS y re-correr.

METODO (build-new + swap atomico, sin bloquear el dashboard)
------------------------------------------------------------
1. Construir mv_insights_norm_new = mismo SELECT que la MV viva (extraido con
   pg_get_viewdef, para no revertir columnas de migraciones previas) + WHERE
   prompt_version IN (VERSIONS). No toca la MV viva -> dashboard sigue leyendo.
2. Crear los mismos indices en _new (nombres temporales).
3. Swap: RENAME viva->_old, _new->mv_insights_norm (metadata, lock minimo). Las
   funciones (_filter_insights_norm, rpc_*) referencian por nombre -> se
   auto-repuntan. Ninguna vista/MV depende de la MV (verificado), asi que no hay
   CASCADE que rompa nada.
4. DROP _old, renombrar indices a canonicos.

Aplicado a produccion el 2026-07-24 (via los pasos de arriba, ejecutados a mano
por la inestabilidad del pooler). Este archivo deja el mecanismo reproducible.

    python migrations/2026_07_24_mv_v32_filter.py            # aplica
    python migrations/2026_07_24_mv_v32_filter.py --dry-run  # solo imprime plan
"""

from __future__ import annotations

import json
import sys
import time

import config
import psycopg2

VERSIONS = ("v3.2",)  # versiones a mantener en la MV; editar + re-correr para cambiar


def _conn():
    p = dict(config.get_db_connection_params())
    p.update(keepalives=1, keepalives_idle=15, keepalives_interval=5, keepalives_count=3)
    c = psycopg2.connect(**p, connect_timeout=20)
    c.autocommit = True
    return c


def main():
    dry = "--dry-run" in sys.argv
    in_list = ", ".join(f"'{v}'" for v in VERSIONS)
    c = _conn()
    cur = c.cursor()
    cur.execute("SET statement_timeout = '1800000';")

    viewdef = None
    cur.execute("SELECT pg_get_viewdef('mv_insights_norm'::regclass, true)")
    viewdef = cur.fetchone()[0].strip().rstrip(";").strip()
    cur.execute("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='mv_insights_norm' ORDER BY indexname")
    idxs = cur.fetchall()

    select_filtered = f"{viewdef}\n  WHERE v.prompt_version IN ({in_list})"
    print("== nuevo SELECT de la MV ==")
    print(select_filtered[-300:])
    if dry:
        print("\n(dry-run) versions:", VERSIONS)
        return

    # 1-2. build new + indices
    cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_insights_norm_new CASCADE;")
    t0 = time.time()
    cur.execute(f"CREATE MATERIALIZED VIEW mv_insights_norm_new AS\n{select_filtered};")
    print(f"mv_insights_norm_new creada en {round(time.time()-t0,1)}s")
    for name, d in idxs:
        cur.execute(d.replace("mv_insights_norm", "mv_insights_norm_new") + ";")

    # 3. swap atomico
    cur.execute("BEGIN;")
    cur.execute("SET LOCAL lock_timeout='15s';")
    cur.execute("ALTER MATERIALIZED VIEW mv_insights_norm RENAME TO mv_insights_norm_old;")
    cur.execute("ALTER MATERIALIZED VIEW mv_insights_norm_new RENAME TO mv_insights_norm;")
    cur.execute("COMMIT;")
    print("swap OK")

    # 4. cleanup
    cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_insights_norm_old CASCADE;")
    for name, _ in idxs:
        cur.execute(f"ALTER INDEX IF EXISTS {name.replace('mv_insights_norm','mv_insights_norm_new')} RENAME TO {name};")
    cur.execute("SELECT count(*) FROM mv_insights_norm")
    print("mv_insights_norm filas:", cur.fetchone()[0])
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
