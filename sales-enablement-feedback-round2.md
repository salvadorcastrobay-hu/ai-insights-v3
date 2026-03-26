# Sales Enablement — Feedback Round 2

Fecha: 2026-03-26

Este documento registra los ajustes implementados en la página **Sales Enablement** del dashboard.

Archivo modificado: `views/sales_enablement.py`

---

## Resumen de cambios

| # | Sección | Tipo | Descripción |
|---|---|---|---|
| 1 | A. ¿Qué está frenando los deals? | Fix de métrica | Friction Breakdown: % calculado por deals únicos, no por strings únicos |
| 2 | A. ¿Qué está frenando los deals? | Fix visual | Heatmap por industria: labels en X legibles, sin corte de margen |
| 3 | B. ¿Qué AEs necesitan más soporte? | Fix de orden | Stacked bar por AE: orden descendente real por total de fricciones |
| 4 | B. ¿Qué AEs necesitan más soporte? | Mejora UX | Tabla de AEs: columnas de texto ampliadas para evitar truncado |
| 5 | C. ¿Qué preguntan los prospects? | Fix de layout | FAQ chart + FAQ breakdown mostrados en paralelo |

---

## Detalle

### 1) Friction Breakdown — porcentaje correcto por deals

**Problema:** El cálculo usaba `value_counts()` sobre `summary`, por lo que casi todos los valores quedaban con frecuencia 1 y porcentajes artificialmente similares.

**Implementación:** Se cambió a conteo de `deal_id` únicos por `summary`:
- `groupby("summary")["deal_id"].nunique()`
- Denominador: `n_deals` del subtipo de fricción

**Resultado:** Los porcentajes reflejan cobertura real por deals y no distribución de textos.

### 2) Heatmap por industria — labels legibles y margen persistente

**Problema:** `apply_ds_layout()` sobrescribía márgenes (incluido `b`), por lo que los labels inclinados se cortaban.

**Implementación:**
- Inclinación de eje X ajustada a `-60`
- Margen inferior aumentado a `b=200`
- Reaplicación explícita de margen y `tickangle` después de `apply_ds_layout()`

**Resultado:** Las etiquetas de industria largas se muestran completas.

### 3) Fricciones por AE — orden estable por total descendente

**Problema:** `category_orders` en `px.bar` no siempre respetaba el orden cuando también había `color`, y se veía orden alfabético.

**Implementación:**
- Orden base calculado desde `value_counts().head(10)`
- `deal_owner` convertido a `pd.Categorical(..., ordered=True)`
- `fric_by_ae` ordenado por `deal_owner`
- Se removió `category_orders` de `px.bar`
- Se fijó el eje Y con `categoryorder="array"` + `categoryarray=ae_order` para garantizar orden estable completo

**Resultado:** El gráfico conserva el orden esperado (AE con más fricciones arriba tras `autorange="reversed"`).

### 4) Tabla de AEs — columnas de texto sin truncar

**Problema:** Los textos de `Top Fricción` y `Top Competidor` quedaban recortados.

**Implementación:** Se agregó `column_config` en `st.dataframe`:
- `Top Fricción`: `TextColumn(..., width="medium")`
- `Top Competidor`: `TextColumn(..., width="medium")`

**Resultado:** Mejor legibilidad de insights clave por AE.

### 5) FAQ chart + FAQ Breakdown en layout side-by-side

**Problema:** El breakdown estaba debajo del gráfico; se requería vista comparativa en paralelo.

**Implementación:**
- Se creó `faq_col_left, faq_col_right = st.columns([3, 2])`
- `st.plotly_chart(fig, ...)` movido a columna izquierda
- Panel completo de breakdown (Top 2 topics y bullets) movido a columna derecha

**Resultado:** Lectura simultánea de ranking y desglose de preguntas.

---

## Verificación ejecutada

Se ejecutó la app con:

```bash
.venv/bin/python -m streamlit run dashboard.py --server.headless true --server.port 9876
```

Validaciones realizadas:

1. **FAQ side-by-side:** confirmado que el gráfico de topics y el panel `FAQ Breakdown — Top 2 topics` se renderizan en paralelo.
2. **Orden AE en stacked bar:** confirmado que el eje usa `categoryorder="array"` con orden descendente por total de fricciones.
3. **Friction Breakdown %:** confirmado que los porcentajes ya no son uniformes y se calculan contra deals únicos del subtipo.
4. **Heatmap industria:** confirmado `tickangle=-60` y margen inferior `b=200` aplicado después de `apply_ds_layout`.
5. **Tabla AE columnas largas:** se validó configuración de `TextColumn(width="medium")` para `Top Fricción` y `Top Competidor`, con mejora visual en render.

Capturas generadas durante la verificación:
- `tmp/sales-enablement-round2-section-b.png`
- `tmp/sales-enablement-round2-section-c-layout.png`
