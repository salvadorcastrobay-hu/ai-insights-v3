-- ============================================================
-- Schema: Humand Sales Insights v2
-- Ejecutar con: python main.py setup
-- ============================================================

-- 1. Reference Tables (Taxonomy)

CREATE TABLE IF NOT EXISTS tax_hr_categories (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    sort_order   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tax_modules (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    hr_category  TEXT NOT NULL REFERENCES tax_hr_categories(code),
    status       TEXT NOT NULL CHECK (status IN ('existing', 'missing')),
    sort_order   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tax_pain_subtypes (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description  TEXT,
    theme        TEXT NOT NULL,
    module       TEXT REFERENCES tax_modules(code),
    sort_order   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tax_deal_friction_subtypes (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description  TEXT
);

CREATE TABLE IF NOT EXISTS tax_faq_subtypes (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description  TEXT
);

CREATE TABLE IF NOT EXISTS tax_competitive_relationships (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description  TEXT
);

CREATE TABLE IF NOT EXISTS tax_competitors (
    name   TEXT PRIMARY KEY,
    region TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_feature_names (
    code             TEXT PRIMARY KEY,
    display_name     TEXT NOT NULL,
    suggested_module TEXT REFERENCES tax_modules(code),
    is_seed          BOOLEAN DEFAULT TRUE,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Ingestion Tables (Fathom + HubSpot)

CREATE TABLE IF NOT EXISTS raw_transcripts (
    recording_id       TEXT PRIMARY KEY,
    title              TEXT,
    meeting_title      TEXT,
    fathom_url         TEXT,
    recorded_by_email  TEXT,
    recorded_by_name   TEXT,
    team               TEXT,
    call_date          TIMESTAMPTZ,
    duration_seconds   INTEGER,
    transcript_text    TEXT NOT NULL,
    transcript_json    JSONB,
    participants       JSONB,
    external_domains   TEXT[],
    fathom_crm_matches JSONB,
    fathom_summary     TEXT,
    ingested_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_deals (
    deal_id            TEXT PRIMARY KEY,
    deal_name          TEXT,
    deal_stage         TEXT,
    pipeline           TEXT,
    amount             NUMERIC,
    create_date        TIMESTAMPTZ,
    close_date         TIMESTAMPTZ,
    owner_id           TEXT,
    owner_name         TEXT,
    ae_owner_id        TEXT,
    ae_owner_name      TEXT,
    country            TEXT,
    region             TEXT,
    segment            TEXT,
    industry           TEXT,
    associated_company_ids TEXT[],
    associated_contact_ids TEXT[],
    properties         JSONB,
    ingested_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_companies (
    company_id         TEXT PRIMARY KEY,
    name               TEXT,
    domain             TEXT,
    industry           TEXT,
    company_size       TEXT,
    country            TEXT,
    region             TEXT,
    properties         JSONB,
    ingested_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_contacts (
    contact_id         TEXT PRIMARY KEY,
    email              TEXT,
    firstname          TEXT,
    lastname           TEXT,
    company_id         TEXT,
    associated_deal_ids TEXT[],
    properties         JSONB,
    ingested_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_deal_matches (
    recording_id       TEXT PRIMARY KEY REFERENCES raw_transcripts(recording_id),
    matched_deal_id    TEXT,
    match_method       TEXT,
    match_score        REAL,
    match_details      JSONB,
    matched_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_transcripts_team ON raw_transcripts(team);
CREATE INDEX IF NOT EXISTS idx_raw_transcripts_date ON raw_transcripts(call_date);
CREATE INDEX IF NOT EXISTS idx_raw_deals_stage ON raw_deals(deal_stage);
CREATE INDEX IF NOT EXISTS idx_raw_companies_domain ON raw_companies(domain);
CREATE INDEX IF NOT EXISTS idx_raw_contacts_email ON raw_contacts(email);

-- 2b. Transcript View (joins Fathom + HubSpot data for pipeline)

CREATE OR REPLACE VIEW v_transcripts AS
SELECT
    t.recording_id AS transcript_id,
    t.transcript_text,
    t.fathom_summary,
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

-- 3. Main Insights Table

CREATE TABLE IF NOT EXISTS transcript_insights (
    id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transcript_id           TEXT NOT NULL,
    transcript_chunk        INTEGER DEFAULT 0,
    deal_id                 TEXT,
    deal_name               TEXT,
    company_name            TEXT,
    region                  TEXT,
    country                 TEXT,
    industry                TEXT,
    company_size            TEXT,
    deal_stage              TEXT,
    deal_owner              TEXT,
    segment                 TEXT,
    amount                  NUMERIC,
    call_date               DATE,
    insight_type            TEXT NOT NULL,
    insight_subtype         TEXT NOT NULL,
    module                  TEXT,
    summary                 TEXT NOT NULL,
    verbatim_quote          TEXT,
    confidence              REAL CHECK (confidence BETWEEN 0 AND 1),
    competitor_name         TEXT,
    competitor_relationship TEXT,
    feature_name            TEXT,
    gap_description         TEXT,
    gap_priority            TEXT,
    faq_topic               TEXT,
    model_used              TEXT NOT NULL,
    prompt_version          TEXT NOT NULL,
    batch_id                TEXT,
    content_hash            TEXT,
    processed_at            TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes

CREATE INDEX IF NOT EXISTS idx_insights_type ON transcript_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_insights_subtype ON transcript_insights(insight_subtype);
CREATE INDEX IF NOT EXISTS idx_insights_module ON transcript_insights(module);
CREATE INDEX IF NOT EXISTS idx_insights_competitor ON transcript_insights(competitor_name) WHERE competitor_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insights_region ON transcript_insights(region);
CREATE INDEX IF NOT EXISTS idx_insights_deal ON transcript_insights(deal_id);
CREATE INDEX IF NOT EXISTS idx_insights_date ON transcript_insights(call_date);
CREATE INDEX IF NOT EXISTS idx_insights_feature ON transcript_insights(feature_name) WHERE feature_name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_content_hash ON transcript_insights(content_hash);

-- 4. QA Results Table

CREATE TABLE IF NOT EXISTS qa_results (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transcript_id       TEXT NOT NULL,
    completeness        REAL,
    precision_score     REAL,
    classification      REAL,
    quotes_accuracy     REAL,
    overall_score       REAL,
    missing_insights    JSONB,
    wrong_classifications JSONB,
    hallucinations      JSONB,
    taxonomy_suggestions JSONB,
    notes               TEXT,
    model_used          TEXT,
    evaluated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_results_transcript ON qa_results(transcript_id);

-- 5. Dashboard View

CREATE OR REPLACE VIEW v_insights_dashboard AS
SELECT
    i.*,
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
    crel.display_name AS competitor_relationship_display
FROM transcript_insights i
LEFT JOIN raw_deals d ON i.deal_id = d.deal_id
LEFT JOIN tax_modules m ON i.module = m.code
LEFT JOIN tax_hr_categories hc ON m.hr_category = hc.code
LEFT JOIN tax_pain_subtypes ps ON i.insight_subtype = ps.code AND i.insight_type = 'pain'
LEFT JOIN tax_deal_friction_subtypes df ON i.insight_subtype = df.code AND i.insight_type = 'deal_friction'
LEFT JOIN tax_faq_subtypes fq ON i.insight_subtype = fq.code AND i.insight_type = 'faq'
LEFT JOIN tax_competitive_relationships cr ON i.insight_subtype = cr.code AND i.insight_type = 'competitive_signal'
LEFT JOIN tax_competitive_relationships crel ON i.competitor_relationship = crel.code
LEFT JOIN tax_feature_names fn ON i.feature_name = fn.code;
