# Executive Summary — Feedback Round 2

Registro de cambios implementados en `views/executive_summary.py` y `computations.py` a partir de la segunda ronda de revisión de la página (comparada contra el PDF capturado el 13/03/26).

**Propósito de la página:** Vista ejecutiva de alto nivel que consolida las señales detectadas en demos: pains, gaps de producto, competidores, fricciones y FAQs. Audiencia: liderazgo comercial y de producto.

---

## Cambios implementados

### 1. 🔴 Top 10 Pains — % sobre total de demos ahora visible

**Qué:** El label `% del total` en cada barra del gráfico "Top 10 Pains" ya era calculado, pero no se veía porque el eje X no tenía espacio suficiente para renderizar el texto afuera de la barra. Además, el denominador era incorrecto (solo contaba demos con pains, no todos los transcripts).

**Correcciones:**
1. Denominador cambiado: `total_transcripts` (total global de transcripts en la DB) en lugar de demos con pain únicamente. Esto da el % real: "X% de todas las demos mencionaron este pain."
2. Padding en eje X: `range=[0, max_demos * 1.25]` para que los labels `textposition="outside"` no queden cortados por el borde del gráfico.

**Archivos:** `computations.py` (función `cached_pains_with_pct`, nuevo param `total_transcripts`), `views/executive_summary.py` (líneas ~196-215).

---

### 2. 🔴 Feature Gaps — Revenue Impact: eje X con formato consistente

**Qué:** El eje X usaba `tickformat="$,.2s"` de d3, que produce notación SI con K minúscula (`$500k`), inconsistente con el formato del resto del dashboard (`$500K` mayúscula, via `format_currency()`).

**Corrección:** Reemplazado por `tickvals`/`ticktext` generados dinámicamente usando la función `format_currency()` existente en `shared.py`. Genera 5 ticks uniformes de `$0` al máximo, con formato consistente (`$0`, `$100K`, `$200K`, etc.) independiente del rango de los datos. Se agrega también padding `range=[0, max * 1.25]` para los labels externos.

**Archivo:** `views/executive_summary.py` (líneas ~385-400).

---

### 3. 🟡 Pain Insights — Desglose por subtemas (pain_theme)

**Qué:** El desglose de los 2 principales pains ya mostraba los módulos donde aparece cada pain (perspectiva de producto: *dónde* ocurre). Se agregó un segundo nivel que muestra los **pains relacionados del mismo tema** (perspectiva de marketing: *qué tipo de problema* es).

**Lógica:** Para cada uno de los top 2 pains, se identifica su `pain_theme` (ej. "processes", "technology") y se muestran los otros pains que comparten ese tema, ordenados por frecuencia de demos únicas. Esto responde "¿Qué tipo de procesos manuales?" mostrando subcategorías como "Cuellos de botella en procesos", "Falta de autogestión", etc.

**Implementación:**
- Usa la columna `pain_theme` ya disponible en el DataFrame (viene del view `v_insights_dashboard`)
- Usa `humanize()` de `shared.py` para convertir el código del tema a español (ej. "processes" → "Procesos")
- Se agrega `humanize` al import de `shared` en `executive_summary.py`
- Cap de 6 subtemas por pain, misma altura (240px) que el desglose por módulo

**Archivo:** `views/executive_summary.py` (nueva sección después de línea ~255).

---

### 4. 🟡 KPI "Calls con Insights" — Destacado visualmente como cifra positiva

**Qué:** La métrica "Calls con Insights" (ej. 88.4%) es la cifra más positiva del header pero tenía el mismo peso visual que las demás. Se le agregó un indicador verde.

**Corrección:** Parámetro `delta="Positivo"` con `delta_color="normal"` en `st.metric()`. Esto renderiza una flecha verde hacia arriba con el texto "Positivo", consistente con el patrón usado en `competitive_intelligence.py` y `regional_gtm.py`.

**Archivo:** `views/executive_summary.py` (línea ~115).

---

### 5. 🟡 Módulos más buscados — % del total de demos

**Qué:** El gráfico "Módulos más buscados en la primera Demo" mostraba solo conteo absoluto de demos. Se agregó el porcentaje sobre el total de transcripts para contextualizar cada barra.

**Corrección:**
- Nueva columna `% del total`: `Demos / total_transcripts * 100`
- Labels externos con `text="% del total"` y `textposition="outside"`
- Padding `range=[0, max * 1.25]` para evitar corte de texto

**Archivo:** `views/executive_summary.py` (líneas ~303-325).

---

### 6. 🟡 Feature Gaps — Frecuencia: % del total de deals

**Qué:** El gráfico "Top 10 Feature Gaps — Frecuencia" mostraba solo frecuencia absoluta. Se agregó el porcentaje sobre el total de deals con product gaps.

**Corrección:**
- Denominador: total de deals únicos con al menos un product gap (`gaps["deal_id"].dropna().nunique()`)
- Nueva columna `% del total`: `frecuencia / total_gap_deals * 100`
- Labels externos con `text="% del total"` y `textposition="outside"`
- Padding `range=[0, max * 1.25]`

**Archivo:** `views/executive_summary.py` (líneas ~336-360).

---

## Resumen de cambios

| # | Prioridad | Cambio | Archivo(s) |
|---|-----------|--------|------------|
| 1 | 🔴 Fix | Top 10 Pains: denominador corregido + padding eje X para labels visibles | `computations.py`, `executive_summary.py` |
| 2 | 🔴 Fix | Feature Gaps Revenue: eje X con formato `$K` consistente via `format_currency()` | `executive_summary.py` |
| 3 | 🟡 Mejora | Pain breakdown: desglose de subtemas por `pain_theme` además de módulos | `executive_summary.py` |
| 4 | 🟡 Mejora | KPI "Calls con Insights": indicador verde `delta="Positivo"` | `executive_summary.py` |
| 5 | 🟡 Mejora | Módulos más buscados: % del total de demos en cada barra | `executive_summary.py` |
| 6 | 🟡 Mejora | Feature Gaps Frecuencia: % del total de deals en cada barra | `executive_summary.py` |
