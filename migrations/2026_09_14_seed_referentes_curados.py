"""
Referentes de RRHH curados a mano, verificados contra Instagram.

POR QUÉ A MANO: el descubrimiento automático por hashtag falló para esto. De las
163 cuentas que encontró, 101 tienen menos de 1.000 seguidores y la más grande
era una consultora de inmigración a Canadá. Los hashtags de RRHH en Instagram
están dominados por consultores chicos y agencias publicando vacantes.

Estas salieron de listas curadas por el propio sector — varias publicadas por
competidores (Caju, Gupy, Flash, Sólides, Creditas) y por medios de RRHH de
España — y después se resolvieron a handles reales con el search de Apify y se
verificaron uno por uno contra su bio. Son entre 60x y 600x más grandes que lo
mejor del descubrimiento automático.

DISTINCIÓN DE AUDIENCIA (campo `audience`), que es lo que decide si un post sirve
para el calendario:

  hr_leader  — le habla a RRHH, líderes y cultura. Es el comprador de Humand.
  candidate  — le habla a quien busca trabajo (CV, entrevistas, carrera).
               Son las cuentas más grandes del rubro, pero NO son la audiencia
               de Humand. Se siguen igual porque de ahí se aprende formato,
               hooks y ritmo — no temas para el calendario.

Rollback:
    DELETE FROM content_sources WHERE created_by = 'curado:2026_09_14';

Usage:
    python3 migrations/2026_09_14_seed_referentes_curados.py --dry-run
    python3 migrations/2026_09_14_seed_referentes_curados.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SEED_TAG = "curado:2026_09_14"

# (handle, nombre, region, language, audience, seguidores_verificados, nota)
REFERENTES = [
    ("pellaes", "Alexandre Pellaes", "br", "pt-BR", "hr_leader", 324_653,
     "Liderança, RH e significado do trabalho. Professor e pesquisador, 2x TEDx."),
    ("pilarjerico", "Pilar Jericó", "es", "es-ES", "hr_leader", 47_638,
     "Liderazgo humanista, NoMiedo y change mindset. Presidenta de BeUp."),
    ("humorlaboficial", "Humorlab", "br", "pt-BR", "hr_leader", 7_753,
     "Desenvolvimento de times, palestras e treinamentos corporativos."),

    # Audiencia de candidatos: se siguen por formato, no por tema.
    ("evaportorrhh", "Eva Porto", "es", "es-ES", "candidate", 737_623,
     "Psicóloga y recruiter. CV, entrevistas y carrera profesional."),
    ("carolmartinsf_", "Carolina Martins", "br", "pt-BR", "candidate", 447_696,
     "A mulher mais seguida do LinkedIn. Carreira e conselhos profissionais."),
]

INSERT_SQL = """
INSERT INTO content_sources
    (platform, kind, value, label, region, language, audience,
     results_limit, priority, is_active, approval_state, notes, created_by)
VALUES %s
ON CONFLICT (platform, kind, value, region) DO UPDATE SET
    label          = EXCLUDED.label,
    audience       = EXCLUDED.audience,
    approval_state = 'approved',
    is_active      = true,
    notes          = EXCLUDED.notes,
    updated_at     = now();
"""


def build_rows() -> list[tuple]:
    return [
        (
            "instagram",
            "profile",
            handle,
            name,
            region,
            language,
            audience,
            # Cupo por cuenta: alcanza para tener baseline (mediana sobre >=5
            # posts maduros) sin disparar el gasto. Plan Apify FREE = USD 5/mes.
            30,
            50,          # antes que los hashtags, después de los competidores
            True,
            "approved",
            f"{followers:,}".replace(",", ".") + f" seg. al 2026-09-14. {note}",
            SEED_TAG,
        )
        for handle, name, region, language, audience, followers, note in REFERENTES
    ]


def main() -> int:
    rows = build_rows()

    if "--dry-run" in sys.argv:
        print(f"-- {len(rows)} referentes curados\n")
        for handle, name, region, language, audience, followers, note in REFERENTES:
            fol = f"{followers:,}".replace(",", ".")
            print(f"  @{handle:<18} {fol:>9} seg.  {region:7} {audience:10} {name}")
            print(f"      {note}")
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
        print(f"✓ {len(rows)} referentes curados aprobados.")
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
