-- ============================================================
-- QUERIES DE ANÁLISIS - Transcript Insights
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. RESUMEN GENERAL
-- ────────────────────────────────────────────────────────────

-- 1.1 Total de insights por tipo
SELECT
    i.insight_type,
    CASE i.insight_type
        WHEN 'pain' THEN 'Dolor / Problema'
        WHEN 'product_gap' THEN 'Feature Faltante'
        WHEN 'competitive_signal' THEN 'Señal Competitiva'
        WHEN 'deal_friction' THEN 'Fricción del Deal'
        WHEN 'faq' THEN 'Pregunta Frecuente'
    END AS tipo,
    COUNT(*) AS total,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
FROM transcript_insights i
GROUP BY i.insight_type
ORDER BY total DESC;

-- 1.2 Insights por mes
SELECT
    DATE_TRUNC('month', call_date) AS mes,
    COUNT(*) AS total_insights,
    COUNT(DISTINCT transcript_id) AS transcripts
FROM transcript_insights
WHERE call_date IS NOT NULL
GROUP BY mes
ORDER BY mes DESC;


-- ────────────────────────────────────────────────────────────
-- 2. PAINS
-- ────────────────────────────────────────────────────────────

-- 2.1 Top 10 pains globales con display name
SELECT
    i.insight_subtype AS pain_code,
    COALESCE(ps.display_name, i.insight_subtype) AS pain,
    ps.theme,
    COUNT(*) AS total,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct,
    ROUND(AVG(i.confidence), 2) AS avg_confidence
FROM transcript_insights i
LEFT JOIN tax_pain_subtypes ps ON ps.code = i.insight_subtype
WHERE i.insight_type = 'pain'
GROUP BY i.insight_subtype, ps.display_name, ps.theme
ORDER BY total DESC
LIMIT 10;

-- 2.2 Top 5 pains por región
SELECT *
FROM (
    SELECT
        i.region,
        i.insight_subtype AS pain_code,
        COALESCE(ps.display_name, i.insight_subtype) AS pain,
        COUNT(*) AS total,
        ROW_NUMBER() OVER (PARTITION BY i.region ORDER BY COUNT(*) DESC) AS rn
    FROM transcript_insights i
    LEFT JOIN tax_pain_subtypes ps ON ps.code = i.insight_subtype
    WHERE i.insight_type = 'pain'
      AND i.region IS NOT NULL
    GROUP BY i.region, i.insight_subtype, ps.display_name
) ranked
WHERE rn <= 5
ORDER BY region, rn;

-- 2.3 Pains por categoría HR
SELECT
    hc.display_name AS hr_category,
    COALESCE(ps.display_name, i.insight_subtype) AS pain,
    COUNT(*) AS total
FROM transcript_insights i
LEFT JOIN tax_pain_subtypes ps ON ps.code = i.insight_subtype
LEFT JOIN tax_modules m ON m.code = i.module
LEFT JOIN tax_hr_categories hc ON hc.code = m.hr_category
WHERE i.insight_type = 'pain'
  AND m.hr_category IS NOT NULL
GROUP BY hc.display_name, ps.display_name, i.insight_subtype
ORDER BY hc.display_name, total DESC;

-- 2.4 Pains por industria (top 5 por industria)
SELECT *
FROM (
    SELECT
        i.industry,
        COALESCE(ps.display_name, i.insight_subtype) AS pain,
        COUNT(*) AS total,
        ROW_NUMBER() OVER (PARTITION BY i.industry ORDER BY COUNT(*) DESC) AS rn
    FROM transcript_insights i
    LEFT JOIN tax_pain_subtypes ps ON ps.code = i.insight_subtype
    WHERE i.insight_type = 'pain'
      AND i.industry IS NOT NULL
    GROUP BY i.industry, ps.display_name, i.insight_subtype
) ranked
WHERE rn <= 5
ORDER BY industry, rn;


-- ────────────────────────────────────────────────────────────
-- 3. PRODUCT GAPS (Features Faltantes)
-- ────────────────────────────────────────────────────────────

-- 3.1 Top features más pedidas
SELECT
    i.feature_name,
    COALESCE(fn.display_name, i.feature_name) AS feature,
    COALESCE(m.display_name, i.module) AS modulo,
    COUNT(*) AS total,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct,
    SUM(CASE WHEN i.gap_priority = 'dealbreaker' THEN 1 ELSE 0 END) AS dealbreakers,
    SUM(CASE WHEN i.gap_priority = 'must_have' THEN 1 ELSE 0 END) AS must_haves
FROM transcript_insights i
LEFT JOIN tax_feature_names fn ON fn.code = i.feature_name
LEFT JOIN tax_modules m ON m.code = i.module
WHERE i.insight_type = 'product_gap'
  AND i.feature_name IS NOT NULL
GROUP BY i.feature_name, fn.display_name, m.display_name, i.module
ORDER BY total DESC
LIMIT 20;

-- 3.2 Product gaps por módulo
SELECT
    COALESCE(m.display_name, i.module) AS modulo,
    hc.display_name AS hr_category,
    m.status AS module_status,
    COUNT(*) AS total_gaps,
    COUNT(DISTINCT i.feature_name) AS features_distintos
FROM transcript_insights i
LEFT JOIN tax_modules m ON m.code = i.module
LEFT JOIN tax_hr_categories hc ON hc.code = m.hr_category
WHERE i.insight_type = 'product_gap'
  AND i.module IS NOT NULL
GROUP BY m.display_name, i.module, hc.display_name, m.status
ORDER BY total_gaps DESC;

-- 3.3 Features nuevas descubiertas (no seed)
SELECT
    fn.code,
    fn.display_name AS feature,
    COALESCE(m.display_name, fn.suggested_module) AS modulo,
    COUNT(i.id) AS menciones
FROM tax_feature_names fn
LEFT JOIN transcript_insights i ON i.feature_name = fn.code
LEFT JOIN tax_modules m ON m.code = fn.suggested_module
WHERE fn.is_seed = false
GROUP BY fn.code, fn.display_name, m.display_name, fn.suggested_module
ORDER BY menciones DESC
LIMIT 30;

-- 3.4 Product gaps por prioridad
SELECT
    CASE i.gap_priority
        WHEN 'dealbreaker' THEN '🔴 Dealbreaker'
        WHEN 'must_have' THEN '🟡 Must Have'
        WHEN 'nice_to_have' THEN '🟢 Nice to Have'
    END AS prioridad,
    COUNT(*) AS total,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
FROM transcript_insights i
WHERE i.insight_type = 'product_gap'
  AND i.gap_priority IS NOT NULL
GROUP BY i.gap_priority
ORDER BY total DESC;


-- ────────────────────────────────────────────────────────────
-- 4. SEÑALES COMPETITIVAS
-- ────────────────────────────────────────────────────────────

-- 4.1 Top competidores mencionados
SELECT
    i.competitor_name,
    tc.region AS competitor_region,
    COUNT(*) AS menciones,
    COUNT(DISTINCT i.transcript_id) AS en_transcripts,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
FROM transcript_insights i
LEFT JOIN tax_competitors tc ON tc.name = i.competitor_name
WHERE i.insight_type = 'competitive_signal'
  AND i.competitor_name IS NOT NULL
GROUP BY i.competitor_name, tc.region
ORDER BY menciones DESC
LIMIT 20;

-- 4.2 Competidores por tipo de relación
SELECT
    i.competitor_name,
    COALESCE(cr.display_name, i.competitor_relationship) AS relacion,
    COUNT(*) AS total
FROM transcript_insights i
LEFT JOIN tax_competitive_relationships cr ON cr.code = i.competitor_relationship
WHERE i.insight_type = 'competitive_signal'
  AND i.competitor_name IS NOT NULL
GROUP BY i.competitor_name, cr.display_name, i.competitor_relationship
ORDER BY i.competitor_name, total DESC;

-- 4.3 Competidores por región del deal
SELECT
    i.region AS deal_region,
    i.competitor_name,
    COUNT(*) AS menciones
FROM transcript_insights i
WHERE i.insight_type = 'competitive_signal'
  AND i.competitor_name IS NOT NULL
  AND i.region IS NOT NULL
GROUP BY i.region, i.competitor_name
ORDER BY i.region, menciones DESC;

-- 4.4 "Migrando desde" - oportunidades de reemplazo
SELECT
    i.competitor_name,
    COUNT(*) AS migraciones,
    COUNT(DISTINCT i.transcript_id) AS deals_afectados
FROM transcript_insights i
WHERE i.insight_type = 'competitive_signal'
  AND i.competitor_relationship = 'migrating_from'
GROUP BY i.competitor_name
ORDER BY migraciones DESC;


-- ────────────────────────────────────────────────────────────
-- 5. FRICCIÓN DEL DEAL
-- ────────────────────────────────────────────────────────────

-- 5.1 Top fricciones
SELECT
    i.insight_subtype AS friction_code,
    COALESCE(df.display_name, i.insight_subtype) AS friccion,
    COUNT(*) AS total,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
FROM transcript_insights i
LEFT JOIN tax_deal_friction_subtypes df ON df.code = i.insight_subtype
WHERE i.insight_type = 'deal_friction'
GROUP BY i.insight_subtype, df.display_name
ORDER BY total DESC;

-- 5.2 Fricciones por etapa del deal
SELECT
    i.deal_stage,
    COALESCE(df.display_name, i.insight_subtype) AS friccion,
    COUNT(*) AS total
FROM transcript_insights i
LEFT JOIN tax_deal_friction_subtypes df ON df.code = i.insight_subtype
WHERE i.insight_type = 'deal_friction'
  AND i.deal_stage IS NOT NULL
GROUP BY i.deal_stage, df.display_name, i.insight_subtype
ORDER BY i.deal_stage, total DESC;

-- 5.3 Fricciones por región
SELECT
    i.region,
    COALESCE(df.display_name, i.insight_subtype) AS friccion,
    COUNT(*) AS total
FROM transcript_insights i
LEFT JOIN tax_deal_friction_subtypes df ON df.code = i.insight_subtype
WHERE i.insight_type = 'deal_friction'
  AND i.region IS NOT NULL
GROUP BY i.region, df.display_name, i.insight_subtype
ORDER BY i.region, total DESC;


-- ────────────────────────────────────────────────────────────
-- 6. FAQs
-- ────────────────────────────────────────────────────────────

-- 6.1 Top preguntas frecuentes
SELECT
    i.insight_subtype AS faq_code,
    COALESCE(fq.display_name, i.insight_subtype) AS tema_faq,
    COUNT(*) AS total,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
FROM transcript_insights i
LEFT JOIN tax_faq_subtypes fq ON fq.code = i.insight_subtype
WHERE i.insight_type = 'faq'
GROUP BY i.insight_subtype, fq.display_name
ORDER BY total DESC;

-- 6.2 FAQs por región
SELECT *
FROM (
    SELECT
        i.region,
        COALESCE(fq.display_name, i.insight_subtype) AS tema_faq,
        COUNT(*) AS total,
        ROW_NUMBER() OVER (PARTITION BY i.region ORDER BY COUNT(*) DESC) AS rn
    FROM transcript_insights i
    LEFT JOIN tax_faq_subtypes fq ON fq.code = i.insight_subtype
    WHERE i.insight_type = 'faq'
      AND i.region IS NOT NULL
    GROUP BY i.region, fq.display_name, i.insight_subtype
) ranked
WHERE rn <= 5
ORDER BY region, rn;


-- ────────────────────────────────────────────────────────────
-- 7. MÓDULOS
-- ────────────────────────────────────────────────────────────

-- 7.1 Módulos más mencionados (todos los insight types)
SELECT
    COALESCE(m.display_name, i.module) AS modulo,
    hc.display_name AS hr_category,
    m.status AS module_status,
    COUNT(*) AS total_insights,
    SUM(CASE WHEN i.insight_type = 'pain' THEN 1 ELSE 0 END) AS pains,
    SUM(CASE WHEN i.insight_type = 'product_gap' THEN 1 ELSE 0 END) AS gaps,
    SUM(CASE WHEN i.insight_type = 'faq' THEN 1 ELSE 0 END) AS faqs
FROM transcript_insights i
LEFT JOIN tax_modules m ON m.code = i.module
LEFT JOIN tax_hr_categories hc ON hc.code = m.hr_category
WHERE i.module IS NOT NULL
GROUP BY m.display_name, i.module, hc.display_name, m.status
ORDER BY total_insights DESC;

-- 7.2 Módulos missing más demandados
SELECT
    COALESCE(m.display_name, i.module) AS modulo,
    hc.display_name AS hr_category,
    COUNT(*) AS menciones,
    COUNT(DISTINCT i.transcript_id) AS en_transcripts
FROM transcript_insights i
LEFT JOIN tax_modules m ON m.code = i.module
LEFT JOIN tax_hr_categories hc ON hc.code = m.hr_category
WHERE i.module IS NOT NULL
  AND m.status = 'missing'
GROUP BY m.display_name, i.module, hc.display_name
ORDER BY menciones DESC;


-- ────────────────────────────────────────────────────────────
-- 8. POR DEAL OWNER / SALES REP
-- ────────────────────────────────────────────────────────────

-- 8.1 Insights por deal owner
SELECT
    i.deal_owner,
    COUNT(DISTINCT i.transcript_id) AS transcripts,
    COUNT(*) AS total_insights,
    SUM(CASE WHEN i.insight_type = 'pain' THEN 1 ELSE 0 END) AS pains,
    SUM(CASE WHEN i.insight_type = 'competitive_signal' THEN 1 ELSE 0 END) AS competitive,
    SUM(CASE WHEN i.insight_type = 'deal_friction' THEN 1 ELSE 0 END) AS friction
FROM transcript_insights i
WHERE i.deal_owner IS NOT NULL
GROUP BY i.deal_owner
ORDER BY transcripts DESC;


-- ────────────────────────────────────────────────────────────
-- 9. ANÁLISIS CRUZADOS
-- ────────────────────────────────────────────────────────────

-- 9.1 Dolor + Competidor: ¿qué pains mencionan junto a cada competidor?
SELECT
    i_comp.competitor_name,
    COALESCE(ps.display_name, i_pain.insight_subtype) AS pain,
    COUNT(*) AS co_ocurrencias
FROM transcript_insights i_comp
JOIN transcript_insights i_pain
    ON i_comp.transcript_id = i_pain.transcript_id
    AND i_pain.insight_type = 'pain'
LEFT JOIN tax_pain_subtypes ps ON ps.code = i_pain.insight_subtype
WHERE i_comp.insight_type = 'competitive_signal'
  AND i_comp.competitor_name IS NOT NULL
GROUP BY i_comp.competitor_name, ps.display_name, i_pain.insight_subtype
ORDER BY i_comp.competitor_name, co_ocurrencias DESC;

-- 9.2 Deals con más fricciones (potencial riesgo)
SELECT
    i.deal_id,
    i.deal_name,
    i.company_name,
    i.deal_stage,
    COUNT(*) AS total_frictions,
    STRING_AGG(DISTINCT COALESCE(df.display_name, i.insight_subtype), ', ') AS tipos_friccion
FROM transcript_insights i
LEFT JOIN tax_deal_friction_subtypes df ON df.code = i.insight_subtype
WHERE i.insight_type = 'deal_friction'
  AND i.deal_id IS NOT NULL
GROUP BY i.deal_id, i.deal_name, i.company_name, i.deal_stage
ORDER BY total_frictions DESC
LIMIT 20;

-- 9.3 Transcripts con más insights (calls más ricas)
SELECT
    i.transcript_id,
    i.deal_name,
    i.company_name,
    i.call_date,
    COUNT(*) AS total_insights,
    COUNT(DISTINCT i.insight_type) AS tipos_distintos
FROM transcript_insights i
GROUP BY i.transcript_id, i.deal_name, i.company_name, i.call_date
ORDER BY total_insights DESC
LIMIT 20;

-- 9.4 Pain → Product Gap: ¿qué dolores generan pedidos de features?
SELECT
    COALESCE(ps.display_name, i_pain.insight_subtype) AS pain,
    COALESCE(fn.display_name, i_gap.feature_name) AS feature_pedida,
    COUNT(*) AS co_ocurrencias
FROM transcript_insights i_pain
JOIN transcript_insights i_gap
    ON i_pain.transcript_id = i_gap.transcript_id
    AND i_gap.insight_type = 'product_gap'
LEFT JOIN tax_pain_subtypes ps ON ps.code = i_pain.insight_subtype
LEFT JOIN tax_feature_names fn ON fn.code = i_gap.feature_name
WHERE i_pain.insight_type = 'pain'
GROUP BY ps.display_name, i_pain.insight_subtype, fn.display_name, i_gap.feature_name
ORDER BY co_ocurrencias DESC
LIMIT 20;
