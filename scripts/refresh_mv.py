"""Refresh mv_insights_norm (CONCURRENTLY, no bloquea lecturas del dashboard).

Se corre al final del pipeline diario para que la MV nunca quede stale — antes
no se refrescaba en ningun lado, se ponia vieja y habia que correrla a mano.

Reglas aprendidas:
  - SIEMPRE CONCURRENTLY (el REFRESH no-concurrente toma ACCESS EXCLUSIVE y
    bloquea todos los reads del dashboard -> "lock timeout" en los RPC).
  - statement_timeout acotado server-side (si algo falla, el server lo aborta;
    matar el cliente deja el REFRESH huerfano corriendo y bloqueando la MV).
  - keepalives agresivos para detectar sockets muertos del pooler.
"""

from __future__ import annotations

import os
import sys
import time

# scripts/ no es el root: al correr `python scripts/refresh_mv.py`, sys.path[0]
# es scripts/ y `import config` (en la raiz) falla en un entorno limpio como el
# de GitHub Actions. Mismo patron que el resto de scripts/.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import config
import psycopg2


def main():
    params = dict(config.get_db_connection_params())
    params.update(keepalives=1, keepalives_idle=15, keepalives_interval=5, keepalives_count=3)
    last_err = None
    for attempt in range(1, 4):
        try:
            conn = psycopg2.connect(**params, connect_timeout=20)
            conn.autocommit = True
            cur = conn.cursor()
            cur.execute("SET statement_timeout = '1800000';")  # 30 min server-bound
            t0 = time.time()
            cur.execute("SELECT refresh_insights_mv();")
            print(f"mv_insights_norm refreshed in {round(time.time() - t0, 1)}s")
            conn.close()
            return
        except Exception as e:
            last_err = e
            print(f"refresh attempt {attempt} failed: {type(e).__name__}: {str(e)[:80]}")
            time.sleep(20)
    print(f"MV refresh failed after retries: {last_err}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
