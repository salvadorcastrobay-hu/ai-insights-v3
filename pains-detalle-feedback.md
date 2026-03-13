# Pains — Detalle — Feedback

Cambios implementados en `dashboard/views/pains_detail.py` según feedback del founder (Notion: Pains — Detalle — Feedback). Fecha de implementación: 2026-03-13.

---

## Resumen de cambios

| # | Tipo | Qué se hizo |
|---|------|-------------|
| 1 | 🔴 Cambiar | Agregar contexto debajo de cada KPI: ratio de pains por demo y % del total |
| 2 | 🔴 Aclarar | Nota informativa sobre diferencia de conteo vs. Executive Summary |
| 3 | 🔴 Eliminar | Gráfico "Pains por Theme" eliminado de esta página |
| 4 | 🔴 Cambiar | Eje X de "Pains por Módulo" cambiado a deals únicos (COUNT DISTINCT deal_id) |
| 5 | 🔴 Agregar | Columnas nuevas en tabla: segment, country, deal_stage, deal_owner, resumen |
| 6 | 🟡 Mejorar | Renombrar chart a "¿En qué módulos se concentran más problemas?" |
| 7 | 🟡 Agregar | Callout interpretativo arriba del heatmap "Theme x Status del Módulo" |
| 8 | 🟡 Agregar | Filtro rápido de Theme y Módulo directamente sobre la tabla |
| 9 | 🟡 Agregar | Campo de búsqueda de texto libre sobre la tabla (filtra por resumen) |

---

## Detalle de cada cambio

### Cambio 1 🔴 — KPIs con contexto de ratio y porcentaje

**Problema:** Los KPIs mostraban números absolutos sin referencia (29,951 / 6,364 / 23,587) que el usuario no podía interpretar solos.

**Implementación:**
- Se computa `distinct_deals = pains["deal_id"].nunique()` para obtener demos únicas.
- Se computa `ratio = total_pains / distinct_deals` para el promedio de pains por demo.
- Cada métrica tiene ahora un `st.caption()` abajo:
  - **Total Pains:** `"en {distinct_deals} demos · {ratio:.1f} por demo"`
  - **Generales:** `"{pct_general:.0f}% del total · sin módulo asociado"`
  - **Vinculados a Módulo:** `"{pct_linked:.0f}% del total · señal accionable"`
- Guard de división por cero: `if distinct_deals > 0 else 0`.

---

### Cambio 2 🔴 — Nota sobre diferencia de conteo vs. Executive Summary

**Problema:** El total de pains en esta página (ej. 29,951) y en Executive Summary (ej. 14,372) confundía a usuarios que navegaban entre secciones.

**Implementación:**
- Se agrega un `st.info()` debajo de los KPIs con el texto: *"El total de pains en esta página refleja todos los registros históricos sin filtro de fecha. El Executive Summary puede mostrar un número menor si aplica filtros de período por defecto."*

---

### Cambio 3 🔴 — Eliminación del gráfico "Pains por Theme"

**Problema:** El gráfico de barras verticales "Pains por Theme" (Procesos / Tecnología / Comunicación / etc.) ya aparece en Product Intelligence. En la página de Detalle no agrega valor porque el usuario ya viene a buscar granularidad.

**Implementación:**
- Se eliminó completamente el bloque `col_left` con `px.bar(..., title="Pains por Theme")`.
- El layout de 2 columnas ahora muestra: **Módulos (izq.) + Heatmap (der.)**.

---

### Cambio 4 🔴 — Unidad de medida en "Pains por Módulo": deals únicos

**Problema:** El gráfico contaba detecciones del modelo (filas), no empresas únicas. Un deal con 5 pains de Control Horario contaba 5 veces.

**Implementación:**
- Antes: `module_linked["module_display"].value_counts()`
- Ahora: `module_linked.groupby("module_display")["deal_id"].nunique().sort_values(ascending=False).head(15)`
- El eje X ahora se llama `"Deals únicos"` en lugar de `"Cantidad"`.
- Guard: solo se renderiza si `"deal_id" in pains.columns`.

---

### Cambio 5 🔴 — Nuevas columnas en la tabla de detalle

**Problema:** La tabla solo mostraba metadatos de categoría (subtype, theme, scope, module) sin contexto de negocio. Sin `summary`, la tabla era inútil como herramienta de exploración cualitativa.

**Implementación:**
- Columnas anteriores: `company_name, insight_subtype_display, pain_theme, pain_scope, module_display, summary, confidence`
- Columnas nuevas: `company_name, insight_subtype_display, pain_theme, pain_scope, module_display, segment, country, deal_stage, deal_owner, resumen`
- La columna `resumen` es `summary` truncada a 120 caracteres + `"..."` para legibilidad en tabla.
- Se usa `available_cols = [c for c in display_cols if c in table_pains.columns]` para que sea resiliente a columnas faltantes.

---

### Cambio 6 🟡 — Renombrar el gráfico de módulos

**Implementación:**
- Título cambiado de `"Pains por Modulo (top 15)"` a `"¿En qué módulos se concentran más problemas?"`
- Tooltip actualizado: *"Deals únicos donde se detectó al menos un pain vinculado a este módulo. Ayuda a priorizar foco por módulo de producto."*

---

### Cambio 7 🟡 — Callout interpretativo arriba del heatmap

**Problema:** El heatmap "Theme x Status del Módulo" no era auto-explicativo. El usuario necesitaba contexto para leerlo.

**Implementación:**
- Se agrega un `st.caption()` con el texto: *"💡 Lectura clave: El porcentaje de pains en módulos existentes revela si el problema es de roadmap o de propuesta de valor y UX dentro de los módulos actuales."*
- El callout se renderiza **antes** de la llamada a `px.density_heatmap`.

---

### Cambio 8 🟡 — Filtros rápidos de Theme y Módulo sobre la tabla

**Problema:** Los filtros globales del sidebar afectan toda la página. El usuario no podía filtrar la tabla sin afectar los gráficos superiores.

**Implementación:**
- Fila de 3 columnas encima de la tabla:
  - `selectbox("Filtrar por Theme", ...)` con key `pd_table_theme`
  - `selectbox("Filtrar por Módulo", ...)` con key `pd_table_module`
  - `text_input("Buscar en resumen", ...)` con key `pd_table_search`
- Los filtros se aplican a `table_pains = pains.copy()`, dejando `pains` intacto para los gráficos.

---

### Cambio 9 🟡 — Búsqueda de texto libre en la tabla

**Implementación:**
- `st.text_input` con placeholder `"palabras clave..."`.
- Filtra usando `table_pains["summary"].str.contains(search_text, case=False, na=False)`.
- Solo se aplica si `search_text` tiene contenido y si `"summary"` existe como columna.

---

## Archivos modificados

| Archivo | Tipo de cambio |
|---------|---------------|
| `dashboard/views/pains_detail.py` | Reescritura completa (85 → 137 líneas) |

## QA

Todos los cambios fueron verificados con un agente de QA que validó:
- 13/13 ítems del checklist: ✅ PASS
- Sin riesgo de KeyError (todas las columnas nuevas tienen guards)
- Los filtros de tabla no afectan los gráficos superiores
- Division-by-zero guard en el cálculo de ratio
