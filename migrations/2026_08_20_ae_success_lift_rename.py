"""
Migration: renombrar validated_lift -> success_lift y demos_validated -> demos_success
en las tablas derivadas del AE Playbook.

POR QUE
-------
La metrica se definia sobre is_validated. Medido sobre HISPAM, is_validated cubre
el 78.9% de los transcripts (6438/8161): no es una señal de exito sino un flag de
higiene, y con esa tasa base el lift maximo posible es 1/0.789 = 1.27, o sea todo
cae entre 0.9 y 1.2 y no distingue nada. La metrica por default paso a 'won'
(12.7%, lift maximo 7.87), asi que el nombre de la columna quedo mintiendo.

Se hace como migracion aparte y no editando 2026_08_19_ae_speech_units.py porque
esa ya esta aplicada en produccion: un CREATE TABLE IF NOT EXISTS editado seria un
no-op y el archivo dejaria de describir el schema real.

Seguro de correr: las tres tablas derivadas estan vacias (todavia no hay writer de
la Fase 4). No toca ae_speech_units ni ae_term_usages.

Usage:
    python migrations/2026_08_20_ae_success_lift_rename.py --dry-run
    python migrations/2026_08_20_ae_success_lift_rename.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


# DO $$ ... $$ con chequeo de existencia: ALTER TABLE RENAME COLUMN no tiene
# IF EXISTS, y sin el guard la migracion no es re-corrible.
def _rename(tabla: str, viejo: str, nuevo: str) -> str:
    return f"""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '{tabla}' AND column_name = '{viejo}'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '{tabla}' AND column_name = '{nuevo}'
    ) THEN
        ALTER TABLE {tabla} RENAME COLUMN {viejo} TO {nuevo};
    END IF;
END $$;
"""


STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '60s';"),
    ("ae_glossary_terms: demos_validated -> demos_success",
     _rename("ae_glossary_terms", "demos_validated", "demos_success")),
    ("ae_pitch_patterns: demos_validated -> demos_success",
     _rename("ae_pitch_patterns", "demos_validated", "demos_success")),
    ("ae_pitch_patterns: validated_lift -> success_lift",
     _rename("ae_pitch_patterns", "validated_lift", "success_lift")),
    ("ae_faq_canonical: demos_validated -> demos_success",
     _rename("ae_faq_canonical", "demos_validated", "demos_success")),
    # Que metrica se uso para calcular success_lift. Sin esto, dos filas con
    # lift 1.4 no son comparables si una se calculo sobre won y otra sobre
    # validated, y no hay forma de saberlo despues.
    ("ae_pitch_patterns: success_metric",
     "ALTER TABLE ae_pitch_patterns ADD COLUMN IF NOT EXISTS success_metric text DEFAULT 'won';"),
    ("ae_glossary_terms: success_metric",
     "ALTER TABLE ae_glossary_terms ADD COLUMN IF NOT EXISTS success_metric text DEFAULT 'won';"),
    ("ae_faq_canonical: success_metric",
     "ALTER TABLE ae_faq_canonical ADD COLUMN IF NOT EXISTS success_metric text DEFAULT 'won';"),
]


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    if dry_run:
        print("=" * 60)
        print("DRY RUN -- printing SQL, NOT executing")
        print("=" * 60)
        for label, sql in STEPS:
            print(f"\n── {label} ──")
            print(sql)
        return 0

    import config  # noqa: E402
    import psycopg2  # noqa: E402

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        for i, (label, sql) in enumerate(STEPS, 1):
            print(f"[{i}/{len(STEPS)}] Applying: {label}...")
            cur.execute(sql)
        conn.commit()
        print("\n✓ Migration applied successfully.")
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Migration failed (rolled back): {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
