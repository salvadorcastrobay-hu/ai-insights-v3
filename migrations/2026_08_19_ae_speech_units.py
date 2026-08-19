"""
Migration: capa AE-side del playbook (como habla el equipo de Sales).

CONTEXTO
--------
El pipeline actual es lead-centric: los 5 insight_types de transcript_insights
capturan lo que dice el PROSPECTO. Sales necesita lo inverso -- como los AEs
explican Humand, que terminos usan, como responden preguntas y objeciones --
para armar un playbook y alimentar la base de conocimiento de un bot de WhatsApp
que califica leads.

POR QUE TABLAS NUEVAS Y NO MAS insight_types
--------------------------------------------
mv_insights_norm, sus RPCs y ~14 vistas del dashboard asumen la forma actual de
transcript_insights. Meter unidades de discurso del AE ahi contamina todos los
conteos ("total de insights", "insights por demo", "% de demos con FAQ") sin
ganar nada, y obliga a rebuildear la MV. Se aisla, mismo patron que
competitor_ads / competitor_organic_posts.

TABLAS
------
  ae_speech_units    -- una fila por unidad de discurso del AE (grano fino,
                        append-only, versionada por ae_prompt_version)
  ae_glossary_terms  -- glosario canonicalizado (derivado, se recalcula)
  ae_pitch_patterns  -- formas de explicar, agrupadas (derivado)
  ae_faq_canonical   -- pregunta canonica + respuestas de AEs (derivado)

Las tres derivadas llevan `human_status`: el endpoint que consume el bot sirve
SOLO las filas approved. Es lo que separa "borrador de LLM" de "algo que le
habla a un lead real".

Todo aditivo e idempotente. No toca transcript_insights ni la MV.

Usage:
    python migrations/2026_08_19_ae_speech_units.py --dry-run
    python migrations/2026_08_19_ae_speech_units.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


SQL_SPEECH_UNITS = """
CREATE TABLE IF NOT EXISTS ae_speech_units (
    id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    transcript_id      text NOT NULL,
    transcript_chunk   integer NOT NULL DEFAULT 0,

    -- Snapshot de metadata del deal al momento de extraer. Denormalizado a
    -- proposito: igual que transcript_insights, para poder filtrar/agrupar sin
    -- joinear a raw_deals ni depender del refresh de la MV.
    deal_id            text,
    company_name       text,
    region             text,
    country            text,
    industry           text,
    segment            text,
    deal_stage         text,
    deal_owner         text,
    call_date          date,
    is_validated       boolean,

    unit_type          text NOT NULL CHECK (unit_type IN (
                           'pitch_company', 'pitch_module', 'faq_answer',
                           'objection_handling', 'discovery_question', 'proof_point')),
    module             text,
    verbatim_quote     text NOT NULL,
    paraphrase         text,
    trigger_quote      text,
    speaker_name       text,
    confidence         real CHECK (confidence BETWEEN 0 AND 1),

    -- Resultado del chequeo deterministico de src/skills/ae_fidelity.py: si la
    -- cita aparece literal en el chunk. Se persiste para poder filtrar el pack a
    -- unidades verificadas sin recomputar contra el transcript.
    is_literal         boolean,
    attribution        text CHECK (attribution IN ('ok', 'mismatch', 'sin_dato')),

    model_used         text NOT NULL,
    ae_prompt_version  text NOT NULL,
    batch_id           text,
    content_hash       text,
    processed_at       timestamptz DEFAULT now()
);

-- Idempotencia del pipeline: mismo criterio que idx_insights_content_hash.
CREATE UNIQUE INDEX IF NOT EXISTS ae_speech_units_hash_uidx
    ON ae_speech_units (content_hash);
CREATE INDEX IF NOT EXISTS ae_speech_units_type_idx     ON ae_speech_units (unit_type);
CREATE INDEX IF NOT EXISTS ae_speech_units_module_idx   ON ae_speech_units (module);
CREATE INDEX IF NOT EXISTS ae_speech_units_region_idx   ON ae_speech_units (region);
CREATE INDEX IF NOT EXISTS ae_speech_units_owner_idx    ON ae_speech_units (deal_owner);
CREATE INDEX IF NOT EXISTS ae_speech_units_validated_idx ON ae_speech_units (is_validated);
CREATE INDEX IF NOT EXISTS ae_speech_units_version_idx  ON ae_speech_units (ae_prompt_version);
CREATE INDEX IF NOT EXISTS ae_speech_units_transcript_idx ON ae_speech_units (transcript_id);
"""

SQL_TERM_USAGES = """
-- Terminos tal como los uso el AE, uno por fila. Tabla hija: una unidad puede
-- traer varios terminos y se necesita agregarlos por termino, no por unidad.
CREATE TABLE IF NOT EXISTS ae_term_usages (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    unit_id       uuid NOT NULL REFERENCES ae_speech_units(id) ON DELETE CASCADE,
    term          text NOT NULL,
    term_norm     text NOT NULL,
    module        text,
    gloss         text,
    created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ae_term_usages_norm_idx ON ae_term_usages (term_norm);
CREATE INDEX IF NOT EXISTS ae_term_usages_unit_idx ON ae_term_usages (unit_id);
"""

SQL_GLOSSARY = """
CREATE TABLE IF NOT EXISTS ae_glossary_terms (
    id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    term_canonical    text NOT NULL,
    term_norm         text NOT NULL UNIQUE,
    aliases           text[] DEFAULT '{}',
    module            text,
    definition        text,
    example_quote     text,
    usages            integer DEFAULT 0,
    demos             integer DEFAULT 0,
    demos_validated   integer DEFAULT 0,
    markets           text[] DEFAULT '{}',
    human_status      text NOT NULL DEFAULT 'pending'
                          CHECK (human_status IN ('pending', 'approved', 'edited', 'rejected')),
    reviewed_by       text,
    reviewed_at       timestamptz,
    generated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ae_glossary_status_idx ON ae_glossary_terms (human_status);
"""

SQL_PITCH_PATTERNS = """
CREATE TABLE IF NOT EXISTS ae_pitch_patterns (
    id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    unit_type         text NOT NULL,
    module            text,
    label             text NOT NULL,
    description       text NOT NULL,
    when_to_use       text,
    example_quotes    text[] DEFAULT '{}',
    unit_ids          uuid[] DEFAULT '{}',
    demos             integer DEFAULT 0,
    demos_validated   integer DEFAULT 0,
    -- Cuanto mas se usa esta forma de explicar en demos validated que en el
    -- resto. Es el "filtrar por las mas exitosas" del pedido de Marketing.
    validated_lift    real,
    markets           text[] DEFAULT '{}',
    human_status      text NOT NULL DEFAULT 'pending'
                          CHECK (human_status IN ('pending', 'approved', 'edited', 'rejected')),
    reviewed_by       text,
    reviewed_at       timestamptz,
    generated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ae_pitch_status_idx ON ae_pitch_patterns (human_status);
CREATE INDEX IF NOT EXISTS ae_pitch_module_idx ON ae_pitch_patterns (module);
"""

SQL_FAQ_CANONICAL = """
CREATE TABLE IF NOT EXISTS ae_faq_canonical (
    id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    topic                 text,
    question_canonical    text NOT NULL,
    question_variants     text[] DEFAULT '{}',
    ae_answers            text[] DEFAULT '{}',
    answer_recommended    text,
    -- true si los AEs se contradicen: no puede ir al bot sin que producto defina.
    has_conflict          boolean DEFAULT false,
    demos                 integer DEFAULT 0,
    demos_validated       integer DEFAULT 0,
    unanswered            integer DEFAULT 0,
    markets               text[] DEFAULT '{}',
    human_status          text NOT NULL DEFAULT 'pending'
                              CHECK (human_status IN ('pending', 'approved', 'edited', 'rejected')),
    reviewed_by           text,
    reviewed_at           timestamptz,
    generated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ae_faq_canonical_status_idx ON ae_faq_canonical (human_status);
CREATE INDEX IF NOT EXISTS ae_faq_canonical_topic_idx  ON ae_faq_canonical (topic);
"""

STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '120s';"),
    ("ae_speech_units: tabla + indices", SQL_SPEECH_UNITS),
    ("ae_term_usages: tabla + indices", SQL_TERM_USAGES),
    ("ae_glossary_terms: tabla + indices", SQL_GLOSSARY),
    ("ae_pitch_patterns: tabla + indices", SQL_PITCH_PATTERNS),
    ("ae_faq_canonical: tabla + indices", SQL_FAQ_CANONICAL),
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
