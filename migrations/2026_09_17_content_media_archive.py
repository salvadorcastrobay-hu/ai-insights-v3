"""
Archivado de imágenes de los posts de content — el arreglo de fondo para "no
hay ninguna foto en la web".

EL PROBLEMA: las URLs que devuelven los scrapers son de CDN y vienen FIRMADAS,
con el vencimiento adentro de la propia query string. Instagram usa `oe` en
hexadecimal, LinkedIn usa `e` en epoch decimal. Medido sobre las 787 URLs
guardadas:

    instagram   TTL 104-108 h (mediana 4,4 días)
    linkedin    TTL 169-514 h (mediana 16 días)

Por eso un proxy NO alcanza: la firma viaja en la URL, así que reenviarla desde
el server devuelve el mismo 403 "URL signature expired". Lo único durable es
quedarse con los bytes.

stored_media guarda PATHS, no URLs: la URL firmada del bucket se emite en cada
request y dura una hora. Guardar una URL firmada sería repetir el mismo error
con otro CDN.

BUCKET PRIVADO, a diferencia de `competitor-ad-media` que es público. Acá hay
fotos de personas identificables y operamos en Brasil y España: un bucket
público convierte "copia interna para análisis" en distribución. El acceso pasa
por la app, que ya exige sesión.

Rollback:
    ALTER TABLE content_posts
      DROP COLUMN stored_media,
      DROP COLUMN media_archived_at,
      DROP COLUMN media_archive_error;
    DELETE FROM storage.buckets WHERE id = 'content-media';

Usage:
    python3 migrations/2026_09_17_content_media_archive.py --dry-run
    python3 migrations/2026_09_17_content_media_archive.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL_COLUMNS = """
ALTER TABLE content_posts
    -- {"images": ["instagram/ABC123/image-0.jpg"], "videos": []}
    ADD COLUMN IF NOT EXISTS stored_media        jsonb,
    ADD COLUMN IF NOT EXISTS media_archived_at   timestamptz,
    -- Se guarda el motivo del fallo en vez de reintentar para siempre: si el
    -- post se borró en origen, no hay nada que recuperar.
    ADD COLUMN IF NOT EXISTS media_archive_error text;

-- Para que el job encuentre lo pendiente sin escanear la tabla entera.
CREATE INDEX IF NOT EXISTS cp_media_pending_idx
    ON content_posts (fetched_at)
    WHERE media_archived_at IS NULL;
"""

SQL_BUCKET = """
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('content-media', 'content-media', false, 20000000)
ON CONFLICT (id) DO NOTHING;
"""

STEPS = [
    ("columnas de archivado en content_posts", SQL_COLUMNS),
    ("bucket privado content-media", SQL_BUCKET),
]


def main() -> int:
    if "--dry-run" in sys.argv:
        for label, sql in STEPS:
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
        for index, (label, sql) in enumerate(STEPS, start=1):
            print(f"  [{index}/{len(STEPS)}] {label}...")
            cur.execute(sql)
        conn.commit()
        print("✓ archivado de media listo.")
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
