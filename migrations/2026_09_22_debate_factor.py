"""
debate_factor: cuánto MÁS discutido fue un post que lo normal de su autor.

POR QUÉ: `viral_score` mide atención. Un post con 500 likes y 2 comentarios y
otro con 500 likes y 200 comentarios puntúan casi igual, y no son lo mismo — el
segundo tocó un nervio. Para contenido B2B la fricción es mejor señal que el
asentimiento: un post que se discute marca un tema sobre el que el mercado no se
puso de acuerdo, y eso es material para escribir.

Se mide contra la propia base del autor, igual que outlier_factor, porque hay
autores que siempre generan debate y autores que nunca.

Rollback:
    ALTER TABLE content_posts DROP COLUMN debate_factor;

Usage:
    python3 migrations/2026_09_22_debate_factor.py --dry-run
    python3 migrations/2026_09_22_debate_factor.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL = """
ALTER TABLE content_posts
    ADD COLUMN IF NOT EXISTS debate_factor numeric;

-- El feed de "lo que se discutió" ordena por esta columna.
CREATE INDEX IF NOT EXISTS cp_debate_idx
    ON content_posts (debate_factor DESC NULLS LAST);
"""

STEPS = [("debate_factor en content_posts", SQL)]


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
