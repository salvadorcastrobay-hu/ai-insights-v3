# Local Changes vs Current Repo

Generated on: 2026-03-05 (America/Argentina/Cordoba)
Repository: `/Users/salvadorcastrobay/Downloads/ai-insights-v3-main/ai-insights-v3`
Branch: `codex/pains-module-count`

## Baseline used

- `upstream/main` (juanbascelzi/ai-insights-v3): `2ac140e`
- `origin/main` (salvadorcastrobay-hu/ai-insights-v3): `79f280d`
- `HEAD` (local branch): `31c41e2`

## Commit-level divergence

- `HEAD` vs `upstream/main`: `0` commits ahead, `1` behind.
- Interpretation: local branch commits are already merged upstream; behind count is the upstream merge commit.
- `HEAD` vs `origin/main`: `2` commits ahead, `0` behind.
- Ahead commits relative to `origin/main`:
- `4603fa7` Use module presence for pains linked-to-module metrics
- `31c41e2` Fix duplicate Plotly element IDs in custom dashboards

## Uncommitted local changes (tracked files)

Total: 14 modified files, `+808 / -94` lines.

### Environment and config

- `.env.example`
- Added guidance for `DATABASE_URL` (preferred for SQL chat).
- Documented fallback DB URL parts: `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_NAME`, optional `SUPABASE_DB_USER`.

- `config.yaml`
- `credentials.usernames.salvadorcastrobay.logged_in` changed from `false` to `true`.
- This looks like a local session artifact.

### Shared utilities

- `dashboard/shared.py`
- Competitor normalization expanded and made accent-insensitive (`unicodedata NFKD`).
- Added aliases for `Senior`, `Sólides`, `Feedz`, `Totvs`, and own-brand alias `human d`.
- Removed unsupported cache TTL in `@st.cache_data(... persist="disk")`.
- Added reusable helpers:
- `clean_stage_label(stage, max_chars=16)` for axis cleanup/wrapping.
- `topn_with_other(series, n, other_label="Other")` for Top-N bucketing.

### Views

- `dashboard/views/competitive_intelligence.py`
- Added chart: `Competidores por Industria (Top 10)`.
- Updated one table to `width="stretch"`.

- `dashboard/views/custom_dashboards.py`
- Updated chart/table/button sizing args (`width="stretch"` for Streamlit primitives where applicable, `use_container_width=True` for Plotly).
- Saved chart render keeps explicit unique key (`saved_chart_{dashboard_id}_{chart_id|idx}`).

- `dashboard/views/executive_summary.py`
- Added `Marketing Snapshot` section with actionable rows:
- dominant pain theme
- main deal blocker
- most demanded module
- Added `pandas` import and snapshot table render.

- `dashboard/views/faq_detail.py`
- Table updated to `width="stretch"`.

- `dashboard/views/glossary.py`
- Replaced multiple `st.dataframe(... use_container_width=True)` with `width="stretch"`.

- `dashboard/views/pains_detail.py`
- Detail table updated to `width="stretch"`.

- `dashboard/views/product_gaps_detail.py`
- Detail table updated to `width="stretch"`.

- `dashboard/views/product_intelligence.py`
- Added charts:
- `Pains por Industria (Top 10)`
- `Demanda de Modulos por Segmento`
- `Demanda de Modulos por Industria`
- Updated detail tables to `width="stretch"`.

- `dashboard/views/regional_gtm.py`
- Updated dataframes to `width="stretch"`.

- `dashboard/views/sales_enablement.py`
- Major redesign of `Friccion x Etapa del Deal` heatmap:
- Top-N grouping (`top 10 frictions`, `top 8 stages`) plus `Other`.
- Stage label cleaning/wrapping and duplicate display disambiguation.
- Full-width rendering with readable axis settings.
- Sparse annotations only for salient cells (P85 or row-max).
- Added full-detail expander table and CSV download (no top-N truncation).
- Added `Blockers por Industria (Top 10)` chart.
- Updated dataframes to `width="stretch"`.

### Chat agent

- `src/agents/chat_agent.py`
  - Added LATAM disambiguation flow:
    - Detects `LATAM`/`Latin America` in user prompt.
    - Asks user to choose `HISPAM`, `BR`, or both.
    - Injects selected scope into SQL generation context.
    - Rewrites SQL region predicates to enforce selected concrete region(s).
  - Added DB connection fallback builder:
    - if `DATABASE_URL` is missing, builds URL from `SUPABASE_URL` + `SUPABASE_DB_PASSWORD` (+ optional host/port/db/user).
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

### Custom dashboards

- `dashboard/views/custom_dashboards.py`
  - **[Session 2026-03-09]** Added ⚡ Inicio rápido section with 6 one-click preset buttons:
    - 📊 Top Pains, 🌎 Pains por Región, ⚔️ Competidores, 🧩 Módulos demandados, 💰 Pipeline por Etapa, 🎯 Insights por Segmento.
    - Clicking a preset auto-fills chart name, type, axes, aggregation, top N, and sort via session state.
    - Full builder remains below for advanced customization.

## Untracked local files

- `.github/workflows/ai_insights_exact_pipeline.yml`
- New GitHub Actions workflow for ingestion + extraction pipeline (manual dispatch, optional incremental/dry-run/force).

- `RELEVANT_NOW_ROUND2_IMPLEMENTATION.md`
- Documentation file summarizing implemented "Relevant now" feedback items.

## Quick verification commands

```bash
cd /Users/salvadorcastrobay/Downloads/ai-insights-v3-main/ai-insights-v3
git status --short
git rev-list --left-right --count upstream/main...HEAD
git rev-list --left-right --count origin/main...HEAD
git diff --stat
```
