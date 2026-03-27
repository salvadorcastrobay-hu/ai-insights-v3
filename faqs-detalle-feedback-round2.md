# FAQs Detalle — Feedback Round 2

## Resumen de cambios
Se revisaron 5 observaciones del feedback sobre la vista de FAQs Detalle. En esta ronda se confirmaron 2 puntos ya resueltos y se implementaron 3 ajustes pendientes.

## Estado pre/post por punto

| # | Feedback | Estado previo | Estado posterior |
|---|---|---|---|
| 1 | Tabla con columnas `segment`, `country`, `deal_stage`, `deal_owner` | Implementado | Verificado como correcto |
| 2 | Default del selector “Top 5” = topic más frecuente | Pendiente (selector iniciaba en placeholder) | Implementado (inicia en topic más frecuente) |
| 3 | Nota explicativa visible para KPI “Preguntas por Demo” | Pendiente (solo tooltip) | Implementado con `st.info()` bajo KPIs |
| 4 | Orden del gráfico: más frecuente arriba | Implementado | Verificado como correcto |
| 5 | Etiqueta eje X: “Deals únicos con al menos 1 pregunta de ese topic” | Pendiente (sin título explícito en eje) | Implementado con `xaxis_title` |

## Cambios de código realizados

### Archivo modificado
- `views/faq_detail.py`

### Ajustes aplicados
1. KPI “Preguntas por Demo”
- Se agregó un bloque `st.info()` inmediatamente debajo de los 3 KPIs.
- El mensaje explica la lectura del indicador y su comportamiento esperado en el tiempo.

2. Gráfico “FAQs por Topic”
- Se mantuvo la lógica de orden descendente y eje Y invertido (más frecuente arriba).
- Se agregó `fig.update_layout(xaxis_title="Deals únicos con al menos 1 pregunta de ese topic")` para explicitar el significado del eje X.

3. Bloque “Top 5 preguntas por Topic”
- Se eliminó el placeholder `"(Seleccionar Topic)"` del `selectbox`.
- Se definió el default con el topic más frecuente (`topic_counts.iloc[0]["Topic"]`).
- Se calcula `default_idx` y se inicializa el selector con `index=default_idx`.
- Con esto, al entrar en la vista se renderiza automáticamente el Top 5 del topic por defecto.

## Resultado esperado en UI
- Al abrir FAQs Detalle, el selector ya aparece con un topic válido seleccionado.
- Debajo del selector se muestra directamente el gráfico de Top 5 preguntas del topic por defecto.
- Debajo de KPIs se visualiza una nota azul explicativa del KPI “Preguntas por Demo”.
- El eje X del gráfico principal muestra la etiqueta completa requerida.
- La tabla mantiene las columnas de contexto comercial solicitadas.
