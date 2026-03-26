# Pains — Detalle: Segunda Ronda de Feedback

Fecha de implementación: 2026-03-26  
Fuente de evaluación: Notion — "Pains — Segunda ronda" (`3236757f313081f6bd16ee34ceb8b493`)

## Resumen de issues evaluados

1. **KPI "Vinculados a Módulo" = 0**  
   **Estado:** Implementado (bug corregido).

2. **KPIs sin % y ratio por demo**  
   **Estado:** Corregido indirectamente por fix #1 (la estructura de captions ya existía).

3. **Gráfico "Pains por Theme" aún visible**  
   **Estado:** Confirmado como ya resuelto (no está presente en la vista actual).

4. **Tabla sin columnas `segment`, `country`, `deal_stage`, `deal_owner`, `summary`**  
   **Estado:** Confirmado como ya resuelto (`display_cols` ya incluye columnas requeridas y `resumen` se deriva de `summary`).

## Detalle técnico del bug KPI

El cálculo original separaba `general` vs `module_linked` usando `pain_scope` humanizado:

- `general = pains[pains["pain_scope"] == "General"]`
- `module_linked = pains[pains["pain_scope"] == "Vinculado a Módulo"]`

Como en la data los registros llegan con `pain_scope = "general"`, tras `humanize` todos quedan en "General", dejando `module_linked` vacío y forzando KPIs/captions a 100%/0%.

### Fix aplicado

Se reemplazó la lógica para detectar pains vinculados por presencia real de `module_display`:

- Si existe `module_display`:  
  - `module_linked`: filas con `module_display` no nulo y no vacío (trim).  
  - `general`: complemento de ese set.
- Si no existe `module_display`:  
  - `module_linked`: dataframe vacío.  
  - `general`: todos los pains.

Archivo modificado:

- `views/pains_detail.py` (sección KPIs de cabecera, split general/vinculados)
