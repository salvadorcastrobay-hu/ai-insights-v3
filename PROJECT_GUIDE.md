# Humand Insights — Project Guide

> A self-service dashboard that surfaces what prospects say during Humand sales calls — pains, product gaps, competitors, frictions, and FAQs — extracted via LLM from Fathom transcripts and joined to HubSpot deal data.

---

## 1 · Quick access

| | |
|---|---|
| **Dashboard (production)** | https://humand-insights-web.vercel.app |
| **Login** | Your Humand prefix (e.g. `laura.flores`) or full email — both work |
| **Initial password** | `12345678` — change it via "Forgot password" after first login |
| **Source repo** | https://github.com/salvadorcastrobay-hu/ai-insights-v3 (fork) · upstream at `juanbascelzi/ai-insights-v3` |
| **Active branch** | `feat/sales-enablement-feedback` |

### Roles & permissions

| Role | What they can see |
|---|---|
| **admin** | Everything (Juanba, Salvador) |
| **campaign_advisor** | Dashboard + Campaign Advisor (marketing team) |
| **viewer** | Dashboard only — no Campaign Advisor |

Users live in Supabase Auth. To add/remove, edit `humand-insights-web/scripts/migrate-users.ts` and re-run.

---

## 2 · What the dashboard shows

The app extracts **five insight types** from every call:

| Type | Definition | Example verbatim |
|---|---|---|
| **Pain** | A problem or frustration the prospect describes | _"the licenses are requested by email, I approve them and load them manually"_ |
| **Product Gap** | A feature the prospect explicitly asks for | _"we need automatic integration with our payroll system"_ |
| **Competitive Signal** | Mention of a competitor (using, evaluating, migrating, etc.) | _"we're currently on SAP SuccessFactors but it's not working for us"_ |
| **Deal Friction** | Something blocking the sale (budget, timing, decision maker, technical, etc.) | _"we already planned this year's budget, it'd be Q1 next year"_ |
| **FAQ** | A frequently asked question about the product | _"how does implementation work? how long does it take?"_ |

Each insight carries:
- The verbatim quote
- A short summary
- Confidence score (0-1)
- Deal & call metadata (company, segment, industry, region, country, AE, amount, stage, date)
- Linked module / feature / competitor / friction subtype

---

## 3 · Dashboard tour

### Sidebar navigation

| Section | Pages |
|---|---|
| **Dashboards** | Executive Summary · Product Intelligence · Competitive Intelligence · Sales Enablement · Regional / GTM |
| **Detail** | Pains · Product Gaps · FAQs |
| **Tools** | Comparative Analysis · Custom Dashboards · Chat con IA · Glossary |
| **Marketing** | Campaign Advisor |

### Key pages

- **Executive Summary** — One-page overview: KPIs, sample composition, top pains, top features, top competitors, top frictions, top FAQs, monthly trends.
- **Product Intelligence** — Detailed pain themes, module demand, feature gaps by frequency vs. revenue.
- **Competitive Intelligence** — Competitor ranking, prospect's relationship with each, migration opportunities ordered by revenue.
- **Sales Enablement** — Friction analysis by deal stage and industry, per-AE coaching breakdown, auto-generated battle cards.
- **Regional / GTM** — Pain distribution by region, country-level feature demand, market-specific patterns.
- **Pains / Product Gaps / FAQs Detail** — Drill-down tables with full text search and module filters.
- **Comparative Analysis** — Compare segments / periods / regions side by side.
- **Custom Dashboards** — Build your own charts and save them.
- **Chat con IA** — Free-form questions over the full dataset (SQL + semantic search).
- **Campaign Advisor** — Marketing-specific: generates campaign angles based on insights of a specific filter profile (region, segment, industry…) and optional external context URLs.
- **Glossary** — Reference: insight types, modules, themes, dimensions, KPI formulas, best practices.

### Global filters (top of every page)

Apply to all charts on the current page. Filter dimensions:

- Insight type · Region · Country · Segment · Industry · AE (deal owner) · Module · HR category · Acquisition channel · Deal source · Date range

State persists in the URL — share a URL and the recipient sees the same view.

### Per-chart features

Every ranking chart has two icons next to the title:

- **CSV** — Downloads the full underlying insights (23 columns including `verbatim_quote`) for that chart, after filters. Tooltip shows row count.
- **Preguntar** — Opens an Ask panel scoped to that chart. The LLM answers with real quotes pulled from the underlying rows. Use this for _"what do prospects actually mean by X?"_-style questions.

There's also a **floating "Preguntar"** button (bottom-right, or Cmd+K) that asks about the whole page in aggregate — use it for broad overview questions.

---

## 4 · Data model

### Modules

Humand's product surface is modeled as **54 modules** grouped into 8 HR categories. Each module has a status:

| Status | Meaning | Count today |
|---|---|---|
| `existing` | In production today | 45 |
| `roadmap` | Planned or in development | 5 |
| `missing` | Not built, not currently planned | 4 |

Categories: Internal Communication · HR Administration · Talent Acquisition · Talent Development · Culture & Engagement · Compensation & Benefits · Operations & Workplace · Platform

The Glossary page lists every module with EN/ES names and current status.

### Features

Around **5,900 features** in `tax_feature_names` (Supabase). Two flavors:

- **Seed features (~2,400)** — Canonical features from Humand's Notion roadmap, imported May 2026.
- **Auto-detected (~3,500)** — Names the LLM invented during extraction when it didn't recognize a feature.

Features link to modules via `suggested_module`. They do **not** have an independent `status` field today — they inherit visibility from their parent module.

### Pain themes

87 curated pain subtypes grouped into themes: `processes`, `technology`, `communication`, `talent`, `engagement`, `compliance`, `data`, `operations`, `compensation`. About 20 more were auto-detected by the LLM.

### Friction subtypes (12 canonical)

`budget`, `timing`, `decision_maker`, `legal`, `technical`, `change_management`, `champion_risk`, `incumbent_lock_in`, `scope_mismatch`, `security_review`, `regional_requirements`, `competing_priorities`.

### FAQ topics (15 canonical)

`pricing`, `implementation`, `integration`, `security`, `customization`, `mobile`, `support`, `migration`, `scalability`, `analytics`, `languages`, `adoption`, `compliance`, `roi`, `content_management`.

### Competitive relationships (6)

`currently_using`, `evaluating`, `migrating_from`, `comparing`, `previously_used`, `mentioned`. Each carries a color and a suggested action (e.g., `currently_using` = high-priority displacement opportunity).

### Dimension cuts

- **Regions (6)**: HISPAM · Brazil · ANGLO AMERICA · EMEA · APAC · MENA
- **Segments (4)**: SMB (< 250) · Mid Market (250-1000) · Enterprise (1001-3000) · Large Enterprise (> 3000)
- **Acquisition channels (4)**: Inbound · Outbound · Partner / Referral · Other

---

## 5 · How to update the taxonomy

### Update a module's status (e.g., move ATS from roadmap to existing)

The module status flows through a JOIN in `v_insights_dashboard` — **changes take effect immediately, no re-extraction needed**.

```sql
UPDATE tax_modules SET status = 'existing' WHERE code = 'ats';
```

Then sync the source-of-truth files:

1. `taxonomy.py` (root) — update the `MODULES` dict
2. `humand-insights-web/components/pages/GlossaryPage.tsx` — update `MODULES_BY_CATEGORY`
3. Open a PR or commit directly

There's a TypeScript helper that batches these updates safely: `humand-insights-web/scripts/update-modules.ts`.

### Add a new module

Same flow:

1. Add to `tax_modules` in Supabase (via SQL editor or the script)
2. Add to `taxonomy.py` `MODULES` dict
3. Add to `GlossaryPage.tsx` `MODULES_BY_CATEGORY`

If you have many changes (e.g., a roadmap export from Notion), use `scripts/parse-roadmap-csv.ts` + `scripts/apply-roadmap-modules.ts`. See `scripts/README.md`.

### Add a new feature

Features are auto-discovered by the LLM during extraction. You can also **seed** a canonical feature ahead of time:

```sql
INSERT INTO tax_feature_names (code, display_name, suggested_module, is_seed)
VALUES ('my_new_feature', 'My New Feature', 'chat', true);
```

`is_seed = true` is a hint that this is a canonical name (not auto-detected). The pipeline preserves it across re-runs.

---

## 6 · Data freshness — how new data gets in

### The pipeline (Python)

```
FATHOM (transcripts)         HUBSPOT (deals)
       │                           │
       └──────► raw_transcripts ◄──┘
                      │
                 OpenAI extraction (gpt-4o-mini)
                      │
                      ▼
             transcript_insights ◄── tax_modules / tax_feature_names / etc.
                      │
                      ▼
             v_insights_dashboard (read by the dashboard)
```

### Ingest (data sync) — daily cron

A GitHub Action runs every day at **06:00 UTC (03:00 ART)**:

```
.github/workflows/daily_ingest.yml
  → python main.py ingest --since <2 days ago>
```

This:
- Pulls new transcripts from Fathom (last 2 days)
- Pulls full HubSpot deal state (refreshes `raw_deals` table)
- Matches new calls to deals

It does **not** run LLM extraction automatically — that step (`python main.py run`) stays manual to control cost. Run it after a fresh ingest to surface insights from the new transcripts.

### Manual extraction (when ready)

```bash
PROMPT_VERSION=v3.0 python main.py run --sample 99999 --model gpt-4o-mini
```

The pipeline:
- Skips transcripts already processed at `prompt_version=v3.0` (idempotent)
- Processes ~100 transcripts/minute concurrently (Direct API, concurrency=30)
- Typical cost: ~$0.005 per transcript

Bumping `PROMPT_VERSION` to a new value forces re-extraction of every transcript at the new version, without overwriting old data.

---

## 7 · Architecture

| Component | Stack | Where it lives |
|---|---|---|
| **Dashboard frontend** | Next.js 15 (App Router), Tailwind, Recharts | `humand-insights-web/` → Vercel |
| **Backend AI features** | FastAPI wrapper around the Python pipeline (SQL Chat + Campaign Advisor) | `src/api/main.py` → Railway |
| **Pipeline (ingest + extraction)** | Python 3.11, OpenAI SDK, supabase-py | repo root → run locally or via GitHub Actions |
| **Database** | Supabase Postgres | `nzjzwtjyfqflhyidbacq.supabase.co` |
| **Auth** | Supabase Auth (email + password) | same |

Frontend calls FastAPI through `/api/[[...path]]/route.ts` proxy that forwards a Supabase JWT for auth.

---

## 8 · Local development

### Frontend

```bash
cd humand-insights-web
npm install
vercel env pull .env.local --environment=production --yes  # or copy from .env.qa
npm run dev
# http://localhost:3000
```

### Python pipeline

```bash
cd /path/to/ai-insights-v3
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_KEY, FATHOM_API_KEY, HUBSPOT_API_KEY, OPENAI_API_KEY
python main.py ingest --since 2026-05-01T00:00:00Z   # test ingest
python main.py run --sample 5 --model gpt-4o-mini    # test extraction
```

### Useful one-off scripts (`humand-insights-web/scripts/`)

- `migrate-users.ts` — create/update Supabase Auth users from the seed list
- `dump-features.ts` — export all features + their mention counts to CSV
- `find-duplicate-features.ts` — token-based dedup analysis
- `consolidate-features.ts` — embeddings-based merge of similar feature names
- `qa-ask-chart.ts` / `qa-live.ts` — regression tests for the Ask Chart route
- `update-modules.ts` — safe pattern for updating `tax_modules` in batch

See each file for env requirements (mostly `vercel env pull .env.qa` first).

---

## 9 · Deployment

### Frontend (Vercel)

Auto-deploys from any branch:

```bash
cd humand-insights-web
vercel --prod --yes
```

### FastAPI (Railway)

Deploy from the Python side of the repo. `Dockerfile` builds the image; Railway env vars: `SUPABASE_URL`, `SUPABASE_KEY`, `OPENAI_API_KEY`, `SUPABASE_JWT_SECRET`, `FRONTEND_URL`.

### GitHub Actions (Python)

- `.github/workflows/daily_ingest.yml` — daily cron (06:00 UTC)
- `.github/workflows/ai_insights_exact_rerun_submit.yml` — manual re-run for a date range

Required repo secrets: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_PASSWORD`, `OPENAI_API_KEY`, `FATHOM_API_KEY`, `FATHOM_TEAM_FILTER`, `HUBSPOT_API_KEY`.

---

## 10 · How to use the dashboard (cheat sheet by role)

### If you're in Marketing

Start at:
1. **Competitive Intelligence** — who you're up against, where, what relationship type
2. **Pains Detail** — what to lead campaigns with (the verbatim quotes are gold for copy)
3. **FAQ Detail** — content topics that prospects actually ask about
4. **Campaign Advisor** — generate campaign angles for a specific filter (region + segment + industry); optionally attach reference URLs (campaign briefs, articles)
5. **Regional / GTM** — adjust messaging by market

### If you're in Product

Start at:
1. **Product Intelligence** — pain themes, module demand, segment differences
2. **Product Gaps Detail** — features by frequency vs. revenue, prioritization tables
3. **Pains Detail** — qualitative deep-dive when something looks interesting in aggregate
4. **Glossary** — current status of every module (existing / roadmap / missing) — useful for sales when prospects ask "is X on the roadmap?"

### If you're in Sales / Enablement

Start at:
1. **Executive Summary** — Monday morning check-in
2. **Sales Enablement** — friction analysis by AE + stage, battle cards
3. **Competitive Intelligence** — pre-call prep for accounts with known competitors
4. **Pains Detail** — citas to anchor demos in real customer language

### Universal tips

- **Always check sample composition** (Executive Summary, top section) before drawing conclusions — small or skewed samples = unreliable numbers.
- **Click any bar in a chart** to open a drill-down panel with the actual insights/calls behind it.
- **Use the floating "Preguntar"** (Cmd+K) for free-form "what stands out" questions; use the **chart-level "Preguntar"** for "what do they mean by X" questions with real quotes.
- **Bookmark URLs** with your favorite filter combinations — they're shareable.
- **Download CSV** when you want to take data out (QBR decks, side analysis, etc.) — exports include verbatim quotes.

---

## 11 · Known limitations / things to be aware of

- **Speaker attribution** is not enforced structurally. The LLM is instructed to extract from prospect turns (not from the AE's pitch), but mistakes happen occasionally — when something looks off, click into the drill-down and read the actual verbatim.
- **Confidence scores** are not calibrated. Treat them as a relative signal, not an absolute probability.
- **Module status** updates take effect immediately in the dashboard, but the pipeline's prompt still reads from `taxonomy.py`; sync that file when you update modules in production.
- **Auto-detected pain subtypes / features** accumulate naturally as the LLM extracts. Periodic curation is recommended; see `scripts/consolidate-features.ts` and `scripts/find-duplicate-features.ts`.

---

## 12 · Where to ask questions

| Question type | Who/where |
|---|---|
| "Why is X showing up?" | Click the bar → read the verbatims. If unclear, use chart-level "Preguntar" |
| "What's the data freshness?" | Check `call_date` of latest transcript (~last 1-2 days if cron is running) |
| "Can I add a module / feature?" | See section 5. Or ping Salvador. |
| "How do I add a new user?" | Edit `humand-insights-web/scripts/migrate-users.ts` and re-run. Or ping Salvador. |
| "Why did the extraction miss this call?" | Check if the transcript exists in `raw_transcripts` (was it ingested?) and if it has `transcript_text` populated |
| "I want my own filter combo as a default" | Bookmark the URL with the filters applied; or create a Custom Dashboard with that scope |

---

*Last updated: May 2026. For internal Humand use.*
