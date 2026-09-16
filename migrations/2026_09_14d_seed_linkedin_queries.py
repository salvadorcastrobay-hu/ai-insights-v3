"""
Queries de búsqueda por tema para LinkedIn.

Es la otra mitad del canal: además de seguir referentes conocidos, descubrir qué
está funcionando sobre los temas que le importan a Humand.

POR QUÉ ACÁ SÍ Y EN INSTAGRAM NO: la búsqueda de LinkedIn ordena por RELEVANCIA
y devuelve engagement real, así que los resultados se pueden rankear. El hashtag
de Instagram devuelve lo más reciente con likesCount 0 y solo sirve para
descubrir cuentas. Por eso `loadRunnableSources` ejecuta los keyword de LinkedIn
y filtra los de Instagram.

QUERIES CARGADAS DE DOMINIO, NO FRASES GENÉRICAS. Medido: "gestão de pessoas"
devolvió un IT manager y un dev full-stack entre 5 resultados — es una frase que
cualquiera usa. Estos términos, en cambio, son los que un dev no escribe nunca.
Sobre eso se aplican dos filtros más: `authorKeywords` sobre el headline en la
llamada al actor, y un post-filtro local de léxico (looksLikeHrAuthor).

Los temas están alineados a los módulos de Humand: comunicación interna, clima y
cultura, desempeño, onboarding, reconocimiento y rotación.

Rollback:
    DELETE FROM content_sources WHERE created_by = 'query-li:2026_09_14';

Usage:
    python3 migrations/2026_09_14d_seed_linkedin_queries.py --dry-run
    python3 migrations/2026_09_14d_seed_linkedin_queries.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SEED_TAG = "query-li:2026_09_14"

# (query, region, language)
QUERIES = [
    # Brasil
    ("comunicação interna",          "br", "pt-BR"),
    ("clima organizacional",         "br", "pt-BR"),
    ("engajamento de colaboradores", "br", "pt-BR"),
    ("avaliação de desempenho",      "br", "pt-BR"),
    ("onboarding de colaboradores",  "br", "pt-BR"),
    ("rotatividade turnover",        "br", "pt-BR"),

    # HISPAM (Argentina, México, Chile, Colombia)
    ("comunicación interna",         "hispam", "es-AR"),
    ("encuesta de clima laboral",    "hispam", "es-AR"),
    ("experiencia del empleado",     "hispam", "es-AR"),
    ("gestión del desempeño",        "hispam", "es-AR"),
    ("rotación de personal",         "hispam", "es-AR"),
    ("reconocimiento a colaboradores", "hispam", "es-AR"),

    # España
    ("comunicación interna",         "es", "es-ES"),
    ("experiencia de empleado",      "es", "es-ES"),
    ("cultura organizacional",       "es", "es-ES"),
    ("gestión del talento",          "es", "es-ES"),
]

INSERT_SQL = """
INSERT INTO content_sources
    (platform, kind, value, label, region, language,
     results_limit, priority, is_active, approval_state, notes, created_by)
VALUES %s
ON CONFLICT (platform, kind, value, region) DO UPDATE SET
    label          = EXCLUDED.label,
    approval_state = 'approved',
    is_active      = true,
    updated_at     = now();
"""


def build_rows() -> list[tuple]:
    return [
        (
            "linkedin",
            "keyword",
            query,
            f'"{query}"',
            region,
            language,
            # El conector pide el doble y filtra por headline, así que el cupo
            # efectivo es este. A USD 0,00001 el post, el limitante no es la
            # plata sino el ruido.
            25,
            120,          # después de los perfiles, antes de los hashtags de IG
            True,
            "approved",
            "Query de descubrimiento por tema. Ordenada por relevancia, ventana de 1 mes.",
            SEED_TAG,
        )
        for query, region, language in QUERIES
    ]


def main() -> int:
    rows = build_rows()

    if "--dry-run" in sys.argv:
        print(f"-- {len(rows)} queries de LinkedIn\n")
        for query, region, language in QUERIES:
            print(f"  {region:8} {language:6}  {query}")
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
        conn.commit()
        print(f"✓ {len(rows)} queries de LinkedIn aprobadas.")
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
