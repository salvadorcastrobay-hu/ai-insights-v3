# Product Gaps — Detalle: Feedback & Changes

**Date:** 2026-03-13
**Source spec:** [Notion — Product Gaps Detalle Feedback](https://www.notion.so/humand-co/Product-Gaps-Detalle-Feedback-3216757f313081bfac9ac459c8f2fd6a)
**File changed:** `ai-insights-v3/views/product_gaps_detail.py`
**Scope:** Rewritten from 89 lines to 373 lines

---

## Agent Roles

| Role | Agent | Responsibility |
|------|-------|----------------|
| PM Agent | Claude | Read Notion spec, planned implementation, coordinated agents |
| Implementer Agent | Dashboard Developer | Rewrote `product_gaps_detail.py` |
| QA Agent | Quality Assurance | Validated syntax, logic, and all 10 changes |
| Documentation Agent | Technical Writer | Created this file |

---

## Summary of Changes

10 changes were implemented across three priority levels: 4 critical (red), 4 important (yellow). Each change is documented below with its before/after state and rationale.

---

## Change #1 — KPIs Replaced

**Priority:** Critical

**Before:**
Three raw number KPIs with no context:
- "Total Gaps"
- "Features Unicas"
- "Features Seed"

**After:**
Three contextual KPIs:

| KPI | Caption |
|-----|---------|
| Total Detecciones de Gaps | "en X demos · Y.Z gaps por demo" |
| Features en Taxonomía | "seeds definidos previamente por el equipo" |
| Features Nuevas Detectadas | "detectadas por el modelo · revisar para ampliar taxonomía" |

"Features Nuevas Detectadas" is computed as: `total unique features - seed features`

**Why:** The original numbers created confusion. The gap between 55 seeds and 2,412 unique features is a key product signal — it was invisible without contextual captions. The "nuevas detectadas" metric directly prompts the product team to review and expand the taxonomy.

---

## Change #2 — Pie Chart Removed, Priority Table Added

**Priority:** Critical

**Before:**
`px.pie` chart showing three slices (approximately 79.9% / 20% / 0.139%) with no visible legend and no definitions for each priority level.

**After:**
`st.dataframe` table with four columns:

| Column | Description |
|--------|-------------|
| Prioridad | Priority label |
| Detecciones | Raw count |
| % del Total | Percentage of all detections |
| Qué significa | Plain-language definition of the priority level |

A warning caption highlights the count of Dealbreakers explicitly.

**Why:** The pie chart was unreadable — no visible legend and the 0.14% slice was invisible. The table makes priorities scannable and explains what each priority means, enabling the team to act without needing prior context about the data model.

---

## Change #3 — Top 20 Features X-Axis Clarified

**Priority:** Critical

**Before:**
```python
value_counts()
# axis label: "Frecuencia"
```
"Frecuencia" was ambiguous — it could mean raw model detections or unique deals.

**After:**
```python
groupby("feature_display")["deal_id"].nunique()
# axis label: "Deals únicos (COUNT DISTINCT deal_id)"
```

**Why:** The distinction between model detections and unique deals is critical for prioritization. 820 unique deals mentioning a feature carries a very different weight than 820 raw model detections of that feature. The label now makes the metric unambiguous.

---

## Change #4 — New Chart: Prioridad de Gaps por Segmento (%)

**Priority:** Critical

**Before:** Did not exist.

**After:**
Stacked horizontal bar chart showing Must Have / Nice to Have / Dealbreaker as percentages within each segment. A caption below the chart displays total unique deals per segment.

**Why:** Allows Product to see if certain segments (e.g., Enterprise) have proportionally more Dealbreakers compared to SMB or Mid-Market, enabling segment-specific prioritization rather than treating all gaps uniformly.

---

## Change #5 — Table Columns Expanded

**Priority:** Critical

**Before:**

| company_name | feature_display | module_display | gap_description | gap_priority | confidence |

**After:**

| company_name | feature_display | module_display | gap_priority_display | segment | country | deal_stage | deal_owner | resumen |

`resumen` is the `summary` field truncated to 120 characters for readability.

**Why:** Without segment, country, deal_stage, deal_owner, and summary, the table contained only metadata with no context. The new columns let Product research specific gaps in context and enable Sales to identify patterns by AE or deal stage.

---

## Change #6 — Priority Filter on Table

**Priority:** Critical

**Before:** No table-level priority filter.

**After:**
```python
st.selectbox("Filtrar por Prioridad", options=[all priority values])
```
Placed directly above the table. Filters on the `gap_priority_display` column.

**Why:** The primary use case for the Product team is: "Show me all deals where feature X was a Dealbreaker." This requires a direct priority filter on the table. Without it, the team would need to scroll through hundreds of rows manually.

---

## Change #7 — Priority Emoji Labels on Top 20 Bars

**Priority:** Important

**Before:**
Plain bars with no priority context.

**After:**
Each bar has a text annotation showing the dominant priority for that feature, computed via `mode()` per feature:

| Label | Priority |
|-------|----------|
| 🔴 Must Have | must_have |
| 🟡 Nice to Have | nice_to_have |
| 🚨 Dealbreaker | dealbreaker |

**Why:** Allows Product to quickly identify which top features are hard blockers versus nice-to-haves directly from the bar chart, without needing to drill into the table for each feature.

---

## Change #8 — New Chart: Feature Gaps por Segmento (Top 15)

**Priority:** Important

**Before:** Did not exist.

**After:**
`px.density_heatmap` showing top 15 features × segments, colored by count of unique deals.

**Why:** Different segments have different feature priorities. Enterprise clients may prioritize API integration while SMB prioritizes ease-of-use features. A single ranked list obscures these differences; the heatmap surfaces them at a glance.

---

## Change #9 — Módulos Existentes vs. Faltantes (with Callout)

**Priority:** Important

**Before:**
"Gaps por Módulo" — top 10 modules by raw count with no percentage breakdown and no interpretation.

**After:**
Chart grouped by `module_status` (Existing / Missing / Roadmap) with percentage labels on each bar.

An interpretive callout is rendered below the chart:

> "El X% de los feature gaps son en módulos que YA EXISTEN en Humand — el problema es de profundidad funcional, no de ausencia del módulo."

**Why:** Knowing that ~78% of gaps are in existing modules is a critical strategic insight: the product doesn't need more modules, it needs deeper functionality in what already exists. Without this framing, the chart looked like a simple feature request list.

---

## Change #10 — Text Search on Table

**Priority:** Important

**Before:** No text search on the table.

**After:**
```python
st.text_input("Buscar en resumen")
```
Filters the table by searching the full `summary` field (case-insensitive). Applied before the priority filter so both filters compose.

**Why:** With the summary column now available, the product team can search for specific terms (e.g., "DocuSign", "nómina", "firma") to find relevant context from real transcript excerpts — turning the table into a lightweight research tool.

---

## Technical Notes

- Raw `gap_priority` values (`"must_have"`, `"nice_to_have"`, `"dealbreaker"`) are preserved throughout all chart computations. A separate `gap_priority_display` column is created via `humanize()` only for table display. This ensures correct grouping and sorting in all Plotly charts.

- `import pandas as pd` is placed inline within the priority table section (not at the top of the file) to maintain the existing pattern where pandas is used implicitly through the dataframe already in session state.

- All `st.plotly_chart()` calls use `use_container_width=True`. The deprecated `width="stretch"` parameter is not used anywhere in the file.

---

## QA Checklist

- [ ] Python syntax passes: `python3 -m py_compile views/product_gaps_detail.py`
- [ ] No `px.pie` present in the file
- [ ] No `width="stretch"` present in the file
- [ ] Raw `gap_priority` is not humanized at the top of the file
- [ ] All 10 changes are present and functional
- [ ] Priority filter correctly filters on the `gap_priority_display` column
- [ ] Text search correctly filters on the `summary` column (case-insensitive)
