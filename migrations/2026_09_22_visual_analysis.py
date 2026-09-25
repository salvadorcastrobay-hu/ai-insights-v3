"""
Análisis del creativo: qué se VE en el post, no solo qué dice el texto.

QUÉ CUBRE Y QUÉ NO: se analiza la imagen de portada archivada en nuestro
bucket. Para los posts de video eso es el poster, que en contenido de RRHH suele
llevar el mensaje entero como texto sobre la imagen.

NO hay transcripción de audio. El archivado guarda los bytes de las imágenes,
no de los videos, y las URLs de video que trajo el scraper ya vencieron — el
CDN las firma con pocos días de vida. Recuperarlas cuesta Apify. El módulo de
Monitoreo de Competidores sí transcribe con whisper, pero sobre su propio
corpus, que se ingesta distinto.

POR QUÉ ENUMS Y NO PROSA: el valor del análisis visual no está en la tarjeta
—al lado de la foto, describirla es ruido pago— sino en el agregado: "el 62%
del corte superior es carrusel de texto plano y el 80% de lo nuestro es foto de
stock". Eso exige campos tabulables. Si no se puede contar, no va.

Rollback:
    ALTER TABLE content_posts
      DROP COLUMN visual_analysis,
      DROP COLUMN visual_analyzed_at;

Usage:
    python3 migrations/2026_09_22_visual_analysis.py --dry-run
    python3 migrations/2026_09_22_visual_analysis.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
ALTER TABLE content_posts
    ADD COLUMN IF NOT EXISTS visual_analysis    jsonb,
    ADD COLUMN IF NOT EXISTS visual_analyzed_at timestamptz;

-- El job busca lo pendiente dentro del corte superior, no en toda la tabla.
CREATE INDEX IF NOT EXISTS cp_visual_pending_idx
    ON content_posts (viral_score DESC NULLS LAST)
    WHERE visual_analysis IS NULL;
"""

STEPS = [("visual_analysis en content_posts", SQL)]


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
        print("✓ listo.")
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
