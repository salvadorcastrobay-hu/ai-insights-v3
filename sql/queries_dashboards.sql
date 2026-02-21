-- ============================================================
-- Dashboard Queries - Humand Sales Insights
-- Todas las queries usan v_insights_dashboard (VIEW con JOINs)
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. PRODUCT INTELLIGENCE DASHBOARD
--    Audiencia: Product team, CPO
-- ════════════════════════════════════════════════════════════

-- 1.1 Top Pains por módulo (Heatmap: pain_subtype x module)
-- "¿Dónde duele más?"
SELECT
    module_display,
    hr_category_display,
    insight_subtype_display,
    pain_theme,
    COUNT(*)                          AS mentions,
    ROUND(AVG(confidence)::numeric, 2) AS avg_confidence
FROM v_insights_dashboard
WHERE insight_type = 'pain'
  AND module IS NOT NULL
GROUP BY module_display, hr_category_display, insight_subtype_display, pain_theme
ORDER BY mentions DESC;

-- 1.2 Feature Gaps más pedidos (ranking por prioridad)
-- "¿Qué construir primero?"
SELECT
    feature_display,
    feature_name,
    module_display,
    gap_priority,
    COUNT(*)                                                    AS mentions,
    COUNT(*) FILTER (WHERE gap_priority = 'dealbreaker')        AS dealbreaker_count,
    COUNT(*) FILTER (WHERE gap_priority = 'must_have')          AS must_have_count,
    COUNT(*) FILTER (WHERE gap_priority = 'nice_to_have')       AS nice_to_have_count,
    COUNT(DISTINCT deal_id)                                     AS unique_deals
FROM v_insights_dashboard
WHERE insight_type = 'product_gap'
  AND feature_name IS NOT NULL
GROUP BY feature_display, feature_name, module_display, gap_priority
ORDER BY dealbreaker_count DESC, must_have_count DESC, mentions DESC;

-- 1.2b Feature Gaps consolidado (sin split por prioridad, para ranking limpio)
SELECT
    feature_display,
    feature_name,
    module_display,
    COUNT(*)                                                    AS total_mentions,
    COUNT(*) FILTER (WHERE gap_priority = 'dealbreaker')        AS dealbreakers,
    COUNT(*) FILTER (WHERE gap_priority = 'must_have')          AS must_haves,
    COUNT(*) FILTER (WHERE gap_priority = 'nice_to_have')       AS nice_to_haves,
    COUNT(DISTINCT deal_id)                                     AS unique_deals,
    feature_is_seed
FROM v_insights_dashboard
WHERE insight_type = 'product_gap'
  AND feature_name IS NOT NULL
GROUP BY feature_display, feature_name, module_display, feature_is_seed
ORDER BY dealbreakers DESC, must_haves DESC, total_mentions DESC;

-- 1.3 Módulos missing vs existing
-- "¿Conviene mejorar lo que hay o construir lo que falta?"
SELECT
    module_status,
    module_display,
    hr_category_display,
    COUNT(*)                                                   AS total_insights,
    COUNT(*) FILTER (WHERE insight_type = 'pain')              AS pains,
    COUNT(*) FILTER (WHERE insight_type = 'product_gap')       AS gaps,
    COUNT(DISTINCT deal_id)                                    AS unique_deals,
    COALESCE(SUM(DISTINCT amount), 0)                          AS total_revenue
FROM v_insights_dashboard
WHERE insight_type IN ('pain', 'product_gap')
  AND module IS NOT NULL
GROUP BY module_status, module_display, hr_category_display
ORDER BY module_status, total_insights DESC;

-- 1.3b Resumen agregado missing vs existing
SELECT
    module_status,
    COUNT(*)                                                   AS total_insights,
    COUNT(*) FILTER (WHERE insight_type = 'pain')              AS total_pains,
    COUNT(*) FILTER (WHERE insight_type = 'product_gap')       AS total_gaps,
    COUNT(DISTINCT module)                                     AS modules_count,
    COUNT(DISTINCT deal_id)                                    AS unique_deals
FROM v_insights_dashboard
WHERE insight_type IN ('pain', 'product_gap')
  AND module IS NOT NULL
GROUP BY module_status
ORDER BY module_status;

-- 1.4 Feature Gaps por segmento
-- "¿Enterprise pide cosas distintas que SMB?"
SELECT
    segment,
    feature_display,
    feature_name,
    module_display,
    COUNT(*)                                                    AS mentions,
    COUNT(*) FILTER (WHERE gap_priority = 'dealbreaker')        AS dealbreakers,
    COUNT(*) FILTER (WHERE gap_priority = 'must_have')          AS must_haves,
    COUNT(DISTINCT deal_id)                                     AS unique_deals
FROM v_insights_dashboard
WHERE insight_type = 'product_gap'
  AND feature_name IS NOT NULL
  AND segment IS NOT NULL
GROUP BY segment, feature_display, feature_name, module_display
ORDER BY segment, mentions DESC;

-- 1.5 Revenue at stake por feature gap
-- "¿Cuánto revenue depende de esta feature?"
SELECT
    feature_display,
    feature_name,
    module_display,
    COUNT(*)                    AS mentions,
    COUNT(DISTINCT deal_id)     AS unique_deals,
    COALESCE(SUM(amount), 0)    AS total_revenue_at_stake,
    COALESCE(AVG(amount), 0)    AS avg_deal_size,
    COUNT(*) FILTER (WHERE gap_priority = 'dealbreaker') AS dealbreakers
FROM v_insights_dashboard
WHERE insight_type = 'product_gap'
  AND feature_name IS NOT NULL
  AND deal_id IS NOT NULL
GROUP BY feature_display, feature_name, module_display
ORDER BY total_revenue_at_stake DESC;


-- ════════════════════════════════════════════════════════════
-- 2. COMPETITIVE INTELLIGENCE DASHBOARD
--    Audiencia: Sales leadership, Marketing, Strategy
-- ════════════════════════════════════════════════════════════

-- 2.1 Market share de competidores (ranking + breakdown por relación)
SELECT
    competitor_name,
    COUNT(*)                                                          AS total_mentions,
    COUNT(*) FILTER (WHERE competitor_relationship = 'currently_using')  AS currently_using,
    COUNT(*) FILTER (WHERE competitor_relationship = 'evaluating')       AS evaluating,
    COUNT(*) FILTER (WHERE competitor_relationship = 'migrating_from')   AS migrating_from,
    COUNT(*) FILTER (WHERE competitor_relationship = 'migrating_to')     AS migrating_to,
    COUNT(*) FILTER (WHERE competitor_relationship = 'replaced')         AS replaced,
    COUNT(*) FILTER (WHERE competitor_relationship = 'mentioned')        AS mentioned,
    COUNT(DISTINCT deal_id)                                              AS unique_deals
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_name IS NOT NULL
GROUP BY competitor_name
ORDER BY total_mentions DESC;

-- 2.2 Competidores por región/país
SELECT
    COALESCE(region, 'Sin región')   AS region,
    COALESCE(country, 'Sin país')    AS country,
    competitor_name,
    COUNT(*)                          AS mentions,
    COUNT(DISTINCT deal_id)           AS unique_deals
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_name IS NOT NULL
GROUP BY region, country, competitor_name
ORDER BY region, country, mentions DESC;

-- 2.2b Competidores por región (agregado)
SELECT
    COALESCE(region, 'Sin región') AS region,
    competitor_name,
    COUNT(*)                        AS mentions,
    COUNT(DISTINCT deal_id)         AS unique_deals
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_name IS NOT NULL
GROUP BY region, competitor_name
ORDER BY region, mentions DESC;

-- 2.3 Competidores por segmento
SELECT
    COALESCE(segment, 'Sin segmento') AS segment,
    competitor_name,
    COUNT(*)                           AS mentions,
    COUNT(DISTINCT deal_id)            AS unique_deals,
    competitor_relationship_display
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_name IS NOT NULL
  AND segment IS NOT NULL
GROUP BY segment, competitor_name, competitor_relationship_display
ORDER BY segment, mentions DESC;

-- 2.4 Win/Loss signals (competidores x deal_stage)
-- "¿En qué etapa aparecen y los deals avanzan o se pierden?"
SELECT
    competitor_name,
    deal_stage,
    COUNT(*)                AS mentions,
    COUNT(DISTINCT deal_id) AS unique_deals,
    COALESCE(SUM(amount), 0) AS revenue_in_stage
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_name IS NOT NULL
  AND deal_stage IS NOT NULL
GROUP BY competitor_name, deal_stage
ORDER BY competitor_name, unique_deals DESC;

-- 2.5 Migration opportunities (de dónde están saliendo)
SELECT
    competitor_name,
    COALESCE(region, 'Sin región')   AS region,
    COALESCE(segment, 'Sin segmento') AS segment,
    deal_name,
    deal_stage,
    amount,
    deal_owner,
    summary
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_relationship = 'migrating_from'
ORDER BY amount DESC NULLS LAST;


-- ════════════════════════════════════════════════════════════
-- 3. SALES ENABLEMENT DASHBOARD
--    Audiencia: VP Sales, AEs, Sales Ops
-- ════════════════════════════════════════════════════════════

-- 3.1 Deal Friction analysis (ranking de tipos de fricción)
-- "¿Por qué se traban los deals?"
SELECT
    insight_subtype_display,
    insight_subtype,
    COUNT(*)                    AS mentions,
    COUNT(DISTINCT deal_id)     AS unique_deals,
    COALESCE(SUM(amount), 0)    AS revenue_at_risk,
    ROUND(AVG(confidence)::numeric, 2) AS avg_confidence
FROM v_insights_dashboard
WHERE insight_type = 'deal_friction'
GROUP BY insight_subtype_display, insight_subtype
ORDER BY mentions DESC;

-- 3.2 Fricciones por deal_stage
-- "¿En qué etapa aparece cada fricción?"
SELECT
    deal_stage,
    insight_subtype_display,
    COUNT(*)                    AS mentions,
    COUNT(DISTINCT deal_id)     AS unique_deals
FROM v_insights_dashboard
WHERE insight_type = 'deal_friction'
  AND deal_stage IS NOT NULL
GROUP BY deal_stage, insight_subtype_display
ORDER BY deal_stage, mentions DESC;

-- 3.3 FAQ más frecuentes (material para battle cards)
SELECT
    insight_subtype_display AS faq_topic,
    insight_subtype,
    COUNT(*)                    AS mentions,
    COUNT(DISTINCT deal_id)     AS unique_deals,
    ROUND(AVG(confidence)::numeric, 2) AS avg_confidence
FROM v_insights_dashboard
WHERE insight_type = 'faq'
GROUP BY insight_subtype_display, insight_subtype
ORDER BY mentions DESC;

-- 3.3b FAQ con ejemplos de preguntas (para armar battle cards)
SELECT
    insight_subtype_display AS faq_topic,
    summary,
    verbatim_quote,
    deal_name,
    segment
FROM v_insights_dashboard
WHERE insight_type = 'faq'
ORDER BY insight_subtype, confidence DESC;

-- 3.4 Performance por AE
-- "¿Quién enfrenta más fricciones? ¿Quién tiene más competitive signals?"
SELECT
    deal_owner,
    COUNT(*)                                                          AS total_insights,
    COUNT(*) FILTER (WHERE insight_type = 'deal_friction')            AS frictions,
    COUNT(*) FILTER (WHERE insight_type = 'competitive_signal')       AS competitive_signals,
    COUNT(*) FILTER (WHERE insight_type = 'pain')                     AS pains,
    COUNT(*) FILTER (WHERE insight_type = 'product_gap')              AS product_gaps,
    COUNT(*) FILTER (WHERE insight_type = 'faq')                      AS faqs,
    COUNT(DISTINCT deal_id)                                           AS unique_deals
FROM v_insights_dashboard
WHERE deal_owner IS NOT NULL
GROUP BY deal_owner
ORDER BY total_insights DESC;

-- 3.4b Fricciones por AE (detalle de qué fricción enfrenta cada uno)
SELECT
    deal_owner,
    insight_subtype_display AS friction_type,
    COUNT(*)                AS mentions,
    COUNT(DISTINCT deal_id) AS unique_deals
FROM v_insights_dashboard
WHERE insight_type = 'deal_friction'
  AND deal_owner IS NOT NULL
GROUP BY deal_owner, insight_subtype_display
ORDER BY deal_owner, mentions DESC;

-- 3.5 Fricciones por segmento
-- "Enterprise tiene más legal y security_review, SMB más budget"
SELECT
    COALESCE(segment, 'Sin segmento') AS segment,
    insight_subtype_display,
    COUNT(*)                    AS mentions,
    COUNT(DISTINCT deal_id)     AS unique_deals,
    COALESCE(SUM(amount), 0)    AS revenue_at_risk
FROM v_insights_dashboard
WHERE insight_type = 'deal_friction'
GROUP BY segment, insight_subtype_display
ORDER BY segment, mentions DESC;


-- ════════════════════════════════════════════════════════════
-- 4. REGIONAL / GO-TO-MARKET DASHBOARD
--    Audiencia: Regional leads, Expansion team
-- ════════════════════════════════════════════════════════════

-- 4.1 Pains por país
-- "¿Argentina tiene más manual_processes? ¿Brasil más compliance_risk?"
SELECT
    COALESCE(country, 'Sin país') AS country,
    COALESCE(region, 'Sin región') AS region,
    insight_subtype_display,
    pain_theme,
    COUNT(*)                    AS mentions,
    COUNT(DISTINCT deal_id)     AS unique_deals
FROM v_insights_dashboard
WHERE insight_type = 'pain'
  AND country IS NOT NULL
GROUP BY country, region, insight_subtype_display, pain_theme
ORDER BY country, mentions DESC;

-- 4.1b Top 5 pains por país (para comparar países)
SELECT * FROM (
    SELECT
        country,
        region,
        insight_subtype_display,
        COUNT(*) AS mentions,
        ROW_NUMBER() OVER (PARTITION BY country ORDER BY COUNT(*) DESC) AS rn
    FROM v_insights_dashboard
    WHERE insight_type = 'pain'
      AND country IS NOT NULL
    GROUP BY country, region, insight_subtype_display
) ranked
WHERE rn <= 5
ORDER BY country, rn;

-- 4.2 Módulos más demandados por región
SELECT
    COALESCE(region, 'Sin región') AS region,
    module_display,
    hr_category_display,
    module_status,
    COUNT(*)                                                   AS total_insights,
    COUNT(*) FILTER (WHERE insight_type = 'pain')              AS pains,
    COUNT(*) FILTER (WHERE insight_type = 'product_gap')       AS gaps,
    COUNT(DISTINCT deal_id)                                    AS unique_deals
FROM v_insights_dashboard
WHERE insight_type IN ('pain', 'product_gap')
  AND module IS NOT NULL
  AND region IS NOT NULL
GROUP BY region, module_display, hr_category_display, module_status
ORDER BY region, total_insights DESC;

-- 4.3 Competitors por país
SELECT
    COALESCE(country, 'Sin país') AS country,
    COALESCE(region, 'Sin región') AS region,
    competitor_name,
    COUNT(*)                        AS mentions,
    COUNT(DISTINCT deal_id)         AS unique_deals,
    COUNT(*) FILTER (WHERE competitor_relationship = 'currently_using')  AS using_it,
    COUNT(*) FILTER (WHERE competitor_relationship = 'evaluating')       AS evaluating,
    COUNT(*) FILTER (WHERE competitor_relationship = 'migrating_from')   AS migrating_from
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_name IS NOT NULL
  AND country IS NOT NULL
GROUP BY country, region, competitor_name
ORDER BY country, mentions DESC;

-- 4.4 Pipeline coverage (segment x region con revenue)
SELECT
    COALESCE(region, 'Sin región')    AS region,
    COALESCE(segment, 'Sin segmento') AS segment,
    COUNT(DISTINCT transcript_id)      AS transcripts_analyzed,
    COUNT(DISTINCT deal_id)            AS unique_deals,
    COUNT(*)                           AS total_insights,
    COUNT(*) FILTER (WHERE insight_type = 'pain')              AS pains,
    COUNT(*) FILTER (WHERE insight_type = 'product_gap')       AS gaps,
    COUNT(*) FILTER (WHERE insight_type = 'competitive_signal') AS competitive,
    COUNT(*) FILTER (WHERE insight_type = 'deal_friction')     AS frictions,
    COALESCE(SUM(DISTINCT amount), 0)  AS total_pipeline_amount
FROM v_insights_dashboard
GROUP BY region, segment
ORDER BY region, segment;


-- ════════════════════════════════════════════════════════════
-- 5. EXECUTIVE SUMMARY DASHBOARD
--    Audiencia: CEO, Board, Investors
-- ════════════════════════════════════════════════════════════

-- 5.1 Volume overview
SELECT
    COUNT(*)                                                           AS total_insights,
    COUNT(DISTINCT transcript_id)                                      AS transcripts_analyzed,
    COUNT(DISTINCT deal_id)                                            AS deals_covered,
    COUNT(*) FILTER (WHERE insight_type = 'pain')                      AS pains,
    COUNT(*) FILTER (WHERE insight_type = 'product_gap')               AS product_gaps,
    COUNT(*) FILTER (WHERE insight_type = 'competitive_signal')        AS competitive_signals,
    COUNT(*) FILTER (WHERE insight_type = 'deal_friction')             AS deal_frictions,
    COUNT(*) FILTER (WHERE insight_type = 'faq')                       AS faqs,
    COUNT(DISTINCT competitor_name) FILTER (WHERE competitor_name IS NOT NULL) AS unique_competitors,
    COUNT(DISTINCT module) FILTER (WHERE module IS NOT NULL)           AS modules_mentioned,
    COUNT(DISTINCT deal_owner) FILTER (WHERE deal_owner IS NOT NULL)   AS active_aes
FROM v_insights_dashboard;

-- 5.2 Top 10 pains (visión macro)
SELECT
    insight_subtype_display,
    pain_theme,
    module_display,
    COUNT(*)                    AS mentions,
    COUNT(DISTINCT deal_id)     AS unique_deals,
    ROUND(AVG(confidence)::numeric, 2) AS avg_confidence
FROM v_insights_dashboard
WHERE insight_type = 'pain'
GROUP BY insight_subtype_display, pain_theme, module_display
ORDER BY mentions DESC
LIMIT 10;

-- 5.3 Top feature gaps con revenue impact
SELECT
    feature_display,
    module_display,
    COUNT(*)                                                    AS mentions,
    COUNT(DISTINCT deal_id)                                     AS unique_deals,
    COALESCE(SUM(amount), 0)                                    AS revenue_at_stake,
    COUNT(*) FILTER (WHERE gap_priority = 'dealbreaker')        AS dealbreakers,
    COUNT(*) FILTER (WHERE gap_priority = 'must_have')          AS must_haves
FROM v_insights_dashboard
WHERE insight_type = 'product_gap'
  AND feature_name IS NOT NULL
GROUP BY feature_display, module_display
ORDER BY revenue_at_stake DESC
LIMIT 10;

-- 5.4 Competitive positioning (distribución de relaciones)
SELECT
    competitor_relationship_display,
    competitor_relationship,
    COUNT(*)                    AS mentions,
    COUNT(DISTINCT deal_id)     AS unique_deals,
    COUNT(DISTINCT competitor_name) AS unique_competitors
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_relationship IS NOT NULL
GROUP BY competitor_relationship_display, competitor_relationship
ORDER BY mentions DESC;

-- 5.4b Top competidores con posicionamiento
SELECT
    competitor_name,
    COUNT(*) AS total_mentions,
    STRING_AGG(DISTINCT competitor_relationship, ', ') AS relationships,
    COUNT(DISTINCT deal_id) AS unique_deals,
    COALESCE(SUM(amount), 0) AS revenue_involved
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_name IS NOT NULL
GROUP BY competitor_name
ORDER BY total_mentions DESC
LIMIT 15;

-- 5.5 Trend over time (insights por mes)
SELECT
    DATE_TRUNC('month', call_date)::date AS month,
    COUNT(*)                                                           AS total_insights,
    COUNT(*) FILTER (WHERE insight_type = 'pain')                      AS pains,
    COUNT(*) FILTER (WHERE insight_type = 'product_gap')               AS product_gaps,
    COUNT(*) FILTER (WHERE insight_type = 'competitive_signal')        AS competitive_signals,
    COUNT(*) FILTER (WHERE insight_type = 'deal_friction')             AS deal_frictions,
    COUNT(*) FILTER (WHERE insight_type = 'faq')                       AS faqs,
    COUNT(DISTINCT transcript_id)                                      AS transcripts,
    COUNT(DISTINCT deal_id)                                            AS deals
FROM v_insights_dashboard
WHERE call_date IS NOT NULL
GROUP BY DATE_TRUNC('month', call_date)
ORDER BY month;

-- 5.5b Trend de competidores top por mes
SELECT
    DATE_TRUNC('month', call_date)::date AS month,
    competitor_name,
    COUNT(*) AS mentions
FROM v_insights_dashboard
WHERE insight_type = 'competitive_signal'
  AND competitor_name IS NOT NULL
  AND call_date IS NOT NULL
  AND competitor_name IN (
      SELECT competitor_name
      FROM v_insights_dashboard
      WHERE insight_type = 'competitive_signal'
        AND competitor_name IS NOT NULL
      GROUP BY competitor_name
      ORDER BY COUNT(*) DESC
      LIMIT 10
  )
GROUP BY DATE_TRUNC('month', call_date), competitor_name
ORDER BY month, mentions DESC;

-- 5.5c Trend de top pains por mes
SELECT
    DATE_TRUNC('month', call_date)::date AS month,
    insight_subtype_display,
    COUNT(*) AS mentions
FROM v_insights_dashboard
WHERE insight_type = 'pain'
  AND call_date IS NOT NULL
  AND insight_subtype IN (
      SELECT insight_subtype
      FROM v_insights_dashboard
      WHERE insight_type = 'pain'
      GROUP BY insight_subtype
      ORDER BY COUNT(*) DESC
      LIMIT 10
  )
GROUP BY DATE_TRUNC('month', call_date), insight_subtype_display
ORDER BY month, mentions DESC;
