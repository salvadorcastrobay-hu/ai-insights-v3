# Product Gaps Detalle — Feedback Round 2

Fecha: 2026-03-26

## Alcance
Se implementaron los ajustes de UX solicitados para dejar la vista **Detalle > Product Gaps** más accionable para Product.

Archivo principal modificado:
- `views/product_gaps_detail.py`

## Cambios implementados

### 1) Feature Gaps por Segmento con contexto porcentual
- Se reemplazó la lógica del heatmap para calcular:
  - `seg_total_deals`: deals únicos por segmento (sobre todos los product gaps).
  - `deals_feature_segment`: deals únicos por par `(feature, segment)`.
  - `pct`: `% de deals del segmento que mencionaron ese gap`.
- El heatmap ahora usa `pct` como valor `z` y mantiene `BRAND_SCALE`.
- Se añadió sufijo `%` y título de colorbar.
- Se agregaron anotaciones por celda con formato:
  - `conteo absoluto` + `%` entre paréntesis (ej. `82 (25%)`).
- Se añadió caption aclaratorio:
  - `% de los deals del segmento que mencionaron este gap. Número entre paréntesis = deals absolutos.`

### 2) Tabla de Prioridad con Revenue en Riesgo
- Se agregó columna **Revenue en Riesgo** en la tabla de distribución por prioridad.
- Cálculo por bucket de prioridad:
  - tomar `deal_id` únicos que mencionaron esa prioridad;
  - sumar `amount` por esos deals únicos;
  - formatear con `format_currency()`.
- Se añadió caption explicativo de cálculo:
  - `Revenue en Riesgo = suma del amount de los deals únicos que mencionaron este tipo de gap.`

### 3) Highlight visual para Dealbreaker en tabla de detalle
- La tabla de detalle ahora se renderiza con `pandas.Styler`.
- Filas con `gap_priority == "dealbreaker"` se pintan con:
  - fondo `#fff0f0`
  - texto `#303036`

### 4) Column labels explícitos en tabla de detalle
Se agregó `column_config` con encabezados:
- `company_name` → `Empresa`
- `feature_display` → `Feature`
- `module_display` → `Módulo`
- `gap_priority_display` → `Prioridad`
- `segment` → `Segmento`
- `country` → `País`
- `deal_stage` → `Etapa`
- `deal_owner` → `AE`
- `resumen` → `Resumen (120 chars)`

## Verificación funcional esperada
En **Detalle > Product Gaps** debe verse:
- Heatmap de segmento con escala en `%` y anotaciones de `absoluto + porcentaje`.
- Tabla de prioridad con columna `Revenue en Riesgo` en formato monetario.
- Tabla detalle con los 9 campos y headers en español.
- Filas Dealbreaker con tinte rojo claro.

## Notas
- No se hicieron cambios en la definición de `% del Total` ni en textos de significado de prioridades, ya estaban completos.
