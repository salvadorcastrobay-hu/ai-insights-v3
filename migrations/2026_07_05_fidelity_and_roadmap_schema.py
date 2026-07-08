"""
Migration: schema para fidelidad total de taxonomia + roadmap real de Notion.

Contexto completo en el plan de la sesion. Resumen de lo que agrega:

  - transcript_insights: speaker_role, faq_answer, roadmap_match_id (nuevas
    columnas, todas nullable, no tocan filas existentes). faq_topic queda
    tal cual (no se dropea -- ver decision explicita: mas seguro no perder
    datos irreversiblemente por una limpieza cosmetica).
  - tax_pain_subtypes / tax_deal_friction_subtypes / tax_faq_subtypes:
    is_seed + created_at (mismo patron que ya tiene tax_feature_names), para
    que insert_new_subtype() pueda marcar codigos nuevos como no-seed.
  - tax_roadmap_features: tabla nueva, se siembra aparte desde
    data/roadmap_features.csv (scripts/import_roadmap_csv.py ya la genero).

Todo es aditivo e idempotente (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
EXISTS) -- no borra ni modifica nada existente.

Usage:
    python migrations/2026_07_05_fidelity_and_roadmap_schema.py --dry-run
    python migrations/2026_07_05_fidelity_and_roadmap_schema.py
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


SQL_TRANSCRIPT_INSIGHTS_COLUMNS = """
ALTER TABLE transcript_insights
    ADD COLUMN IF NOT EXISTS speaker_role text,
    ADD COLUMN IF NOT EXISTS faq_answer text,
    ADD COLUMN IF NOT EXISTS roadmap_match_id text;
"""

SQL_PAIN_SUBTYPES_SEED_COLUMNS = """
ALTER TABLE tax_pain_subtypes
    ADD COLUMN IF NOT EXISTS is_seed boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
"""

SQL_FRICTION_SUBTYPES_SEED_COLUMNS = """
ALTER TABLE tax_deal_friction_subtypes
    ADD COLUMN IF NOT EXISTS is_seed boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
"""

SQL_FAQ_SUBTYPES_SEED_COLUMNS = """
ALTER TABLE tax_faq_subtypes
    ADD COLUMN IF NOT EXISTS is_seed boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
"""

SQL_ROADMAP_FEATURES_TABLE = """
CREATE TABLE IF NOT EXISTS tax_roadmap_features (
    id             text PRIMARY KEY,
    es_feature     text,
    en_feature     text,
    es_description text,
    en_description text,
    status_raw     text,
    status_bucket  text,
    tribe          text,
    created_at     timestamptz DEFAULT now()
);
"""

STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '120s';"),
    ("transcript_insights: speaker_role, faq_answer, roadmap_match_id", SQL_TRANSCRIPT_INSIGHTS_COLUMNS),
    ("tax_pain_subtypes: is_seed, created_at", SQL_PAIN_SUBTYPES_SEED_COLUMNS),
    ("tax_deal_friction_subtypes: is_seed, created_at", SQL_FRICTION_SUBTYPES_SEED_COLUMNS),
    ("tax_faq_subtypes: is_seed, created_at", SQL_FAQ_SUBTYPES_SEED_COLUMNS),
    ("tax_roadmap_features: create table", SQL_ROADMAP_FEATURES_TABLE),
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
