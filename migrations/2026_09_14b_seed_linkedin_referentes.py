"""
Referentes de RRHH en LinkedIn.

POR QUÉ LINKEDIN: es donde vive la audiencia B2B de RRHH. De 17 referentes del
rubro relevados, 12 no tienen Instagram con volumen — Jordi Alemany tiene
291.000 seguidores en LinkedIn y 30 en Instagram; Sofia Esteves tiene 700.000 en
LinkedIn y en Instagram no existe. El descubrimiento por hashtag en Instagram
había devuelto 163 cuentas de las cuales 101 tenían menos de 1.000 seguidores.

FUENTES: listas curadas por el propio sector, varias publicadas por competidores
de Humand (Caju, Gupy, Flash, Sólides, Creditas) y por medios de RRHH españoles
(Cobee, RRHH Digital, IMF). Los seguidores son los que declaran esas listas al
momento de publicarlas: sirven para priorizar, no como métrica del pipeline —
los actores de LinkedIn no exponen followersCount, así que el ranking se apoya
en el outlier contra la mediana del propio autor.

AUDIENCIA (campo `audience`), que es lo que decide si un post sirve para el
calendario de Humand:
  hr_leader — le habla a RRHH, líderes, cultura y comunicación interna.
              Es el comprador de Humand.
  candidate — le habla a quien busca trabajo (CV, entrevistas, carrera).
              Suelen ser los perfiles más grandes, pero NO son la audiencia.
              Se siguen para aprender formato y hooks, no temas.

Rollback:
    DELETE FROM content_sources WHERE created_by = 'curado-li:2026_09_14';

Usage:
    python3 migrations/2026_09_14b_seed_linkedin_referentes.py --dry-run
    python3 migrations/2026_09_14b_seed_linkedin_referentes.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SEED_TAG = "curado-li:2026_09_14"

# Todos los handles fueron verificados contra la API de LinkedIn el 2026-09-14.
# Quedaron afuera tres que no resuelven: aline-sousa-headhunter y
# humanoscomorecurso (handle incorrecto en la fuente) y evaportorrhh (su
# LinkedIn tiene ~40k contra 737k en Instagram: ya la seguimos por ahí).
#
# Ojo al validar: un run con 29 perfiles TRUNCA. La primera pasada dio 17/29 y
# parecía que 12 handles estaban mal; re-corridos en lotes chicos, 9 de esos 12
# resolvían perfecto. Validar de a pocos.
#
# (publicIdentifier, nombre, region, language, audience, seguidores_declarados, nota)
REFERENTES = [
    # ── Brasil · RRHH, cultura y liderazgo ───────────────────────────────────
    ("estevessofia",      "Sofia Esteves",     "br", "pt-BR", "hr_leader", 700_000,
     "Presidente do conselho, Cia de Talentos. Carreira, liderança e employer branding."),
    ("ruyshiozawa",       "Ruy Shiozawa",      "br", "pt-BR", "hr_leader", 200_000,
     "CEO Great Place to Work Brasil. Ambiente de trabalho e cultura organizacional."),
    ("alexandrepellaes",  "Alexandre Pellaes", "br", "pt-BR", "hr_leader", 100_000,
     "Futuro do trabalho, liderança e significado. Pesquisador, 2x TEDx."),
    ("manschneider",      "Maria Schneider",   "br", "pt-BR", "hr_leader", 120_000,
     "Diretora de Pessoas, Cultura e Sustentabilidade no Grupo Panvel."),
    ("neiviajusta",       "Neivia Justa",      "br", "pt-BR", "hr_leader",  80_000,
     "Co-fundadora C-Level Diversity. Diversidade e inclusão em cargos de liderança."),
    ("ctaurion",          "Cezar Taurion",     "br", "pt-BR", "hr_leader",  50_000,
     "Inovação e transformação digital aplicada a RH."),
    ("driferreira",       "Adriana Ferreira",  "br", "pt-BR", "hr_leader",  19_000,
     "Head de consultoria em diversidade e inclusão, Mais Diversidade."),
    ("diogooishi",        "Diogo Oishi",       "br", "pt-BR", "hr_leader",  19_000,
     "People Director na Swile. Employee experience, cultura e people analytics."),
    ("julianabeo",        "Juliana B. Oliveira", "br", "pt-BR", "hr_leader", 18_000,
     "Gestão de pessoas, formação de líderes."),
    ("thalitagelenske",   "Thalita Gelenske",  "br", "pt-BR", "hr_leader",  15_000,
     "Fundadora e CEO da Blend Edu. Diversidade e inclusão."),
    ("nobregamarcelo",    "Marcelo Nobrega",   "br", "pt-BR", "hr_leader",  15_000,
     "Inovação em RH e liderança."),

    # ── Brasil · audiencia candidatos ────────────────────────────────────────
    ("denisebrasil",      "Denise Brasil",     "br", "pt-BR", "candidate", 630_000,
     "Consultora de RH. Remuneração, benefícios e carreira."),
    ("eduardomfelix",     "Eduardo Felix",     "br", "pt-BR", "candidate", 290_000,
     "Aquisição de talentos. Entrevistas e processos seletivos."),
    ("carolmartinsf",     "Carolina Martins",  "br", "pt-BR", "candidate", 447_000,
     "A mulher mais seguida do LinkedIn no Brasil. Carreira e qualificação."),

    # ── España · RRHH, cultura y liderazgo ───────────────────────────────────
    ("fernando-segarra",  "Fernando Segarra",  "es", "es-ES", "hr_leader", 367_800,
     "Cofundador HR Booster School. RRHH y liderazgo."),
    ("jordialemanymonzo", "Jordi Alemany",     "es", "es-ES", "hr_leader", 291_000,
     "Liderazgo humanista y desarrollo de talento."),
    ("pilarjerico",       "Pilar Jericó",      "es", "es-ES", "hr_leader",  75_800,
     "Presidenta de BeUp. Liderazgo, NoMiedo y gestión del cambio."),
    ("milagrosagurto",    "Milagros Agurto",   "es", "es-ES", "hr_leader",  86_000,
     "Conexión de equipos y gestión del talento."),
    ("carmendelapenagonzalez", "Carmen de la Peña", "es", "es-ES", "hr_leader", 52_000,
     "Employee experience y marca personal."),
    ("alfonsoalcantara",  "Alfonso Alcántara", "es", "es-ES", "hr_leader",  49_200,
     "Psicólogo. Motivación, liderazgo y desarrollo profesional."),
    ("pllacer",           "Pilar Llácer",      "es", "es-ES", "hr_leader",  44_500,
     "Liderazgo ético, ética en RRHH y futuro del trabajo."),
    ("jaimepuig",         "Jaime Puig",        "es", "es-ES", "hr_leader",  60_700,
     "Marketing aplicado a RRHH, employer branding e inbound recruiting."),

    # ── España · audiencia candidatos ────────────────────────────────────────
    ("prado2",            "Luis Prado",        "es", "es-ES", "candidate", 202_400,
     "Marca personal en LinkedIn."),
    ("gianlucarosania",   "Gianluca Rosania",  "es", "es-ES", "candidate", 141_100,
     "Reclutamiento y marca personal."),
    ("sandradiazgonzalez", "Sandra Díaz",      "es", "es-ES", "candidate",  92_100,
     "Headhunter y talent acquisition."),

    # ── HISPAM · comunicación interna (core del posicionamiento de Humand) ───
    ("susanacaceres",     "Susana Cáceres",    "hispam", "es-AR", "hr_leader", 30_000,
     "Referente regional de comunicación interna. Socia directora de Internal (Chile)."),
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
    rows = []
    for handle, name, region, language, audience, followers, note in REFERENTES:
        declared = f"{followers:,}".replace(",", ".")
        rows.append((
            "linkedin",
            "profile",
            handle,
            name,
            region,
            language,
            audience,
            # 25 posts por perfil: suficiente para tener mediana (el ranking
            # exige >=5 posts maduros) sin estirar la corrida. En LinkedIn el
            # costo por post es marginal, el limitante es el tiempo del run.
            25,
            40,
            True,
            "approved",
            f"~{declared} seg. en LinkedIn segun listas del sector. {note}",
            SEED_TAG,
        ))
    return rows


def main() -> int:
    rows = build_rows()

    if "--dry-run" in sys.argv:
        by_aud: dict[str, int] = {}
        print(f"-- {len(rows)} referentes de LinkedIn\n")
        for handle, name, region, language, audience, followers, note in REFERENTES:
            by_aud[audience] = by_aud.get(audience, 0) + 1
            declared = f"{followers:,}".replace(",", ".")
            print(f"  {region:7} {audience:10} {declared:>9}  {handle:<26} {name}")
        print(f"\n  por audiencia: {by_aud}")
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
        print(f"✓ {len(rows)} referentes de LinkedIn aprobados.")
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
