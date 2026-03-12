-- View de insights con todos los display names resueltos
-- Ejecutar en Supabase SQL Editor

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

    -- Insight type + display
    i.insight_type,
    CASE i.insight_type
        WHEN 'pain' THEN 'Dolor / Problema'
        WHEN 'product_gap' THEN 'Feature Faltante'
        WHEN 'competitive_signal' THEN 'Señal Competitiva'
        WHEN 'deal_friction' THEN 'Fricción del Deal'
        WHEN 'faq' THEN 'Pregunta Frecuente'
    END AS insight_type_display,

    -- Subtype + display
    i.insight_subtype,
    COALESCE(ps.display_name, df.display_name, fq.display_name, cr.display_name, i.insight_subtype) AS insight_subtype_display,

    -- Module + display
    i.module,
    m.display_name AS module_display,
    m.status AS module_status,

    -- HR Category
    m.hr_category,
    hc.display_name AS hr_category_display,

    -- Content
    i.summary,
    i.verbatim_quote,
    i.confidence,

    -- Competitive
    i.competitor_name,
    i.competitor_relationship,
    cr.display_name AS competitor_relationship_display,

    -- Product Gap
    i.feature_name,
    fn.display_name AS feature_name_display,
    i.gap_description,
    i.gap_priority,
    CASE i.gap_priority
        WHEN 'must_have' THEN 'Debe tener'
        WHEN 'nice_to_have' THEN 'Deseable'
        WHEN 'dealbreaker' THEN 'Dealbreaker'
    END AS gap_priority_display,

    -- FAQ
    i.faq_topic,

    -- Meta
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
