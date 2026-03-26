# Competitive Intelligence — Segunda Ronda de Mejoras

Fecha: 2026-03-25

Este documento registra los cambios implementados en la página **Competitive Intelligence** del dashboard como parte de la segunda ronda de revisión.

---

## Resumen de cambios

| # | Sección | Tipo | Descripción |
|---|---------|------|-------------|
| 1 | B. ¿Dónde y con quién? | Mejora visual | Heatmap de países: color por intensidad |
| 2 | C. ¿En qué momento? | Mejora visual | Gráfico de etapas: Won/Lost con colores diferenciados |
| 3 | D. Migration Opportunities | Corrección | Tabla ordenada por revenue de forma robusta |
| 4 | B. ¿Dónde y con quién? | Corrección | Etiquetas de industria sin truncar |

---

## Detalle

### 1 — Heatmap de países: color por intensidad

**Problema:** Las celdas con valor 0 tenían el mismo tono visual que las celdas con valores bajos. Era imposible distinguir de un vistazo qué combinaciones competidor/país no tenían presencia.

**Solución:** Se reemplazó la escala de color estándar por una escala de 4 puntos personalizada:
- `0` → gris neutro (`#eeeef1` / `neutral_100` del design system)
- Justo sobre 0 → azul muy claro (`#f1f4fd` / `brand_50`)
- 50% del máximo → azul de marca (`#6f93eb` / `brand_400`)
- 100% del máximo → azul oscuro (`#213478` / `blueprimary_800`)

Se agregó `zmin=0` para que el anclaje del gradiente siempre sea desde cero.

**Resultado:** Los ceros son grises. Los valores más altos son azul oscuro. La diferencia regional es visible de un vistazo.

**Archivos modificados:**
- `views/competitive_intelligence.py` (línea ~218)
- `ai-insights-v3/views/competitive_intelligence.py` (línea ~214)

---

### 2 — Gráfico de etapas: Won/Lost con colores diferenciados

**Problema:** El gráfico "¿En qué etapa del deal aparece cada competidor?" usaba la paleta por orden de aparición. Won y Lost no tenían colores consistentes ni diferenciados.

**Solución:** Se agregó un `color_discrete_map` explícito que asigna:
- **Won / Closed Won / Ganado** → verde (`#4bb69f`, color 4 de la paleta del design system)
- **Lost / Closed Lost / Perdido** → rojo-rosa (`#ea718b`, color 9 de la paleta)
- Demás etapas → paleta del design system como fallback

El mapa cubre variantes en inglés y español para compatibilidad con distintas configuraciones de HubSpot.

**Resultado:** Won y Lost son identificables al instante. El equipo comercial puede ver rápidamente en qué etapas pierde deals cuando aparece cada competidor.

**Archivos modificados:**
- `views/competitive_intelligence.py` (línea ~345)
- `ai-insights-v3/views/competitive_intelligence.py` (línea ~337)

---

### 3 — Migration Opportunities: sort por revenue robusto

**Problema:** El orden de la tabla podía verse afectado si la columna `amount` tenía valores de tipo mixto (strings vs números), haciendo que el sort lexicográfico produjera un orden incorrecto.

**Solución:** Se agregó conversión explícita a numérico antes del sort:
```python
migrating["amount"] = pd.to_numeric(migrating["amount"], errors="coerce")
migrating.sort_values("amount", ascending=False, na_position="last")
```
Deals con `amount` nulo quedan al final. El deal de mayor revenue siempre aparece primero.

**Resultado:** La tabla muestra consistentemente los deals de mayor impacto económico en las primeras filas.

**Archivos modificados:**
- `views/competitive_intelligence.py` (línea ~387)
- `ai-insights-v3/views/competitive_intelligence.py` (línea ~378)

---

### 4 — Etiquetas de industria: sin truncar

**Problema:** El gráfico de industrias estaba en una columna de la mitad del ancho de la página. Los nombres de industria largos (ej: "Software Companies & IT Services") quedaban cortados en la leyenda.

**Solución:** Se movió la leyenda por debajo del gráfico con orientación horizontal, se aumentó la altura del gráfico dinámicamente según la cantidad de competidores, y se redujo el tamaño de fuente de la leyenda a 10px:
```python
legend=dict(orientation="h", yanchor="top", y=-0.15, xanchor="left", x=0, font=dict(size=10))
height=max(400, n_competitors * 42 + 130)
margin=dict(b=120)
```

**Resultado:** Los nombres de industria se muestran completos. La leyenda es legible sin truncamiento.

**Archivos modificados:**
- `views/competitive_intelligence.py` (línea ~308)
- `ai-insights-v3/views/competitive_intelligence.py` (línea ~301)
