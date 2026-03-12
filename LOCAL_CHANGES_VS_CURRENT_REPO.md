# Local Changes vs Current Repo

Last updated: 2026-03-12 (America/Argentina/Cordoba)
Repository: `/Users/salvadorcastrobay/Downloads/ai-insights-v3-main/ai-insights-v3`
Branch: `codex/pains-module-count`

## Baseline used

- `upstream/main` (juanbascelzi/ai-insights-v3): `2ac140e`
- `origin/main` (salvadorcastrobay-hu/ai-insights-v3): `1b2bccb` (latest)
- `HEAD` (local branch): `31c41e2`

## Commit-level divergence

- `HEAD` vs `upstream/main`: `0` commits ahead, `1` behind.
- Interpretation: local branch commits are already merged upstream; behind count is the upstream merge commit.
- `HEAD` vs `origin/main`: `0` commits ahead, `3` behind.
- Commits merged to origin/main since HEAD:
  - `1b2bccb` fix: trigger streamlit rebuild to clear module cache
  - `92517ac` feat: UX improvements — auto-charts, connection status, dashboard presets
  - `c908523` fix: SQL query bugs — region predicates, SEARCH filters, segment values

## Uncommitted local changes (vs origin/main HEAD)

Total: 5 modified files, `+513 / -230` lines.

```
dashboard/app.py                     |   5 +-
dashboard/computations.py            |  19 ++
dashboard/shared.py                  |   8 +
dashboard/views/executive_summary.py | 547 (major rewrite)
src/agents/chat_agent.py             | 164 ++++-------
```

---

## Changes by file

### `dashboard/app.py`
- Minor adjustments (exact diff not noted; tracked in git diff).

### `dashboard/computations.py`
- Added `cached_pains_with_pct(pains, n)` — returns top-N pains with demos count + `% del total` column.
- Approx. +19 lines.

### `dashboard/shared.py`
- Competitor normalization expanded and made accent-insensitive (`unicodedata NFKD`).
- Added aliases for `Senior`, `Sólides`, `Feedz`, `Totvs`, and own-brand alias `human d`.
- Removed unsupported cache TTL in `@st.cache_data(... persist="disk")`.
- Added reusable helpers:
  - `clean_stage_label(stage, max_chars=16)` for axis cleanup/wrapping.
  - `topn_with_other(series, n, other_label="Other")` for Top-N bucketing.

### `dashboard/views/executive_summary.py` — major redesign

#### [Session 2026-03-05] — first pass

- Added top-of-page filter expander (types, regions, segments, countries, industries, deal owners, date range).
- KPIs redesigned:
  - Removed `Competidores únicos` (low value).
  - Renamed `Total Insights` → `Insights por Call` (avg per demo).
  - Added `Calls con Insights` metric (% of total transcripts with at least one insight).
  - Added `Revenue Total` and `Deals con Match`.
- Added "Composición de la muestra" section:
  - `Distribución por Industria` chart (top 10 at the time).
  - `Distribución por Segmento` chart.
- Added section headers (1️⃣–5️⃣) mapping directly to the 5 questions from Notion.
- Pains section: added `cached_pains_with_pct` for % del total hover data.
- Added `Top 15 Pains × Segmento` heatmap (full-width).
- Modules section: renamed to "Módulos más buscados en la primera Demo"; added 2-column feature gaps (frecuencia + revenue).
- Fricciones: added Friction Insights breakdown (top 2 per module).
- FAQs: added FAQ Insights breakdown (co-occurrence with modules).
- Tendencia Mensual: already present, kept as-is.
- Removed unused `import pandas as pd`.

#### [Session 2026-03-12] — refinements from Notion feedback

- **Industry distribution**: `.head(10)` → `.head(15)`.
- **Segment distribution**: `dropna(subset=["segment"])` → `fillna("Desconocido")` so demos with no segment are labeled "Desconocido" instead of being silently dropped.
- **Pains × Segmento heatmap**: added `fillna("Desconocido")` for consistent null handling.
- **Pain Insights chart** (right column): fixed counting logic and visualization:
  - Old: raw `value_counts()` → wrong count units.
  - New: `groupby(["module_display", "insight_subtype_display"])["transcript_id"].nunique()` → demos únicas.
  - Changed from grouped bar → `px.imshow` heatmap (top 10 modules × top 8 global pains, Blues scale, `height=420`).
  - Column ratio changed from `st.columns(2)` → `st.columns([2, 3])`.
- **Friction Insights chart** (right column): fixed counting logic:
  - Old: `value_counts()` → raw mentions.
  - New: `groupby(["module_display", "insight_subtype_display"])["transcript_id"].nunique()` → demos únicas.
  - Labels updated from `"Menciones"` → `"Demos únicas"`.
- **Fricciones — Revenue en Riesgo** (NEW, full-width):
  - Bar chart: `friction_all.drop_duplicates(["deal_id", "insight_subtype_display"]).groupby("insight_subtype_display")["amount"].sum()`.
  - Title: "Fricciones — Revenue en Riesgo". Shows top 10 friction types by associated deal revenue.
  - Only renders if `"amount"` column present and total revenue > 0.
- **FAQ Insights chart** (right column): fixed root-cause data issue and visualization:
  - Root cause: FAQs have no `module_display` tag; `dropna(subset=["module_display"])` silently dropped all FAQ rows → chart showed 0–1 values.
  - New approach: transcript co-occurrence join — merge FAQ transcript IDs with module tags from other insight types in the same transcript.
  - Changed from grouped bar → `px.imshow` heatmap (top 10 modules × top 6 global FAQs, Blues scale, `height=420`).
  - Column ratio changed from `st.columns(2)` → `st.columns([2, 3])`.

### `src/agents/chat_agent.py`

- Added LATAM disambiguation flow:
  - Detects `LATAM`/`Latin America` in user prompt.
  - Asks user to choose `HISPAM`, `BR`, or both.
  - Injects selected scope into SQL generation context.
  - Rewrites SQL region predicates to enforce selected concrete region(s).
- Added DB connection fallback builder:
  - If `DATABASE_URL` is missing, builds URL from `SUPABASE_URL` + `SUPABASE_DB_PASSWORD` (+ optional host/port/db/user).
- Added clearer errors for missing DB connection in SQL/HYBRID/SEARCH flows.
- Added sample prompts expander.
- Updated multiple dataframes to `width="stretch"`.
- **[Session 2026-03-05/09]** Bug fixes:
  - Fixed SEARCH mode system prompt: filter columns now correctly list only `raw_transcripts` columns (`title`, `call_date`, `team`). Previously listed `industry`, `segment`, etc. which don't exist on that table.
  - Fixed `_rewrite_sql_region_scope()` to use actual DB region values (`'HISPAM'`, `'Brazil'`) instead of nonexistent `'LATAM'`.
  - Removed incorrect `_normalize_region_predicates()` that was rewriting valid predicates to nonexistent values.
- **[Session 2026-03-09]** UX improvements:
  - Replaced setup status `st.metric("OPENAI_API_KEY", "OK")` / `st.metric("DATABASE_CONN", "OK")` with subtle `✅ Conectado` caption.
  - Added `_auto_chart()` function: detects chart-worthy query results (categorical + numeric columns, ≤30 rows) and auto-renders Plotly charts (horizontal bar, pie, or line) inside `st.expander("📊 Mostrar gráfico")`.
  - Wired auto-charts into all display paths: SQL, HYBRID, SEARCH (live + history replay).
  - Added `🔍 Debug: Ver SQL generado` expanders to all no-results / error paths for SQL debugging.

---

## Other modified views (earlier sessions, already documented)

- `dashboard/views/competitive_intelligence.py` — Added `Competidores por Industria (Top 10)`.
- `dashboard/views/custom_dashboards.py` — `width="stretch"` fixes + unique Plotly keys + ⚡ Inicio rápido presets.
- `dashboard/views/faq_detail.py` — Table `width="stretch"`.
- `dashboard/views/glossary.py` — Tables `width="stretch"`.
- `dashboard/views/pains_detail.py` — Table `width="stretch"`.
- `dashboard/views/product_gaps_detail.py` — Table `width="stretch"`.
- `dashboard/views/product_intelligence.py` — Added `Pains por Industria`, `Demanda de Módulos por Segmento`, `Demanda de Módulos por Industria`.
- `dashboard/views/regional_gtm.py` — Tables `width="stretch"`.
- `dashboard/views/sales_enablement.py` — `Friccion x Etapa del Deal` heatmap redesign + `Blockers por Industria`.

---

## Notion page — Executive Summary CTAs vs implementation status

Source: https://www.notion.so/humand-co/Excecutive-Summary-31f6757f313080e0b4cccf76056e50de

| # | Notion CTA | Status |
|---|---|---|
| 1 | Filters moved to top (not sidebar) | ✅ Implemented — `st.expander("Filtros")` at page top |
| 2 | Remove "Competidores únicos" KPI | ✅ Removed |
| 3 | Rename "Total Insights" → "Insights por call" | ✅ Done |
| 4 | Add "% de calls con insights" KPI | ✅ Done (`pct_with_insights`) |
| 5 | Clarify what counts as an insight (tooltip) | ✅ Done (help text on "Insights por Call" metric) |
| 6 | Add "Distribución por Industria" chart | ✅ Done — top 15 |
| 7 | Add "Distribución por Segmento" chart | ✅ Done — with "Desconocido" for nulls |
| 8 | Pains: freq = demos únicas (not detections) | ✅ Done |
| 9 | Pains: add % del total de demos | ✅ Done (hover data via `cached_pains_with_pct`) |
| 10 | Pain Insights (new) — breakdown per pain | ✅ Done — heatmap (top 10 modules × top 8 pains) |
| 11 | Top 15 Pains × Segmento heatmap | ✅ Done |
| 12 | Módulos: rename to "Módulos más buscados en la primera Demo" | ✅ Done |
| 13 | Feature Gaps: Top 10 frecuencia + revenue side by side | ✅ Done |
| 14 | Competidores: add breakdown "Usa / Evaluando / Migración" | ✅ Done — stacked bar next to top competitors chart |
| 15 | Fricciones: Top friction chart | ✅ Done (demos únicas) |
| 16 | Fricción Insights — top 2 per module | ✅ Done (grouped bar) |
| 17 | Fricciones: Revenue en riesgo chart | ✅ Done (new session 2026-03-12) |
| 18 | FAQs: Top FAQ chart | ✅ Done (demos únicas) |
| 19 | FAQ Insights — breakdown per topic | ✅ Done — heatmap (top 10 modules × top 6 FAQs, co-occurrence) |

**All Notion items implemented.** ✅

---

## Untracked local files

- `.github/workflows/ai_insights_exact_pipeline.yml`
  - New GitHub Actions workflow for ingestion + extraction pipeline (manual dispatch, optional incremental/dry-run/force).

- `RELEVANT_NOW_ROUND2_IMPLEMENTATION.md`
  - Documentation file summarizing implemented "Relevant now" feedback items.

---

## Quick verification commands

```bash
cd /Users/salvadorcastrobay/Downloads/ai-insights-v3-main/ai-insights-v3
git status --short
git rev-list --left-right --count upstream/main...HEAD
git rev-list --left-right --count origin/main...HEAD
git diff --stat
```
