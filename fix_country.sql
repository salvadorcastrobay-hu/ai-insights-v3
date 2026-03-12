-- ============================================================
-- Migration: Fix country, deal_owner (AE), add segment & amount
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add new columns to raw_deals
ALTER TABLE raw_deals ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE raw_deals ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE raw_deals ADD COLUMN IF NOT EXISTS segment TEXT;
ALTER TABLE raw_deals ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE raw_deals ADD COLUMN IF NOT EXISTS ae_owner_id TEXT;
ALTER TABLE raw_deals ADD COLUMN IF NOT EXISTS ae_owner_name TEXT;

-- 2. Add new columns to transcript_insights
ALTER TABLE transcript_insights ADD COLUMN IF NOT EXISTS segment TEXT;
ALTER TABLE transcript_insights ADD COLUMN IF NOT EXISTS amount NUMERIC;

-- 3. Update v_transcripts view (deal_owner = AE, country = deal pais, add segment/amount)
--    DROP required because CREATE OR REPLACE cannot add/remove columns
DROP VIEW IF EXISTS v_transcripts;
CREATE VIEW v_transcripts AS
SELECT
    t.recording_id AS transcript_id,
    t.transcript_text,
    m.matched_deal_id AS deal_id,
    d.deal_name,
    c.name AS company_name,
    COALESCE(d.region, c.region) AS region,
    COALESCE(d.country, c.country) AS country,
    d.region AS deal_region,
    d.country AS deal_country,
    c.country AS company_country,
    COALESCE(d.industry, c.industry) AS industry,
    c.company_size,
    d.segment,
    d.amount,
    d.deal_stage,
    d.ae_owner_name AS deal_owner,
    d.owner_name AS cx_owner,
    t.call_date::date AS call_date,
    m.match_method,
    m.match_score
FROM raw_transcripts t
LEFT JOIN call_deal_matches m ON t.recording_id = m.recording_id
LEFT JOIN raw_deals d ON m.matched_deal_id = d.deal_id
LEFT JOIN raw_companies c ON c.company_id = (d.associated_company_ids[1])
WHERE t.team = 'Account Executives';

-- 4. Update v_insights_display view (add segment + amount)
DROP VIEW IF EXISTS v_insights_display;

CREATE VIEW v_insights_display AS
SELECT
    i.id,
    i.transcript_id,
    i.transcript_chunk,
    i.deal_id,
    i.deal_name,
    i.company_name,
    i.region,
    i.country,
    i.industry,
    i.company_size,
    i.deal_stage,
    i.deal_owner,
    i.segment,
    i.amount,
    i.call_date,
    i.insight_type,
    CASE i.insight_type
        WHEN 'pain' THEN 'Dolor / Problema'
        WHEN 'product_gap' THEN 'Feature Faltante'
        WHEN 'competitive_signal' THEN 'Señal Competitiva'
        WHEN 'deal_friction' THEN 'Fricción del Deal'
        WHEN 'faq' THEN 'Pregunta Frecuente'
    END AS insight_type_display,
    i.insight_subtype,
    COALESCE(ps.display_name, df.display_name, fq.display_name, cr.display_name, i.insight_subtype) AS insight_subtype_display,
    i.module,
    m.display_name AS module_display,
    m.status AS module_status,
    m.hr_category,
    hc.display_name AS hr_category_display,
    i.summary,
    i.verbatim_quote,
    i.confidence,
    i.competitor_name,
    i.competitor_relationship,
    cr.display_name AS competitor_relationship_display,
    i.feature_name,
    fn.display_name AS feature_name_display,
    i.gap_description,
    i.gap_priority,
    CASE i.gap_priority
        WHEN 'must_have' THEN 'Debe tener'
        WHEN 'nice_to_have' THEN 'Deseable'
        WHEN 'dealbreaker' THEN 'Dealbreaker'
    END AS gap_priority_display,
    i.faq_topic,
    i.model_used,
    i.processed_at
FROM transcript_insights i
LEFT JOIN tax_modules m ON m.code = i.module
LEFT JOIN tax_hr_categories hc ON hc.code = m.hr_category
LEFT JOIN tax_pain_subtypes ps ON ps.code = i.insight_subtype AND i.insight_type = 'pain'
LEFT JOIN tax_deal_friction_subtypes df ON df.code = i.insight_subtype AND i.insight_type = 'deal_friction'
LEFT JOIN tax_faq_subtypes fq ON fq.code = i.insight_subtype AND i.insight_type = 'faq'
LEFT JOIN tax_competitive_relationships cr ON cr.code = i.insight_subtype AND i.insight_type = 'competitive_signal'
LEFT JOIN tax_feature_names fn ON fn.code = i.feature_name;

-- 5. Update v_insights_dashboard view (add segment + amount)
DROP VIEW IF EXISTS v_insights_dashboard;

CREATE VIEW v_insights_dashboard AS
SELECT
    i.*,
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
    crel.display_name AS competitor_relationship_display
FROM transcript_insights i
LEFT JOIN tax_modules m ON i.module = m.code
LEFT JOIN tax_hr_categories hc ON m.hr_category = hc.code
LEFT JOIN tax_pain_subtypes ps ON i.insight_subtype = ps.code AND i.insight_type = 'pain'
LEFT JOIN tax_deal_friction_subtypes df ON i.insight_subtype = df.code AND i.insight_type = 'deal_friction'
LEFT JOIN tax_faq_subtypes fq ON i.insight_subtype = fq.code AND i.insight_type = 'faq'
LEFT JOIN tax_competitive_relationships cr ON i.insight_subtype = cr.code AND i.insight_type = 'competitive_signal'
LEFT JOIN tax_competitive_relationships crel ON i.competitor_relationship = crel.code
LEFT JOIN tax_feature_names fn ON i.feature_name = fn.code;
