# Regional / GTM — Feedback Round 2

## Resumen
Se implementaron los 5 ajustes solicitados para mejorar legibilidad visual, contexto de interpretación y consistencia de cobertura en la página **Regional / GTM**.

## Cambios aplicados

### 1) Top 3 Pains convertido a heatmap con intensidad de color
- Se reemplazó el gráfico `px.bar(..., facet_col="Region")` por un heatmap con `px.imshow()`.
- Se construyó pivot con:
  - filas = `Pain`
  - columnas = `Region`
  - valores = `Pct`
- Se aplicó escala con tratamiento explícito de ceros:
  - `[[0.0, DS["neutral_100"]], [0.001, DS["brand_50"]], [0.5, DS["brand_400"]], [1.0, DS["blueprimary_800"]]]`
- Se agregó anotación en celdas usando `annotate_heatmap(...)` y se convirtió el texto a formato porcentaje (`%`).
- Se agregó nota contextual:
  - "Los 3 pains principales son consistentes en todas las regiones. Las diferencias están en la intensidad (%)"

### 2) Heatmap de Módulos con anotaciones numéricas y nueva escala
- Se reemplazó `BRAND_SCALE` por la misma escala custom con tratamiento de ceros.
- Se agregó `annotate_heatmap(...)` para mostrar valores en todas las celdas.
- Se mantuvo `apply_ds_layout(...)` y `chart_tooltip(...)`.

### 3) % de cobertura en todos los países
- Se corrigió la lógica de `%` para etiquetas del eje Y.
- Ahora `country_order` y `pct_map` se derivan de `country_totals` (conteo original por país), no de `country_sums` sobre `country_breakdown`.
- Resultado: todos los países del top aparecen con porcentaje, incluso si faltan categorías en `insight_type_display`.

### 4) KPI "Mayor ticket promedio" con conteo de deals
- Se agregó el conteo de deals de la región con mayor ticket promedio.
- El delta del KPI ahora muestra:
  - `"<Región> — <N> deals"`

### 5) Nota contextual para concentración de HISPAM
- Se añadió mensaje condicional debajo de KPIs cuando:
  - `top_region_name == "HISPAM"`
  - deals de HISPAM `< 15`
- Mensaje:
  - "El pipeline de HISPAM está concentrado en pocos deals de ticket alto. El volumen de datos es menor que el de Brasil."

## Archivo modificado
- `views/regional_gtm.py`

## Archivo nuevo
- `regional-gtm-feedback-round2.md`
