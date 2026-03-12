# Competitive Intelligence — Changes Log

Based on feedback: [Competitive Intelligence — Feedback](https://www.notion.so/humand-co/Competitive-Intelligence-Feedback-3216757f3130815fbb83fd730d0a4302)

---

## 1. 🔴 Critical — Filter competitive signals to curated competitor list

**File:** `views/competitive_intelligence.py`

**Problem:** The model was detecting any tool mention as a competitive signal, resulting in 1,222+ "unique competitors" including noise like Slack or Google Workspace used internally.

**Change:** Added import of `COMPETITORS` dict from `taxonomy.py` (the curated list of ~80 known competitors). All competitive signal rows are filtered to only those whose `competitor_name` appears in the curated list. Own-brand filtering (`is_own_brand_competitor`) was already in place and kept.

```python
from taxonomy import COMPETITORS
CURATED_COMPETITORS = set(COMPETITORS.keys())
comp = comp[comp["competitor_name"].isin(CURATED_COMPETITORS)]
```

---

## 2. 🔴 Changed — KPI: "Competidores Únicos" → "Competidores relevantes"

**File:** `views/competitive_intelligence.py`

**Before:** `Competidores Únicos: 1,222` — inflated by noise.

**After:** `Competidores relevantes: N` — counts only curated competitors with at least one strong-relationship signal (i.e. `currently_using`, `evaluating`, `migrating_from`, `migrating_to`, `replaced`, or `previously_used`). Excludes signals that are only "mentioned".

---

## 3. 🔴 Changed — KPI: "Total Señales" → "Deals con señal competitiva"

**File:** `views/competitive_intelligence.py`

**Before:** `Total Señales: 4,550` — raw detection count, hard to act on.

**After:** `Deals con señal competitiva: X (Y% del total)` — counts unique `deal_id` values where a competitive signal was detected, plus the percentage of all deals. This answers the more actionable question: *in how many deals is there active competition?*

Revenue Asociado KPI was renamed to "Revenue con competencia activa" and kept.

---

## 4. 🔴 Changed — Measurement unit: detections → unique deals across all charts

**File:** `views/competitive_intelligence.py`

**Before:** All bar charts used `value_counts()` on raw rows — so if SAP SuccessFactors appeared 3 times in one call, it counted as 3.

**After:** All charts now deduplicate by `(competitor_name, deal_id)` before counting. Each competitor counts once per deal. Column labels changed from "Menciones" to "Deals únicos".

Affected charts:
- Top 15 Competidores
- Breakdown por Tipo de Relación
- Heatmap Competidores x País
- Competidores por Segmento
- Competidores por Industria
- Win/Loss Signals por Etapa

---

## 5. 🔴 Changed — Win/Loss Signals chart

**File:** `views/competitive_intelligence.py`
**File:** `queries_dashboards.sql` (query 2.4)

**Before:** Bar chart showed `competitor_name x deal_stage` with raw detection counts. No deal outcome dimension.

**After (dashboard):** Chart uses unique deals per `(competitor_name, deal_stage)` pair. Title updated to "¿En qué etapa del deal aparece cada competidor?". Updated tooltip explains the actionable insight.

**After (SQL):** Query 2.4 now includes a computed `deal_outcome` column derived from `deal_stage` name:

```sql
CASE
    WHEN LOWER(deal_stage) LIKE '%won%'    OR LOWER(deal_stage) LIKE '%ganado%'   THEN 'Ganado'
    WHEN LOWER(deal_stage) LIKE '%lost%'   OR LOWER(deal_stage) LIKE '%perdido%'  THEN 'Perdido'
    WHEN LOWER(deal_stage) LIKE '%postpone%' ...                                  THEN 'Postponed'
    ELSE 'En curso'
END AS deal_outcome
```

> **Note:** The LIKE patterns should be adjusted to match the exact stage names used in HubSpot for this account. A future improvement would be to cross this with a `deal_outcome` field loaded directly from HubSpot.

---

## 6. 🟡 Added — Legend for 6 competitive relationship types

**File:** `views/competitive_intelligence.py`

Added a visible `st.caption()` legend below the breakdown chart explaining all 6 relationship types with color coding and recommended action:

| Type | Meaning | Action |
|------|---------|--------|
| 🔴 Usa actualmente | Prospect uses it today | Active displacement — max priority |
| 🟠 Evaluando | Evaluating in parallel | Needs specific battle card |
| 🟡 Migrando desde | Moving away from it to Humand | Migration opportunity — accelerate |
| 🟢 Uso anterior | Used it before, no longer | Learn why they left |
| 🔵 Mencionado | Weak mention without context | Weak signal — don't act without more context |
| ⚫ Descartado | Evaluated and rejected | Win for Humand — document the reason |

Also added a `color_discrete_map` to the Plotly stacked bar chart so colors are consistent with the legend.

---

## 7. 🟡 Added — Color by intensity in heatmap (Competidores x País)

**File:** `views/competitive_intelligence.py`

**Before:** `px.imshow(pivot, ...)` used the default color scale with no explicit intensity mapping.

**After:** Added `color_continuous_scale="Blues"` so cells with more deals appear darker. Cells with 0 deals appear white/light. Label changed from "Menciones" to "Deals únicos". Title updated to "¿En qué países aparece cada competidor?".

---

## 8. 🟡 Added — "Tipo de Relación" column in Migration Opportunities table

**File:** `views/competitive_intelligence.py`
**File:** `queries_dashboards.sql` (query 2.5)

**Before:** Migration table showed `competitor_name` but not whether the relationship was "Usa actualmente" vs "Migrando desde".

**After:** `competitor_relationship_display` added as the third column ("Tipo de Relación") in the displayed table. The column already exists in `v_insights_dashboard`.

SQL query 2.5 also updated to SELECT `competitor_relationship_display` and `company_name`.

---

## 9. 🟡 Added — Introductory text above Migration Opportunities table

**File:** `views/competitive_intelligence.py`

Added an `st.info()` block above the table:

> "Estas son empresas donde detectamos que el prospect usa actualmente, o está migrando desde, un competidor directo. Son oportunidades activas de desplazamiento. Filtrar por competidor o región para trabajarlas con el AE asignado."

---

## 10. 🟡 Added — Reorganized into 4 sections A/B/C/D

**File:** `views/competitive_intelligence.py`

The page is now structured with `st.subheader()` section headers and `st.markdown("---")` dividers:

- **A. ¿Contra quién competimos?** — Top competitors + Relationship breakdown
- **B. ¿Dónde y con quién?** — Heatmap by country + Segment + Industry
- **C. ¿En qué momento del deal aparecen?** — Competitor x Deal Stage
- **D. Migration Opportunities** — Actionable displacement table

---

## 11. 🟡 Added — Industria chart (new)

**File:** `views/competitive_intelligence.py`

Replaced the Win/Loss chart from the right column of section B, and added a new chart "¿En qué industrias aparece cada competidor?" using the `industry` column (if available). This was listed as a "Mantener" item in the feedback but was missing from the previous implementation.

---

## 12. 🟡 Changed — Migration Opportunities scope expanded

**File:** `views/competitive_intelligence.py`
**File:** `queries_dashboards.sql` (query 2.5)

**Before:** Only showed `migrating_from` relationships.

**After:** Shows both `currently_using` AND `migrating_from` — both represent active displacement opportunities. The "Tipo de Relación" column disambiguates which is which.

---

## 13. ℹ️ Note — HubSpot deal link (not yet implemented)

The feedback requested a direct link to the HubSpot deal from the Migration Opportunities table. This requires either:
- A `hubspot_deal_url` column in the database (not currently present in `v_insights_dashboard`)
- Or knowing the HubSpot portal ID to construct: `https://app.hubspot.com/contacts/{portal_id}/deal/{deal_id}`

The `deal_id` column is available in the data. To implement this, add a computed column to `v_insights_dashboard` or load the portal ID from config and compute it in the dashboard.

---

## Summary Table

| # | Priority | Change | Files Modified |
|---|----------|--------|----------------|
| 1 | 🔴 Critical | Filter to curated competitor list (taxonomy) | `views/competitive_intelligence.py` |
| 2 | 🔴 Changed | KPI: Competidores Únicos → Competidores relevantes | `views/competitive_intelligence.py` |
| 3 | 🔴 Changed | KPI: Total Señales → Deals con señal competitiva | `views/competitive_intelligence.py` |
| 4 | 🔴 Changed | All charts: detections → unique deals | `views/competitive_intelligence.py` |
| 5 | 🔴 Changed | Win/Loss: add deal_outcome dimension | `views/competitive_intelligence.py`, `queries_dashboards.sql` |
| 6 | 🟡 Added | Legend for 6 relationship types + color map | `views/competitive_intelligence.py` |
| 7 | 🟡 Added | Heatmap color intensity scale (Blues) | `views/competitive_intelligence.py` |
| 8 | 🟡 Added | "Tipo de Relación" column in Migration table | `views/competitive_intelligence.py`, `queries_dashboards.sql` |
| 9 | 🟡 Added | Intro text above Migration Opportunities | `views/competitive_intelligence.py` |
| 10 | 🟡 Added | 4-section structure A/B/C/D | `views/competitive_intelligence.py` |
| 11 | 🟡 Added | Industry chart (¿En qué industrias?) | `views/competitive_intelligence.py` |
| 12 | 🟡 Changed | Migration scope: migrating_from + currently_using | `views/competitive_intelligence.py`, `queries_dashboards.sql` |
| 13 | ℹ️ Pending | HubSpot deal link in Migration table | Requires DB or config change |
