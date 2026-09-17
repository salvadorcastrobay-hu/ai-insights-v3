"""
Seed inicial de content_sources.

Dos grupos:
  1. Los perfiles de Instagram que ya monitoreamos, tomados de
     MONITORED_COMPETITORS (humand-insights-web/lib/competitor-ads/config.ts).
     Se copian acá para que la config orgánica deje de vivir en código; el array
     de TS sigue siendo la fuente de verdad de los ads PAGOS, que tienen pageId /
     googleDomain / advertiser y no aplican a este eje.
  2. Un set chico de hashtags por región para arrancar el discovery.

Los hashtags son un punto de partida para validar el pipeline, NO una lista
curada: la idea es que Content los edite desde la UI. Por eso results_limit
arranca bajo — la búsqueda por hashtag cobra por resultado.

Idempotente: ON CONFLICT DO NOTHING sobre (platform, kind, value, region). Correr
dos veces no duplica ni pisa ediciones hechas desde la UI.

Rollback:
    DELETE FROM content_sources WHERE created_by = 'seed:2026_09_09b';

Usage:
    python3 migrations/2026_09_09b_seed_content_sources.py --dry-run
    python3 migrations/2026_09_09b_seed_content_sources.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SEED_TAG = "seed:2026_09_09b"

# (competitor_name, handle, language, region, es_marca_propia)
PROFILES = [
    ("Humand",      "humand.es",      "es-AR", "hispam", True),
    ("Buk",         "buk_chile",      "es-AR", "hispam", False),
    ("Caju",        "caju",           "pt-BR", "br",     False),
    ("Factorial",   "factorial_br",   "pt-BR", "br",     False),
    ("Naaloo HR",   "naaloohr",       "es-AR", "hispam", False),
    ("Mandü HR",    "manduhr.pe",     "es-AR", "hispam", False),
    ("Crehana",     "crehanacom",     "es-AR", "hispam", False),
    ("Rankmi",      "rankmioficial",  "es-AR", "hispam", False),
    ("PeopleForce", "peopleforce.io", "es-AR", "hispam", False),
]

# (hashtag sin '#', region, language)
#
# OJO — la búsqueda por hashtag de Instagram NO es regional. Sembrar el mismo
# hashtag en varias regiones devuelve EXACTAMENTE los mismos posts y multiplica
# el costo por nada (medido el 2026-09-09: #recursoshumanos en br/es/hispam dio
# los mismos 20 posts tres veces). Ver 2026_09_09c_fix_hashtag_regions.py.
#
# Por eso: los términos que existen en varios mercados van una sola vez, como
# 'global'. Solo llevan región los que son propios de un idioma, donde el
# término mismo ya acota el mercado.
HASHTAGS = [
    # Genéricos o compartidos entre mercados -> una sola fila.
    ("recursoshumanos",       "global", "es-AR"),
    ("culturaorganizacional", "global", "es-AR"),

    # Propios del portugués -> Brasil.
    ("gestaodepessoas",     "br", "pt-BR"),
    ("rhestrategico",       "br", "pt-BR"),
    ("climaorganizacional", "br", "pt-BR"),

    # Propios del español -> HISPAM / España.
    ("gestiondepersonas", "hispam", "es-AR"),
    ("climalaboral",      "hispam", "es-AR"),
    ("liderazgo",         "hispam", "es-AR"),
    ("gestiondeltalento",  "es", "es-ES"),
    ("culturaempresarial", "es", "es-ES"),
]

INSERT_SQL = """
INSERT INTO content_sources
    (platform, kind, value, label, region, language, competitor_name,
     results_limit, priority, is_active, approval_state, created_by)
VALUES %s
ON CONFLICT (platform, kind, value, region) DO NOTHING;
"""


def build_rows() -> list[tuple]:
    rows: list[tuple] = []

    for name, handle, language, region, own_brand in PROFILES:
        rows.append((
            "instagram",
            "own_brand" if own_brand else "competitor_profile",
            handle,
            name,
            region,
            language,
            name,
            50,   # el perfil propio es acotado: no hay riesgo de gasto
            10,   # los perfiles corren antes que los hashtags
            True,
            "approved",
            SEED_TAG,
        ))

    for tag, region, language in HASHTAGS:
        rows.append((
            "instagram",
            "hashtag",
            tag,
            f"#{tag}",
            region,
            language,
            None,
            20,   # cupo bajo hasta validar la señal y el costo real
            100,
            True,
            "approved",
            SEED_TAG,
        ))

    return rows


def main() -> int:
    rows = build_rows()

    if "--dry-run" in sys.argv:
        print(f"-- {len(rows)} filas a insertar en content_sources\n")
        for row in rows:
            kind, value, label, region = row[1], row[2], row[3], row[4]
            print(f"  {kind:20} {value:25} {label:22} {region}")
        print("\n" + INSERT_SQL)
        return 0

    import config  # noqa
    import psycopg2  # noqa
    from psycopg2.extras import execute_values  # noqa

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SET statement_timeout = '60s';")
        execute_values(cur, INSERT_SQL, rows)
        inserted = cur.rowcount
        conn.commit()
        print(f"✓ seed listo: {inserted} filas nuevas de {len(rows)} candidatas.")
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Falló (rollback): {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
