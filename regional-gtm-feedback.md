# Regional / GTM — Feedback Changes

**Fuente:** [Notion — Regional / GTM Feedback](https://www.notion.so/humand-co/Regional-GTM-Feedback-3216757f313081b38791fda334d561b4)
**Fecha:** 2026-03-13
**Archivo modificado:** `ai-insights-v3/dashboard/views/regional_gtm.py`

---

## Contexto

El founder identificó que la página Regional/GTM tenía datos valiosos pero no contaba una historia regional coherente. Los equipos de GTM y Marketing Regional no podían responder "¿dónde debo enfocar mis esfuerzos este trimestre?" leyendo la página de arriba a abajo. La solución fue reorganizar en 3 bloques con preguntas orientadoras y aplicar 9 cambios específicos.

---

## Resumen de cambios implementados

| # | Prioridad | Cambio | Estado |
|---|-----------|--------|--------|
| 1 | 🔴 Crítico | Reorganizar en secciones A / B / C con preguntas orientadoras | ✅ |
| 2 | 🔴 Crítico | Renombrar gráfico de países | ✅ |
| 3 | 🔴 Crítico | Reemplazar Top 5 → Top 3 pains por región con % | ✅ |
| 4 | 🔴 Crítico | Mostrar columna "Relación" completa en tabla de Competidores | ✅ |
| 5 | 🔴 Crítico | Unificar tablas de pipeline en una sola | ✅ |
| 6 | 🟡 Mejora | Heatmap de módulos: solo intensidad de color (sin números) | ✅ |
| 7 | 🟡 Mejora | Agregar selector de país sobre tabla de Competidores | ✅ |
| 8 | 🟡 Mejora | KPIs de concentración de pipeline al inicio de sección C | ✅ |
| 9 | 🟡 Mejora | % de cobertura debajo de cada país en el gráfico de señales | ✅ |

---

## Detalle de cada cambio

### 🔴 Cambio 1 — Reorganizar en secciones A / B / C

**Problema:** La página mezclaba volumen de insights, distribución de pains y pipeline sin separación clara.

**Solución:** Se agregaron tres `st.subheader()` como encabezados de sección:
- `"A. ¿Dónde estamos teniendo más conversaciones?"` — antes del gráfico de países
- `"B. ¿Qué encontramos en cada mercado?"` — antes del gráfico de pains
- `"C. ¿Cuánto vale cada mercado?"` — antes de la sección de pipeline

**Implementación:** `regional_gtm.py` líneas 17, 68, 157

---

### 🔴 Cambio 2 — Renombrar gráfico de países

**Problema:** El título "Top 15 Paises por Insights (breakdown por tipo)" y el eje X "Insights" no explicaban qué representaba el dato.

**Solución:**
- Título: `"¿En qué países tenemos más señales de venta?"`
- Eje X: `"Cantidad de insights únicos detectados"`

**Implementación:** `regional_gtm.py` parámetros `title` y `labels` del `px.bar`

---

### 🔴 Cambio 3 — Top 3 pains por región con % de demos

**Problema:** El gráfico mostraba Top 5 pains con frecuencia absoluta, haciendo imposible comparar regiones de distinto tamaño.

**Solución:** Nuevo cálculo basado en demos únicas (transcript_id):
- **Denominador:** `transcript_id.nunique()` por región (demos únicas con al menos un pain en esa región)
- **Numerador:** `groupby(pain).transcript_id.nunique()` (demos únicas donde apareció ese pain)
- **Porcentaje:** `(demos_pain / demos_region) * 100`
- Máximo 3 pains por región

**Visualización:** `px.bar` con `facet_col="Region"` (mini-gráfico independiente por región), ejes X e Y independientes por facet (`matches=None`), etiquetas de % sobre las barras.

**Implementación:** `regional_gtm.py` líneas 72–114

---

### 🔴 Cambio 4 — Columna "Relación Principal" sin truncar

**Problema:** La columna se mostraba cortada en la UI de Streamlit (ej: "Usa ac...").

**Solución:** Se agregó `column_config` al `st.dataframe()` con `TextColumn(width="large")` para la columna "Relacion Principal" y `TextColumn(width="medium")` para "Competidor".

**Implementación:** `regional_gtm.py` parámetro `column_config` del `st.dataframe`

---

### 🔴 Cambio 5 — Tabla de pipeline unificada

**Problema:** Había dos tablas separadas: "Revenue por Segmento x Region" y "Deals por Segmento x Region". Requerían comparación manual.

**Solución:** Una sola tabla pivot donde cada celda muestra `"Rev | Deals | Ticket Promedio"`. Formato por celda: `f"{format_currency(revenue)} | {int(deals)} | {format_currency(avg) if avg > 0 else '—'}"`. Celdas vacías muestran `"—"`.

**Implementación:** `regional_gtm.py` función `_format_cell` y `coverage.pivot(..., values="celda")`

---

### 🟡 Cambio 6 — Heatmap de módulos: solo intensidad de color

**Problema:** El heatmap mostraba números dentro de cada celda, resultando en un gráfico saturado de texto.

**Solución:** Se eliminó `text_auto=True` de `px.imshow()`. Los números siguen disponibles al hacer hover sobre cada celda (comportamiento nativo de Plotly). Se actualizó el tooltip para indicar: "Más oscuro = más menciones. Hover sobre cada celda para ver la cantidad exacta."

**Implementación:** `regional_gtm.py` línea del `px.imshow`

---

### 🟡 Cambio 7 — Selector de país en tabla de Competidores

**Problema:** La tabla mostraba todos los países en una lista larga sin forma de filtrar.

**Solución:** Se agregó `st.selectbox("Filtrar por país:", ["(Todos)"] + sorted_countries, key="rg_comp_country_filter")` antes de la tabla. Seleccionar "(Todos)" muestra todos los registros; seleccionar un país filtra la tabla a ese país.

**Implementación:** `regional_gtm.py` líneas 142–152

---

### 🟡 Cambio 8 — KPIs de concentración de pipeline

**Problema:** No había ningún número de alto nivel que comunicara la distribución del pipeline entre regiones.

**Solución:** Se agregaron 3 `st.metric()` al inicio de la sección C:
1. **"Región con más pipeline"** — región con mayor % del revenue total, con delta mostrando `"{pct}% del total"`
2. **"Pipeline total"** — suma total del revenue de deals únicos con región asignada
3. **"Mayor ticket promedio"** — región con el ticket más alto (revenue / deals únicos), con nombre de región como delta

**Cálculo:** Se deduplicó por `deal_id` antes de agregar, luego `groupby("region").agg(revenue=("amount","sum"), deals=("deal_id","nunique"))`.

**Implementación:** `regional_gtm.py` líneas 166–202

---

### 🟡 Cambio 9 — % de cobertura en etiquetas del gráfico de países

**Problema:** El gráfico de países mostraba volumen absoluto sin contexto proporcional.

**Solución:** Se calculó el porcentaje de cada país sobre el total de insights del top 15 (`country_count / grand_total * 100`) y se incorporó al label del eje Y usando HTML de Plotly: `f"{country}<br><sub>{pct}%</sub>"` vía `fig.update_yaxes(tickmode="array", tickvals=..., ticktext=...)`.

**Implementación:** `regional_gtm.py` líneas 30–53

---

## Estructura final de la página

```
st.header("Regional / GTM")

A. ¿Dónde estamos teniendo más conversaciones?
  → ¿En qué países tenemos más señales de venta? (barras apiladas, % en eje Y)

B. ¿Qué encontramos en cada mercado?
  → Top 3 Pains por Región (facetado, % de demos únicas)
  → Módulos Demandados por Región (heatmap de color, sin números)
  → Competidores por País
    [Selector de país]
    [Tabla con columnas: Pais | Competidor | Menciones | Relación Principal (ancha)]

C. ¿Cuánto vale cada mercado?
  [KPI: Región top] [KPI: Pipeline total] [KPI: Mayor ticket promedio]
  → Pipeline por Segmento × Región (Revenue | Deals | Ticket Promedio por celda)
```

---

## QA Checklist

### Sección A
- [ ] Subheader "A. ¿Dónde estamos teniendo más conversaciones?" visible
- [ ] Título del gráfico: "¿En qué países tenemos más señales de venta?"
- [ ] Eje X: "Cantidad de insights únicos detectados"
- [ ] Cada país en eje Y muestra `<País><br><sub>NN%</sub>`
- [ ] Verificación manual: % de un país = count_país / sum_top15 × 100

### Sección B — Pains
- [ ] Subheader "B. ¿Qué encontramos en cada mercado?" visible
- [ ] Un mini-gráfico por región (facetado), no barras agrupadas
- [ ] Máximo 3 barras por facet
- [ ] Título del facet = nombre de región (sin prefijo "Region=")
- [ ] Ejes X e Y independientes por facet
- [ ] Verificación manual: % de un pain = unique_transcripts_pain / total_transcripts_region × 100

### Sección B — Heatmap
- [ ] Sin números dentro de las celdas
- [ ] Gradiente de color visible (más oscuro = más menciones)
- [ ] Al hacer hover se muestra la cantidad exacta

### Sección B — Competidores
- [ ] "Relación Principal" no está truncada (ej: "Usa actualmente" completo)
- [ ] Selectbox "Filtrar por país:" visible sobre la tabla
- [ ] "(Todos)" muestra todas las filas
- [ ] Seleccionar un país filtra correctamente
- [ ] Volver a "(Todos)" restaura todas las filas

### Sección C
- [ ] Subheader "C. ¿Cuánto vale cada mercado?" visible
- [ ] 3 métricas KPI presentes con valores no vacíos
- [ ] Una sola tabla de pipeline (no dos tablas separadas)
- [ ] Celdas con datos muestran `"$XK | N | $YK"`
- [ ] Celdas vacías muestran `"—"`
- [ ] Verificación cruzada: Revenue de una celda coincide con suma de `amount` para ese segmento × región

### Regresión
- [ ] Filtros inline ("Filtros") siguen funcionando y actualizan las 3 secciones
- [ ] Sin crash cuando se filtra a una sola región (1 facet en gráfico de pains)
- [ ] Sin crash cuando `pipeline_data` queda vacío después de filtrar
- [ ] Sin excepciones Python en la carga de la página

---

## Notas técnicas

- **Archivo modificado:** Solo `regional_gtm.py` (146 → ~230 líneas). Sin cambios en `shared.py`, `computations.py`, `app.py`.
- **Patrones reutilizados:** `st.subheader()` para secciones A/B/C (igual que `sales_enablement.py`), `st.metric()` para KPIs, `st.selectbox()` con "(Todos)" como primera opción, `st.column_config.TextColumn(width="large")`.
- **Cálculo de % de pains:** No usa `cached_pains_with_pct()` de `computations.py` porque ese helper calcula % sobre el total global, no por región. El cálculo por región se hace inline.
- **Deduplicación en pipeline:** `drop_duplicates("deal_id")` antes de cualquier aggregation, igual que en la versión anterior. Los KPIs y la tabla unificada usan la misma base deduplicada.
