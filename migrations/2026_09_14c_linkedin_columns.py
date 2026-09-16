"""
Columnas para soportar LinkedIn en Content Discovery.

  content_posts.shares_count      — LinkedIn tiene shares y son la señal más
                                    fuerte de la plataforma (redistribuyen a una
                                    red nueva, no solo interactúan).
  content_posts.reactions         — desglose por tipo (LIKE, PRAISE, EMPATHY...).
  content_posts.baseline_eligible — si el post cuenta para la mediana del autor.

BASELINE_ELIGIBLE es la columna importante y merece explicación. La búsqueda de
LinkedIn ordena por RELEVANCIA: devuelve el techo de lo que publicó cada autor.
Si esos posts alimentan su mediana, la mediana sube hasta pegarse al máximo y
`outlier_factor` colapsa a ~1 para todos — se apaga sola la capa que más pesa
del ranking. Solo el scrape de perfil da una muestra cronológica contigua, sin
selección por performance, y por eso es la única fuente válida de baseline.

Default false: un post entra a la mediana solo si el camino de perfil lo marcó.
Los posts de Instagram traídos por perfil se marcan con el backfill de abajo.

  content_authors.platform_author_id — urn opaco y estable. El handle puede
                                       cambiar (vanity URL) y partiría la
                                       mediana de un autor en dos.

Rollback:
    ALTER TABLE content_posts DROP COLUMN shares_count, DROP COLUMN reactions,
                              DROP COLUMN baseline_eligible;
    ALTER TABLE content_authors DROP COLUMN platform_author_id;

Usage:
    python3 migrations/2026_09_14c_linkedin_columns.py --dry-run
    python3 migrations/2026_09_14c_linkedin_columns.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL_COLUMNS = """
ALTER TABLE content_posts
    ADD COLUMN IF NOT EXISTS shares_count      int,
    ADD COLUMN IF NOT EXISTS reactions         jsonb,
    ADD COLUMN IF NOT EXISTS baseline_eligible boolean NOT NULL DEFAULT false;

ALTER TABLE content_authors
    ADD COLUMN IF NOT EXISTS platform_author_id text;

CREATE INDEX IF NOT EXISTS cp_baseline_idx
    ON content_posts (platform, author_handle) WHERE baseline_eligible;
CREATE INDEX IF NOT EXISTS ca_platform_author_idx
    ON content_authors (platform_author_id);
"""

# Los posts de Instagram que ya estan en la tabla vinieron del scrape de perfil
# (los de hashtag no: esos no tienen engagement y ya quedan fuera del ranking
# por el filtro de madurez). Se los marca elegibles para no perder la baseline
# que ya se habia calculado.
SQL_BACKFILL = """
UPDATE content_posts p
SET baseline_eligible = true
WHERE p.platform = 'instagram'
  AND p.likes_count IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM content_post_sources ps
      JOIN content_sources s ON s.id = ps.source_id
      WHERE ps.post_id = p.id
        AND s.kind IN ('profile', 'competitor_profile', 'own_brand')
  );
"""

STEPS = [
    ("columnas nuevas", SQL_COLUMNS),
    ("backfill baseline_eligible de Instagram", SQL_BACKFILL),
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
            if "backfill" in label:
                print(f"      {cur.rowcount} posts marcados elegibles")
        cur.execute("NOTIFY pgrst, 'reload schema';")
        conn.commit()
        print("✓ columnas de LinkedIn listas.")
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
