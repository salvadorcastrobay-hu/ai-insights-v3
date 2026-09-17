# Brief "AI Social Intelligence Engine" — dónde estamos y qué falta

Evaluación de lo construido contra el brief de Marketing, sección por sección.
Nada del brief fue modificado.

## Resumen

**Estamos aproximadamente al 35-40% del alcance pedido**, pero la distribución
importa más que el número: lo que el brief llama *"principio no negociable"* es
lo que está mejor resuelto, y casi todo lo que falta es **amplitud, no
profundidad**.

| Sección | Cobertura | Comentario |
|---|---|---|
| 2 · Redes (6) | **~35%** | LinkedIn e Instagram completas. Faltan X, YouTube, TikTok; Facebook solo en ads |
| 3.1 · Competidores | **~20%** | 8 de 53 del brief. Workvivo (prioridad) sin trackear |
| 3.2 · Referentes | **~70%** | Lo más avanzado. Búsqueda por keyword ya resuelta en LinkedIn |
| 3.3 · Expertos marketing | **0%** | Categoría inexistente hoy |
| 3.4 · Cuentas propias | **~10%** | Solo IG orgánico. Sin paid propio, sin GA, sin cruce HubSpot |
| 4 · Extracción por pieza | **~40%** | Temas y copy sí; visual/diseño no existe |
| 5 · Filtro de calidad | **~90%** | Implementado, testeado y es el núcleo del sistema |
| 6 · Competidores por región | **15%** | Sin USA, APAC, Perú, México, Colombia |
| 7 · Audiencia objetivo | **~50%** | Binario grueso vs. los 6 perfiles del brief |
| 8 · Cadencia | **~35%** | Acumulación sí; ingesta diaria y análisis semanal son manuales |
| 9 · Usuarios | **~60%** | App construida y andando, sin deploy ni accesos |
| 10 · Métricas de éxito | **0%** | Ninguna instrumentada |
| 11 · Chatbot | **~30%** | No existe, pero hay dos precedentes fuertes en el repo |

---

## Lo que ya coincide, y coincide fuerte

### Sección 5 — el filtro de calidad

Es el corazón del brief (*"principio no negociable"*) y es exactamente lo que
construimos. El brief pide medir desempeño **contra la propia base de la
cuenta**, no en absoluto. Nuestro `outlier_factor` es literalmente eso:

```
outlier_factor = engagement / mediana(engagement de los últimos posts de ese autor)
```

Los ejemplos que el brief usa para calibrar están en nuestra misma escala:
Deel 300x, HiBob 7-8x, y nosotros ya medimos Pellaes 27x, Carolina Martins 40x.

Más: el brief pide *"si no tenés suficiente data para evaluar el desempeño de
una pieza, decilo en vez de asumir que funcionó"*. Eso está implementado en
cuatro lugares distintos, y cada uno salió de un bug real:

- `MIN_BASELINE_SAMPLE` — sin 5 posts del autor no se afirma un outlier.
- `baseline_eligible` — los resultados de búsqueda no alimentan la mediana,
  porque vienen ordenados por relevancia y son el *techo* del autor.
- `MIN_AGE_HOURS` (48 en IG, 72 en LinkedIn) — un post de minutos no maduró.
- `insufficient_sample` — la síntesis avisa en vez de inventar patrones, y el
  calendario se acorta.

**Esta es la parte conceptualmente difícil del brief y está terminada.**

### Sección 3.2 — referentes, y la búsqueda por keyword

El brief es explícito: *"La búsqueda no puede ser solo por hashtag, porque
muchas piezas de alto rendimiento no los usan."*

Llegamos a esa misma conclusión midiendo: el hashtag scraper de Instagram
devuelve lo **más reciente**, no lo más popular, con `likesCount: 0`. Por eso
los hashtags pasaron a ser canal de descubrimiento de *cuentas*, y la búsqueda
real por keyword se resolvió en LinkedIn con orden por relevancia.

Hoy: 37 referentes curados y verificados uno por uno, 163 cuentas sugeridas
esperando curaduría, 16 queries por tema.

### Sección 7 — parcialmente

`audience_signal` ya separa `hr_leader` de `candidate`, que resuelve un problema
real: las cuentas más grandes del rubro le hablan a **candidatos**, no a quien
compra Humand. Eva Porto tiene 737k en Instagram y habla de CVs y entrevistas.

---

## Los huecos, por tamaño

### 1. Redes — el más grande en volumen de trabajo

| Red | Orgánico | Ads | Estado |
|---|---|---|---|
| LinkedIn | ✅ perfiles + keyword | ✅ | Completa |
| Instagram | ✅ perfiles + hashtag | ✅ | Completa |
| Facebook | ❌ | ✅ (Meta Ad Library) | Parcial |
| X | ❌ | ❌ | Sin empezar |
| YouTube | ❌ | ❌ | Sin empezar |
| TikTok | ❌ | ❌ | Sin empezar |

El modelo de datos ya es multi-plataforma (`platform` en todas las tablas), y el
scoring está parametrizado por red. Sumar una red es **un conector nuevo + un
perfil de scoring**, no una refactorización.

**Advertencia honesta:** el propio brief deja abierto *"definir método de
obtención de datos y viabilidad técnica/legal por red"*. X y TikTok son las
frágiles: X cerró su API pública y el scraping es inestable y disputado. Vale
resolver esa pregunta antes de comprometer fechas ahí.

### 2. Competidores — 8 de 53

| Ya trackeados | Faltantes destacados |
|---|---|
| Buk, Factorial, Rankmi, Crehana, PeopleForce, Sólides, Dialog, Beehome | **Workvivo**, Staffbase, BambooHR, HiBob, Personio, Workday, SAP SuccessFactors, Sesame HR, Visma, Pandapé, GoIntegro, Blink, Flip, Beekeeper… (45) |

**Workvivo es el hueco más caro:** el brief lo marca como *"main competitor"* en
EMEA, UK, Australia y NZ, y no lo tocamos. Factorial y Naaloo, las otras dos
prioridades, sí están.

Regiones enteras sin cobertura: **USA, APAC, Perú, México, Colombia.**

Nota: trackeamos 7 que el brief no lista (Caju, Flash, Gupy, Senior, Mandü…).
Vienen del pedido original de Growth Brasil. Habría que confirmar si siguen
siendo relevantes o si se sacan.

### 3. Cuentas propias — el hueco más estratégico

El brief dice: *"sin esto, la herramienta puede decirnos qué funciona en el
mercado pero no si nosotros lo estamos aplicando."* Es correcto, y hoy estamos
exactamente ahí.

| Pedido | Estado |
|---|---|
| Orgánico propio en 6 redes | Solo `@humand.es` en Instagram |
| Meta Ads / LinkedIn Ads / TikTok Ads propios | ❌ — solo vemos ads de competidores |
| Google Ads propio | ❌ |
| Cruce con Google Analytics | ❌ sin integración |
| Cruce con HubSpot | ⚠️ `hubspot_client.py` existe para deals, no para atribución de contenido |

Esto **no es más de lo mismo**: son APIs con OAuth y permisos de cuenta
publicitaria, no scraping. Es un frente de trabajo distinto.

### 4. Extracción visual — no existe

De las cinco categorías de la sección 4, la visual está en cero: tipografías,
paleta de colores, ángulos de filmación, estilo de edición. Hoy el pipeline de
competidores hace OCR multi-frame con ffmpeg, pero para **leer texto**, no para
describir diseño.

Es el otro trabajo genuinamente nuevo. Técnicamente es alcanzable —el modelo ya
recibe frames— pero es prompt y schema nuevos, más costo por pieza.

### 5. Perfil completo — existe, pero no donde hace falta

La síntesis por cuenta que pide el brief (calendario, ejes temáticos,
estrategia, bio) **ya está construida** para competidores de Instagram:
`posting_frequency`, `posting_patterns`, `content_pillars`, `hashtag_strategy`,
`summary`. No está para los referentes de discovery. Es reutilización, no
desarrollo nuevo.

### 6. Cadencia, métricas y chatbot

- **Diario/semanal:** hoy todo es manual. Hay precedente directo en el repo
  (`daily_ingest.yml`, `daily_pipeline.yml` con cron y concurrency), así que es
  camino conocido.
- **Métricas (sección 10):** ninguna instrumentada. Las cinco requieren
  tracking que hoy no existe — sobre todo *"% de piezas aprobadas sin cambios"*,
  que necesita saber qué pasó con cada sugerencia después de generarla.
- **Chatbot:** no existe para contenido. Pero el repo tiene `sql_chat_agent.py`
  (88 KB), `insights_copilot.py` y una vista `/sql-chat` andando. El patrón de
  "chat sobre datos propios, citando fuente" ya está resuelto en la casa.

---

## La restricción que el brief no contempla: costo

El brief pide **ingesta diaria** sobre 6 redes y ~119 cuentas
(53 competidores + referentes + expertos + propias).

Con los precios que ya medimos:

| | Hoy | Alcance del brief |
|---|---|---|
| Redes | 2 | 6 |
| Cuentas | ~40 | ~119 |
| Frecuencia | manual | diaria |
| Costo scraping | $3,66/mes | **~$97/mes** |

Son **~26x** el consumo actual, y la cuenta de Apify está en **plan FREE
($5/mes)**. Sumado el costo de LLM por clasificación (que crece con el volumen
y se multiplica si se agrega análisis visual), esto necesita una línea de
presupuesto explícita antes de arrancar.

No es bloqueante, pero es una decisión que alguien tiene que tomar y hoy no está
tomada.

---

## Plan para llegar

Ordenado por relación valor/esfuerzo, no por orden del brief.

### Fase A — Cerrar lo que ya casi está (1-2 semanas)

1. **Deployar `humand-content`.** Está construida y andando en local. Falta
   `CONTENT_ENGINE_TOKEN`, el rol `content` en Supabase y el deploy. Sin esto
   nadie usa nada de lo hecho.
2. **Ingesta diaria + análisis semanal por cron.** Copiar el patrón de
   `daily_pipeline.yml`. Cierra la sección 8 casi entera.
3. **Sumar Workvivo y el resto de prioridades.** Es configuración, no código:
   las fuentes ya viven en `content_sources`.
4. **Reusar la síntesis de perfil** que ya existe para competidores, aplicándola
   a los referentes. Cierra la quinta fila de la sección 4.

### Fase B — Amplitud de redes (3-5 semanas)

5. **Facebook orgánico** primero: el conector de Meta ya existe para ads.
6. **TikTok y YouTube**: conectores nuevos, pero con actores maduros en Apify.
   YouTube además trae transcripción nativa, que abarata el análisis de video.
7. **X al final**, y solo después de resolver la viabilidad que el propio brief
   deja abierta. Es la red de mayor riesgo técnico y legal.

Cada red es un conector + un perfil de scoring. El modelo de datos no cambia.

### Fase C — Cobertura de competidores (2-3 semanas, paralelizable con B)

8. **Los 45 faltantes**, por región y por prioridad de negocio. El cuello de
   botella es resolver handles por red — ya aprendimos que las listas no dan el
   identificador real y hay que verificar en lotes chicos.
9. **Confirmar qué se saca**: los 7 que trackeamos y el brief no lista.

### Fase D — Lo nuevo de verdad (4-6 semanas)

10. **Cuentas y ads propios + GA + HubSpot.** El frente más estratégico y el de
    mayor fricción: OAuth, permisos de cuenta publicitaria, y definir el modelo
    de atribución contenido → tráfico → lead → demo. Conviene arrancar por el
    orgánico propio (barato, mismo pipeline) y después el paid.
11. **Análisis visual.** Prompt y schema nuevos sobre los frames que ya
    extraemos.
12. **Chatbot.** Sobre el conocimiento acumulado, reusando el patrón de
    `sql_chat_agent.py`, con la regla del brief: citar evidencia o decir que no
    hay.

### Fase E — Medición (continuo, arrancar temprano)

13. **Instrumentar la sección 10.** La métrica clave —*% de piezas aprobadas sin
    cambios*— hay que diseñarla **antes** de que el equipo empiece a usar las
    sugerencias, porque requiere registrar el destino de cada una. Si se deja
    para el final, se pierde la línea base.

---

## Tres decisiones que hacen falta antes de comprometer fechas

1. **Presupuesto de scraping y LLM.** ~$97/mes solo de ingesta, sobre un plan
   FREE de $5. Sin esto, el alcance diario de 6 redes no es ejecutable.
2. **Viabilidad de X y TikTok.** El brief lo deja abierto y es la mayor fuente
   de incertidumbre del cronograma.
3. **Prioridad entre amplitud y profundidad.** Con el mismo esfuerzo se puede
   cubrir 6 redes superficialmente o 3 redes con análisis visual y cuentas
   propias. El brief pide todo sin fases; la realidad va a obligar a elegir un
   orden, y conviene que lo elija Marketing y no el cronograma.
