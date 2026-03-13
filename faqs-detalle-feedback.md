# FAQs — Detalle — Feedback

Registro de cambios implementados en `views/faq_detail.py` a partir del feedback del founder (Notion: FAQs — Detalle — Feedback, 2026-03-12).

**Propósito de la página:** Vista granular de preguntas frecuentes detectadas en demos, con dos audiencias:
- **Sales Enablement / AEs:** base para construir Battle Cards con respuestas preparadas.
- **Marketing:** identificar gaps de contenido en el sitio y materiales pre-demo.

---

## Cambios implementados

### 1. 🔴 KPI: Tercer métrica "Preguntas por Demo"
**Qué:** Se agregó un tercer KPI al header: `Preguntas por Demo = total_faqs / distinct_deals`.
**Por qué:** Un número alto (ej. 15.8) indica que los prospects llegan con muchas dudas no resueltas antes de la primera llamada — señal directa para Marketing de gaps en el contenido pre-demo. Si ese número baja con el tiempo, el contenido educativo está funcionando.
**Implementación:** `ratio = total_faqs / distinct_deals`. Layout cambiado de 2 a 3 columnas. Cada KPI ahora tiene un `st.caption()` con contexto adicional.

---

### 2. 🔴 Gráfico: Métrica cambiada a deals únicos (COUNT DISTINCT)
**Qué:** El eje X del gráfico "FAQs por Topic" ahora muestra **deals únicos** (`COUNT DISTINCT deal_id`) en lugar de conteo de menciones brutas.
**Por qué:** "Integraciones — 68% de demos" es mucho más accionable para un AE que "Integraciones — 1,850 menciones". La primera dice qué tan prevalente es el topic; la segunda puede estar inflada por múltiples detecciones en un mismo deal.
**Campo:** `faqs.groupby("insight_subtype_display")["deal_id"].nunique()`

---

### 3. 🟡 Gráfico: Porcentaje sobre total de demos en cada barra
**Qué:** Cada barra ahora muestra la etiqueta `{deals_únicos} ({%} de demos)` usando `text="label"` en Plotly.
**Por qué:** Contextualiza el número absoluto. Un AE que ve "Precios — 66% de demos" sabe que 2 de cada 3 prospects preguntarán sobre precios.
**Cálculo:** `deals_con_topic / total_distinct_deals * 100`

---

### 4. 🟡 Gráfico: Callout con lectura clave (top 3 topics)
**Qué:** Se agregó un `st.caption()` arriba del gráfico que identifica los 3 topics más frecuentes y su % de demos.
**Por qué:** Guía la lectura del gráfico hacia la acción más importante: priorizar las Battle Cards de los 3 topics que aparecen en más del 50% de los deals.

---

### 5. 🟡 Nueva sección: Top 5 preguntas por Topic (Battle Cards)
**Qué:** Selector de Topic (dropdown) que al elegir uno muestra las 5 preguntas (`summary`) más frecuentes dentro de ese topic, con su conteo de deals únicos.
**Por qué:** Una Battle Card de "Integraciones" que solo dice "respondemos preguntas sobre integraciones" no sirve. Una que lista las 5 preguntas más comunes con respuestas estándar sí sirve. Este gráfico es el puente entre los datos y la herramienta de ventas.
**Campo usado:** `summary` agrupado por `deal_id.nunique()`. (Si en el futuro se agrega `insight_text` como campo separado, reemplazar `summary` por ese campo.)

---

### 6. 🔴 Tabla: Columna "pregunta_especifica"
**Qué:** Se agregó la columna más importante que faltaba: la pregunta específica detectada en el transcript.
**Mapeo de campos:**
- `verbatim_quote` → `pregunta_especifica` (cita textual del transcript, truncada a 100 chars para la tabla)
- Si `verbatim_quote` no existe: fallback a `summary`
**Por qué:** Sin ver la pregunta específica ("¿el precio varía por módulo?" vs "¿tienen descuento por volumen?"), es imposible construir una Battle Card útil desde la tabla.

---

### 7. 🔴 Tabla: Columnas de contexto del deal
**Qué:** Se agregaron 4 columnas de contexto a la tabla: `segment`, `country`, `deal_stage`, `deal_owner`.
**Por qué:** El caso de uso principal es "Mostrame todas las preguntas de Precios de deals Enterprise en Argentina" — sin estas columnas ese filtro mental es imposible.
**Orden de columnas:** `company_name | topic | pregunta_especifica | segment | country | deal_stage | deal_owner | resumen`

---

### 8. 🔴 Tabla: Filtro de Topic directamente sobre la tabla
**Qué:** Selectbox "Filtrar por Topic" encima de la tabla (los 18 topics disponibles + "Todos").
**Por qué:** El caso de uso más frecuente es filtrar por un topic específico para revisar todas las preguntas de esa categoría. Complementa (no reemplaza) los filtros globales del sidebar.

---

### 9. 🟡 Tabla: Búsqueda de texto libre
**Qué:** Campo de texto "Buscar en preguntas" que filtra filas por palabras clave en `verbatim_quote` y `summary`.
**Por qué:** Permite al AE buscar "WhatsApp" y ver cuántos prospects preguntaron sobre eso sin revisar fila por fila.
**Implementación:** `str.contains(search_text, case=False, na=False)` sobre ambos campos.

---

## Notas técnicas

| Campo en DB | Columna en tabla | Descripción |
|---|---|---|
| `verbatim_quote` | `pregunta_especifica` | Cita textual del transcript (fuente primaria) |
| `summary` | `resumen` | Paráfrasis del modelo del contexto de la pregunta |
| `insight_subtype_display` | Topic | Categoría (Precios, Integraciones, etc.) |
| `deal_id` | — | Usado para COUNT DISTINCT en gráficos |
| `deal_owner` | AE | Nombre del Account Executive |

**Si en el futuro se agrega `insight_text` al modelo de extracción** (el texto exacto de la pregunta tal como fue detectada, distinto del `verbatim_quote` que es la cita del hablante), reemplazar `verbatim_quote` por `insight_text` en la columna `pregunta_especifica` y en la sección de Top 5 preguntas.

---

## Resumen de cambios

| # | Prioridad | Cambio |
|---|---|---|
| 1 | 🔴 | KPI: Preguntas por Demo (total / deals únicos) |
| 2 | 🔴 | Gráfico: métrica cambiada a deals únicos (COUNT DISTINCT) |
| 3 | 🔴 | Tabla: columna `pregunta_especifica` (verbatim_quote) |
| 4 | 🔴 | Tabla: filtro de Topic encima de la tabla |
| 5 | 🟡 | Gráfico: % de demos en cada barra |
| 6 | 🟡 | Gráfico: callout con top 3 topics |
| 7 | 🟡 | Nueva sección: Top 5 preguntas por Topic (Battle Cards) |
| 8 | 🟡 | Tabla: búsqueda de texto libre |
| 9 | 🟡 | Tabla: columnas segment, country, deal_stage, deal_owner |
