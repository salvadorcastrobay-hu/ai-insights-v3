"""
Feedback sobre las sugerencias de contenido — sección 10 del brief.

POR QUÉ AHORA Y NO DESPUÉS: la métrica principal que pide el brief es
"% de piezas sugeridas que el equipo aprueba sin cambios". Eso no se puede
reconstruir a posteriori: si el equipo empieza a usar el calendario antes de que
exista este registro, se pierde la línea base y solo queda empezar a medir desde
cero más adelante.

content_suggestion_feedback — qué pasó con cada pieza sugerida.

  La entrada del calendario se guarda ENTERA en `entry` (jsonb), no por
  referencia: el calendario se regenera cada semana y las piezas cambian. Sin el
  snapshot, un "aprobado tal cual" de la semana pasada apuntaría a un texto que
  ya no existe.

  `entry_key` es el hash de (region, month, fecha, título): estable para la
  misma pieza, distinto si se regenera con otro contenido.

content_coverage_snapshots — foto semanal de qué se alcanzó a cubrir.

  Segunda métrica del brief: "cobertura semanal de redes y competidores
  analizados — que el research sea completo, no parcial". Se toma después de
  cada corrida semanal; sin la foto, dentro de un mes no hay forma de saber si
  la cobertura de hace tres semanas fue buena o mala.

Rollback:
    DROP TABLE content_suggestion_feedback, content_coverage_snapshots;

Usage:
    python3 migrations/2026_09_16_content_feedback.py --dry-run
    python3 migrations/2026_09_16_content_feedback.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SQL_FEEDBACK = """
CREATE TABLE IF NOT EXISTS content_suggestion_feedback (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_key       text NOT NULL,
    region          text NOT NULL,
    month           text NOT NULL,          -- YYYY-MM
    publish_date    date,
    -- Snapshot de la pieza tal como se sugirió. El calendario se regenera y
    -- cambia; el feedback tiene que seguir apuntando a lo que la persona vio.
    entry           jsonb NOT NULL,
    state           text NOT NULL DEFAULT 'pending',
    -- Qué cambió, si se aprobó con cambios. Es la señal más útil para mejorar
    -- el generador: no alcanza con saber que se editó.
    edit_note       text,
    -- Se completa cuando la pieza se publica: habilita la cuarta métrica del
    -- brief (performance de lo publicado contra el baseline propio).
    published_url   text,
    decided_by      text,
    decided_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT content_suggestion_feedback_state_chk
        CHECK (state IN ('pending','approved_as_is','approved_edited','rejected','published')),
    CONSTRAINT content_suggestion_feedback_uniq UNIQUE (entry_key)
);

CREATE INDEX IF NOT EXISTS csf_state_idx  ON content_suggestion_feedback (state);
CREATE INDEX IF NOT EXISTS csf_region_idx ON content_suggestion_feedback (region, month);
CREATE INDEX IF NOT EXISTS csf_published_idx
    ON content_suggestion_feedback (published_url) WHERE published_url IS NOT NULL;
"""

SQL_COVERAGE = """
CREATE TABLE IF NOT EXISTS content_coverage_snapshots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    taken_at            timestamptz NOT NULL DEFAULT now(),
    -- Semana ISO a la que corresponde la foto, para no duplicar por corrida.
    week                text NOT NULL,
    platforms_covered   jsonb NOT NULL DEFAULT '[]',
    sources_total       int NOT NULL DEFAULT 0,
    sources_ok          int NOT NULL DEFAULT 0,
    sources_failed      int NOT NULL DEFAULT 0,
    competitors_covered int NOT NULL DEFAULT 0,
    posts_ingested      int NOT NULL DEFAULT 0,
    posts_analyzed      int NOT NULL DEFAULT 0,
    detail              jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT content_coverage_snapshots_uniq UNIQUE (week)
);

CREATE INDEX IF NOT EXISTS ccs_week_idx ON content_coverage_snapshots (week DESC);
"""

SQL_GRANTS = """
GRANT SELECT, INSERT, UPDATE, DELETE ON
    content_suggestion_feedback, content_coverage_snapshots TO service_role;

ALTER TABLE content_suggestion_feedback  ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_coverage_snapshots   ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
"""

STEPS = [
    ("content_suggestion_feedback", SQL_FEEDBACK),
    ("content_coverage_snapshots", SQL_COVERAGE),
    ("grants + RLS + reload", SQL_GRANTS),
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
        print("✓ tablas de feedback y cobertura listas.")
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
