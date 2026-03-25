# Product Intelligence — Segunda Ronda de Mejoras

Documentación de los cambios implementados en la página Product Intelligence como parte de la segunda ronda de revisión.

---

## Cambios implementados

### 1. Pain Breakdown — Desglose por subtipos en lugar de módulos

**Archivo:** `views/product_intelligence.py`

**Problema:** El panel "Pain Breakdown" mostraba los 2 pains más frecuentes desglosados por módulo (respondía "¿dónde aparece el pain?"), lo que no era accionable para Marketing.

**Solución:** Se cambió el desglose para mostrar los **2 themes de pain más frecuentes** (`pain_theme`) con sus **subtipos específicos** (`insight_subtype_display`) dentro de cada theme. El título de cada gráfico incluye el total de demos y el porcentaje sobre el total de pains.

- Antes: Top 2 `insight_subtype_display` × módulos
- Ahora: Top 2 `pain_theme` × `insight_subtype_display` dentro del theme

---

### 2. Top 15 Pains — Etiquetas de % visibles en las barras

**Archivo:** `views/product_intelligence.py`

**Problema:** El porcentaje sobre el total de demos solo aparecía en el tooltip al pasar el cursor, no era visible directamente en el gráfico.

**Solución:** Se agregaron etiquetas de texto al final de cada barra con el formato `"N (X%)"`, por ejemplo: `"2,645 (58.6%)"`. El denominador ahora usa el total de demos del dataset filtrado (`df["transcript_id"].nunique()`), no solo las demos con pains.

Cambios técnicos:
- Se pasa `total_transcripts=df["transcript_id"].nunique()` a `cached_pains_with_pct()`
- Se agrega columna `label` con formato `"{demos:,} ({pct}%)"`
- Se usa `text="label"` + `textposition="outside"` en Plotly
- El rango del eje X se extiende a `1.35x` para evitar que las etiquetas queden cortadas

---

### 3. Pains por Theme — Movido a expander colapsado al final

**Archivo:** `views/product_intelligence.py`

**Problema:** El gráfico "Pains por Theme" aparecía mezclado en el flujo principal de la sección A, interrumpiendo la narrativa antes del selector de detalle por pain.

**Solución:** Se eliminó del flujo principal y se reubicó **después del selector "Detalle por Pain"**, dentro de un `st.expander` colapsado por defecto:

```
▶ Pains por Theme (referencia adicional)
```

El contenido es idéntico al anterior; solo cambia su posición y visibilidad por defecto.

---

### 4. Tabla de prioridad de gaps — Columna de revenue promedio por deal

**Archivo:** `views/product_intelligence.py`

**Problema:** La tabla de prioridad en la Sección C mostraba el revenue total por prioridad, pero los números podían ser difíciles de comparar si las cantidades de deals son muy distintas entre categorías (por ejemplo, Dealbreaker con pocos deals pero de alto valor).

**Solución:** Se agregó la columna **"Avg Revenue / Deal"** que muestra el revenue promedio por deal único para cada nivel de prioridad. Se añadió también un caption explicativo debajo de la tabla:

> _"El revenue promedio por deal ayuda a comparar prioridades: Dealbreaker puede tener menos deals pero mayor ticket promedio."_

**Resultado en datos actuales:**
| Prioridad | Features | Revenue | Avg Revenue / Deal |
|---|---|---|---|
| Dealbreaker | 4 | $8,788 | $976 |
| Debe tener | 554 | $3,426,683 | $1K |
| Deseable | 53 | $137,901 | $1K |

Esto confirma que el bajo revenue total de Dealbreaker es un problema de volumen (solo 4 features × pocos deals), no un bug de datos.

---

### 5. Detalle por Feature Gap — Columna AE asignado

**Archivo:** `views/product_intelligence.py`

**Problema:** La tabla del selector "Detalle por Feature Gap" no incluía información del Account Executive asignado al deal, lo que impedía tomar acción directa desde el dashboard.

**Solución:** Se agregó la columna `deal_owner` (AE asignado) entre `country` y `module_display` en la lista de columnas de `gap_detail_cols`.

Columnas resultantes: `company_name`, `industry`, `segment`, `country`, **`deal_owner`**, `module_display`, `gap_priority`, `amount`, `summary`, `verbatim_quote`, `confidence`

---

## Archivos modificados

| Archivo | Tipo de cambio |
|---|---|
| `views/product_intelligence.py` | Único archivo modificado — contiene los 5 cambios |

---

## Notas de implementación

- Se importaron `pandas as pd` y `format_currency` (de `shared.py`) para soporte de los cambios 2 y 4.
- Todos los estilos siguen el design system existente: `DS["brand_400"]`, `DS["palette"]`, `apply_ds_layout()`.
- Los keys de los widgets Plotly se actualizaron donde fue necesario para evitar conflictos de estado en Streamlit.
- El campo `deal_owner` ya existía en `DASHBOARD_COLUMNS` de `shared.py` y en la vista `v_insights_dashboard` del schema, por lo que no requirió cambios en la capa de datos.
