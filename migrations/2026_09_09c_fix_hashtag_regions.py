"""
Corrige el modelo de región para fuentes de tipo hashtag.

PROBLEMA (detectado en la primera corrida real, 2026-09-09):
El seed sembró los hashtags genéricos (#recursoshumanos, #culturaorganizacional)
una vez por región — br, hispam y es. Pero la búsqueda por hashtag de Instagram
NO es regional: los tres devolvieron EXACTAMENTE los mismos 20 posts. Medido:

    #recursoshumanos [br]:     20 posts
    #recursoshumanos [es]:     20 posts
    #recursoshumanos [hispam]: 20 posts
    posts devueltos a más de una región: 20   <- o sea, los mismos

Consecuencias: 3x el costo de Apify por cero información nueva, y 60 filas
duplicadas en content_sources — la misma cuenta sugerida en tres regiones, con
etiqueta de región arbitraria (una cuenta brasileña marcada como 'es').

ARREGLO:
  1. Los hashtags duplicados entre regiones se consolidan en region='global'.
     La región de un hashtag no es un dato que Instagram nos dé.
  2. Las cuentas sugeridas se deduplican por handle, conservando la más antigua.
  3. Los hashtags que sí son propios de un idioma (#gestaodepessoas para pt-BR,
     #gestiondeltalento para es-ES) conservan su región: ahí la señal es real,
     porque el término solo existe en ese idioma.

La región de una CUENTA hay que inferirla de su contenido, no de la fuente que
la descubrió. Eso queda para el paso de análisis.

Rollback: no hay vuelta atrás automática (se borran filas duplicadas). Las
fuentes se pueden re-sembrar con 2026_09_09b_seed_content_sources.py.

Usage:
    python3 migrations/2026_09_09c_fix_hashtag_regions.py --dry-run
    python3 migrations/2026_09_09c_fix_hashtag_regions.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Hashtags cuyo término solo existe en un idioma: la región sí es informativa.
LANGUAGE_SPECIFIC = ("gestaodepessoas", "rhestrategico", "climaorganizacional",
                     "gestiondepersonas", "gestiondeltalento", "culturaempresarial",
                     "climalaboral", "liderazgo")

SQL_STEPS = [
    ("consolidar hashtags genéricos en region='global'", f"""
        -- Desactiva las copias por región y deja una sola fila global.
        WITH genericos AS (
            SELECT value FROM content_sources
            WHERE kind = 'hashtag' AND value NOT IN {LANGUAGE_SPECIFIC}
            GROUP BY value HAVING count(DISTINCT region) > 1
        ),
        conservar AS (
            SELECT DISTINCT ON (s.value) s.id, s.value
            FROM content_sources s JOIN genericos g ON g.value = s.value
            WHERE s.kind = 'hashtag'
            ORDER BY s.value, s.created_at
        )
        DELETE FROM content_sources s
        USING genericos g
        WHERE s.kind = 'hashtag' AND s.value = g.value
          AND s.id NOT IN (SELECT id FROM conservar);

        UPDATE content_sources SET region = 'global', updated_at = now()
        WHERE kind = 'hashtag' AND value NOT IN {LANGUAGE_SPECIFIC};
    """),

    ("deduplicar cuentas sugeridas por handle", """
        WITH ranked AS (
            SELECT id, row_number() OVER (
                       PARTITION BY platform, value ORDER BY created_at, id
                   ) AS rn
            FROM content_sources
            WHERE approval_state = 'suggested' AND kind = 'profile'
        )
        DELETE FROM content_sources s
        USING ranked r
        WHERE s.id = r.id AND r.rn > 1;
    """),

    ("marcar como global la región de las cuentas sugeridas sobrevivientes", """
        -- La región de una cuenta no la define el hashtag que la encontró.
        -- Queda 'global' hasta que se infiera del contenido o la fije Content.
        UPDATE content_sources SET region = 'global', updated_at = now()
        WHERE approval_state = 'suggested' AND kind = 'profile';
    """),
]


def main() -> int:
    if "--dry-run" in sys.argv:
        for label, sql in SQL_STEPS:
            print(f"-- ── {label} " + "─" * max(0, 50 - len(label)))
            print(sql)
        return 0

    import config  # noqa
    import psycopg2  # noqa

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SET statement_timeout = '60s';")
        cur.execute("SELECT count(*) FROM content_sources")
        antes = cur.fetchone()[0]

        for index, (label, sql) in enumerate(SQL_STEPS, start=1):
            print(f"  [{index}/{len(SQL_STEPS)}] {label}...")
            cur.execute(sql)

        cur.execute("SELECT count(*) FROM content_sources")
        despues = cur.fetchone()[0]
        conn.commit()
        print(f"✓ listo: {antes} → {despues} fuentes ({antes - despues} duplicadas eliminadas).")
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
