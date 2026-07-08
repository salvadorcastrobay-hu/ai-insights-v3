"""
Migration: agregar tax_roadmap_features a v_insights_dashboard.

speaker_role, faq_answer y roadmap_match_id ya fluyen automatico via "i.*"
(son columnas nuevas en transcript_insights). Lo unico que hace falta es el
JOIN para resolver el status/nombre del roadmap real de Notion a partir de
roadmap_match_id -- mismo patron que ya existe para module_status
(tax_modules) y feature_display (tax_feature_names).

CREATE OR REPLACE VIEW es seguro aca: solo agrega columnas nuevas al final,
no cambia tipos ni orden de las existentes, no corta lecturas en curso.

Usage:
    python migrations/2026_07_05_roadmap_view_join.py --dry-run
    python migrations/2026_07_05_roadmap_view_join.py
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


SQL_VIEW = """
CREATE OR REPLACE VIEW v_insights_dashboard AS
SELECT
    -- Explicit column list (NOT i.*): CREATE OR REPLACE VIEW requires stable
    -- column names/order at each position. i.* dynamically re-expands to
    -- whatever transcript_insights has *now*, which breaks the replace the
    -- moment a new column gets added to the table (as just happened here).
    -- Listing the original 32 columns explicitly freezes those positions;
    -- every new addition goes at the very end of the SELECT list instead.
    i.id, i.transcript_id, i.transcript_chunk, i.deal_id, i.deal_name,
    i.company_name, i.region, i.country, i.industry, i.company_size,
    i.deal_stage, i.deal_owner, i.call_date, i.insight_type, i.insight_subtype,
    i.module, i.summary, i.verbatim_quote, i.confidence, i.competitor_name,
    i.competitor_relationship, i.feature_name, i.gap_description, i.gap_priority,
    i.faq_topic, i.model_used, i.prompt_version, i.batch_id, i.content_hash,
    i.processed_at, i.segment, i.amount,
    -- Deal fields from raw_deals (always up-to-date)
    d.pipeline          AS deal_pipeline,
    d.create_date       AS deal_create_date,
    d.close_date        AS deal_close_date,
    d.owner_name        AS cx_owner,
    d.ae_owner_name,
    -- Taxonomy display names
    CASE i.insight_type
        WHEN 'pain' THEN 'Dolor / Problema'
        WHEN 'product_gap' THEN 'Feature Faltante'
        WHEN 'competitive_signal' THEN 'Senal Competitiva'
        WHEN 'deal_friction' THEN 'Friccion del Deal'
        WHEN 'faq' THEN 'Pregunta Frecuente'
    END AS insight_type_display,
    COALESCE(ps.display_name, df.display_name, fq.display_name, cr.display_name, i.insight_subtype)
        AS insight_subtype_display,
    m.display_name  AS module_display,
    m.status        AS module_status,
    m.hr_category   AS hr_category,
    hc.display_name AS hr_category_display,
    ps.theme        AS pain_theme,
    CASE WHEN ps.module IS NOT NULL THEN 'module_linked' ELSE 'general' END AS pain_scope,
    fn.display_name AS feature_display,
    fn.is_seed      AS feature_is_seed,
    crel.display_name AS competitor_relationship_display,
    -- New columns go at the very end only -- see note above.
    i.speaker_role, i.faq_answer, i.roadmap_match_id,
    rf.status_bucket AS roadmap_status_display,
    COALESCE(rf.es_feature, rf.en_feature) AS roadmap_feature_display
FROM transcript_insights i
LEFT JOIN raw_deals d ON i.deal_id = d.deal_id
LEFT JOIN tax_modules m ON i.module = m.code
LEFT JOIN tax_hr_categories hc ON m.hr_category = hc.code
LEFT JOIN tax_pain_subtypes ps ON i.insight_subtype = ps.code AND i.insight_type = 'pain'
LEFT JOIN tax_deal_friction_subtypes df ON i.insight_subtype = df.code AND i.insight_type = 'deal_friction'
LEFT JOIN tax_faq_subtypes fq ON i.insight_subtype = fq.code AND i.insight_type = 'faq'
LEFT JOIN tax_competitive_relationships cr ON i.insight_subtype = cr.code AND i.insight_type = 'competitive_signal'
LEFT JOIN tax_competitive_relationships crel ON i.competitor_relationship = crel.code
LEFT JOIN tax_feature_names fn ON i.feature_name = fn.code
LEFT JOIN tax_roadmap_features rf ON i.roadmap_match_id = rf.id;
"""

STEPS = [
    ("session settings", "SET search_path TO public; SET statement_timeout = '60s';"),
    ("v_insights_dashboard: add tax_roadmap_features join", SQL_VIEW),
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
        print("\n✓ v_insights_dashboard updated successfully.")
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
