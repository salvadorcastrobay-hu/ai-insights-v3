# Sales Enablement — Cambios implementados

Fuente: [Sales Enablement — Feedback](https://www.notion.so/humand-co/Sales-Enablement-Feedback-3216757f313081d2b332ef3e36d51517)
Archivo modificado: `views/sales_enablement.py`

---

## Cambio 1 — 🟡 Agregar KPI: Fricciones promedio por deal

**Prioridad:** Alta
**Sección:** A. ¿Qué está frenando los deals?

Se agregó un cuarto KPI junto a los tres existentes (Total Fricciones, Deals Afectados, Revenue en Riesgo).

- **Métrica:** `Total Fricciones / Deals Afectados`
- **Valor esperado:** ~2.4
- **Propósito:** Indica qué tan complicados son los deals en promedio y permite comparar por AE o por segmento.

```python
avg_fric_per_deal = round(total_fricciones / deals_afectados, 1) if deals_afectados > 0 else 0
col4.metric("Fricciones por deal", avg_fric_per_deal, ...)
```

---

## Cambio 2 — 🔴 Cambiar título del gráfico de Tipos de Fricción

**Prioridad:** Alta
**Sección:** A. ¿Qué está frenando los deals?

- **Antes:** `"Tipos de Friccion"`
- **Después:** `"¿Qué está frenando más los deals?"`

Además se corrigió la unidad de medida: el eje X ahora representa **deals únicos** donde apareció esa fricción (`drop_duplicates(["deal_id", "insight_subtype_display"])`), no detecciones totales.

---

## Cambio 3 — 🟡 Agregar panel de desglose de las 2 fricciones principales

**Prioridad:** Alta
**Sección:** A. ¿Qué está frenando los deals?

Se agregó un panel lateral ("Fricción Breakdown — Top 2") al lado derecho del gráfico de Tipos de Fricción. Muestra:

- El nombre de cada una de las 2 fricciones más frecuentes
- La cantidad de deals en los que aparece y su porcentaje sobre el total de deals afectados
- Subtemas o contextos dentro de cada fricción

**Propósito:** Un AE no solo debe saber que hay "restricción presupuestaria" sino de qué tipo, para preparar el argumento correcto.

---

## Cambio 4 — 🔴 Cambiar título del gráfico de Fricción por Segmento

**Prioridad:** Media
**Sección:** A. ¿Qué está frenando los deals?

- **Antes:** `"Friccion por Segmento"`
- **Después:** `"¿Varía la fricción según el tamaño de empresa?"`

También se corrigió la unidad de medida a deals únicos (no detecciones).

---

## Cambio 5 — 🔴 Cambiar título del gráfico Fricción x Etapa del Deal

**Prioridad:** Alta
**Sección:** A. ¿Qué está frenando los deals?

- **Antes:** `"Friccion x Etapa del Deal"`
- **Después:** `"¿En qué etapa del deal aparece cada fricción?"`

También se corrigió la unidad de medida a deals únicos en el heatmap.

---

## Cambio 6 — 🟡 Agregar lectura orientadora debajo del gráfico Fricción x Etapa del Deal

**Prioridad:** Media
**Sección:** A. ¿Qué está frenando los deals?

Se agregó el siguiente texto explicativo (`st.info`) debajo del heatmap:

> *"Si una fricción aparece mucho en Discovery, es una señal de que hay que abordarla desde el principio de la conversación. Si aparece en Final Negotiation o Postponed, es un bloqueante tardío que necesita un argumento preparado de antemano."*

---

## Cambio 7 — 🟡 Agregar gráfico: Blockers por Industria

**Prioridad:** Media
**Sección:** A. ¿Qué está frenando los deals?

Se agregó un heatmap de fricciones por industria (no existía en el código anterior).

- **Título:** `"¿Qué fricción predomina según la industria?"`
- **Tipo:** Heatmap — fricción por fila, industria por columna
- **Unidad:** Deals únicos

---

## Cambio 8 — 🔴 Cambiar ordenamiento de la Tabla Performance por AE

**Prioridad:** Alta
**Sección:** B. ¿Qué AEs necesitan más soporte?

- **Antes:** Ordenada por `Insights` (total de insights) descendente — no refleja performance real
- **Después:** Ordenada por `Fricc/deal` (fricciones promedio por deal) descendente

El AE con más fricciones por deal es quien más coaching necesita y ahora aparece primero.

---

## Cambio 9 — 🟡 Agregar columnas en la tabla de AEs: Fricc/deal y % c/fricción

**Prioridad:** Alta
**Sección:** B. ¿Qué AEs necesitan más soporte?

Se agregaron dos columnas nuevas a la tabla de AEs:

| Columna nueva | Cálculo | Por qué |
|---|---|---|
| `Fricc/deal` | Total Fricciones / Deals | Ratio de complejidad — el AE con más fricciones/deal necesita más coaching |
| `% c/fricción` | Deals con ≥1 fricción / Deals totales × 100 | De todos sus deals, en qué porcentaje aparece al menos una fricción |

---

## Cambio 10 — 🔴 Cambiar ordenamiento del gráfico Fricciones por AE

**Prioridad:** Alta
**Sección:** B. ¿Qué AEs necesitan más soporte?

- **Antes:** Los AEs aparecían en orden alfabético (no interpretable de un vistazo)
- **Después:** Ordenados por **total de fricciones descendente** — el AE con más fricciones aparece primero

Se usa `category_orders` de Plotly Express para forzar el orden correcto.

---

## Cambio 11 — 🔴 Cambiar título del gráfico Fricciones por AE

**Prioridad:** Media
**Sección:** B. ¿Qué AEs necesitan más soporte?

- **Antes:** `"Fricciones por AE (Top 10)"`
- **Después:** `"¿Qué tipo de fricciones enfrenta cada AE?"`

---

## Cambio 12 — 🟡 Agregar contexto orientador al inicio de la sección C

**Prioridad:** Media
**Sección:** C. ¿Qué preguntan los prospects? (Battle Cards)

Se agregó el siguiente callout introductorio (`st.info`) al inicio de la sección C:

> *"Estas son las preguntas que los prospects hacen más frecuentemente en las primeras demos. Usá esta sección para preparar respuestas antes de una llamada. Las integraciones y los precios son los temas más frecuentes — si tu próxima demo es con una empresa enterprise, revisá también seguridad y compliance regulatorio."*

---

## Cambio 13 — 🔴 Cambiar título del gráfico FAQs por Topic

**Prioridad:** Media
**Sección:** C. ¿Qué preguntan los prospects? (Battle Cards)

- **Antes:** `"FAQs por Topic"`
- **Después:** `"¿Qué temas preguntan más los prospects?"`

También se corrigió la unidad de medida a **demos únicas** donde se hizo esa pregunta.

---

## Cambio 14 — 🟡 Agregar panel de desglose de los 2 topics de FAQ más frecuentes

**Prioridad:** Alta
**Sección:** C. ¿Qué preguntan los prospects? (Battle Cards)

Se agregó un panel lateral ("FAQ Breakdown — Top 2 topics") al lado derecho del gráfico de FAQs. Muestra:

- Los 2 topics más frecuentes con su cantidad de demos
- Las preguntas más comunes dentro de cada topic con porcentaje relativo

**Propósito:** El desglose de integraciones es especialmente útil porque cada subtipo implica una respuesta diferente (API, nómina, biométricos, SSO).

---

## Cambio 15 — 🟡 Agregar filtro/selector por topic en la tabla de Preguntas y Respuestas

**Prioridad:** Alta
**Sección:** C. ¿Qué preguntan los prospects? (Battle Cards)

Se agregó un `st.selectbox` con opciones "Todos" + lista de topics que filtra la tabla de Q&A en tiempo real.

**Propósito:** Permite al AE filtrar antes de una demo específica y ver solo las preguntas del topic relevante.

---

## Cambio 16 — 🟡 Mejorar tabla de Preguntas y Respuestas

**Prioridad:** Media
**Sección:** C. ¿Qué preguntan los prospects? (Battle Cards)

Se realizaron las siguientes mejoras a la tabla:

1. **Columnas renombradas** a español claro: Empresa, Topic, Pregunta, Cita textual
2. **Columnas de texto ampliadas** mediante `st.column_config.TextColumn(..., width="large")` para que la columna "Pregunta" y "Cita textual" no queden truncadas
3. **Título actualizado** a "Preguntas y Respuestas por Topic" con caption orientador

---

## Cambio 17 — 🔴 Corregir unidad de medida en todos los gráficos

**Prioridad:** Alta
**Sección:** Toda la página

En todos los gráficos donde se cuentan fricciones o FAQs se reemplazó el conteo por filas (detecciones totales) por conteo de **deals únicos** o **demos únicas** usando `drop_duplicates` antes del `groupby`.

Esto evita que un deal con muchas fricciones del mismo tipo distorsione los rankings.

---

## Resumen de cambios

| # | Tipo | Qué se hizo |
|---|---|---|
| 1 | 🟡 Agregar | KPI: Fricciones promedio por deal |
| 2 | 🔴 Cambiar | Título gráfico Tipos de Fricción → "¿Qué está frenando más los deals?" |
| 3 | 🟡 Agregar | Panel de desglose de las 2 fricciones principales |
| 4 | 🔴 Cambiar | Título gráfico Fricción por Segmento → "¿Varía la fricción según el tamaño de empresa?" |
| 5 | 🔴 Cambiar | Título gráfico Fricción x Etapa → "¿En qué etapa del deal aparece cada fricción?" |
| 6 | 🟡 Agregar | Lectura orientadora debajo del gráfico Fricción x Etapa del Deal |
| 7 | 🟡 Agregar | Gráfico nuevo: Blockers por Industria → "¿Qué fricción predomina según la industria?" |
| 8 | 🔴 Cambiar | Tabla AEs: ordenar por Fricc/deal en lugar de Insights totales |
| 9 | 🟡 Agregar | Columnas en tabla AEs: Fricc/deal y % c/fricción |
| 10 | 🔴 Cambiar | Gráfico Fricciones por AE: ordenar por total de fricciones descendente |
| 11 | 🔴 Cambiar | Título gráfico Fricciones por AE → "¿Qué tipo de fricciones enfrenta cada AE?" |
| 12 | 🟡 Agregar | Texto introductorio orientador en sección C |
| 13 | 🔴 Cambiar | Título gráfico FAQs por Topic → "¿Qué temas preguntan más los prospects?" |
| 14 | 🟡 Agregar | Panel de desglose de los 2 topics de FAQ más frecuentes |
| 15 | 🟡 Agregar | Filtro/selector por topic en tabla de Preguntas y Respuestas |
| 16 | 🟡 Agregar | Mejoras a tabla Q&A: columnas renombradas, texto sin truncamiento |
| 17 | 🔴 Cambiar | Unidad de medida corregida a deals/demos únicos en todos los gráficos |
