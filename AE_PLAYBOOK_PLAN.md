# AE Playbook — cómo habla Sales

> Pedido de Marketing (Dana, Slack): un glosario de términos frecuentes, un resumen de
> las formas de explicar qué hace Humand, y FAQs concretas con las respuestas de los AEs
> — filtrable por las demos más exitosas, para HISPAM. El consumidor final es un bot de
> WhatsApp que recibe y califica leads y busca que agenden demo.

---

## 1 · El gap

El pipeline actual es **lead-centric**: los 5 `insight_type` de `transcript_insights`
capturan lo que dice el **prospecto** (pains, gaps, competencia, fricciones, preguntas).
El pedido es lo inverso: el **discurso del AE**.

Lo único AE-side que ya existe:

| Qué | Dónde | Estado |
|---|---|---|
| `faq_answer` — respuesta del AE a una FAQ | `models.py:80`, `transcript_insights` | Nullable, "sólo si contestó explícito". Cobertura real → medir (Fase 0) |
| `speaker_role` (`ae\|lead\|unknown`) | `prompt_builder.py:78-95` | Existe, pero los 6 few-shot del prompt son todos `"lead"` → sesgo probable |
| Pitch, terminología, manejo de objeciones | — | No se extrae |

Por qué el chat del dashboard sólo devuelve "temas generales": `buildFaqDetailData`
agrupa por `insight_subtype_display` y por `summary`
(`humand-insights-web/lib/data/faq-detail-data.ts:49-55`). La pregunta textual
(`verbatim_quote`) y la respuesta (`faq_answer`) están en la fila cruda pero no se
agregan ni se canonicalizan.

**Trampa de schema:** `mv_insights_norm` **no** tiene `verbatim_quote`,
`insight_subtype` ni `company_size` — expone los `*_display` y un subconjunto de los
crudos. Para la pregunta textual hay que joinear a `transcript_insights` por `id`. La MV
sí aporta `region`/`country` normalizados, `is_validated`, y el recorte a la
`prompt_version` activa (v3.2, ver `migrations/2026_07_24_mv_v32_filter.py`), así que
conviene que mande en el `FROM`.

---

## 2 · Decisiones tomadas

| Decisión | Elección | Por qué |
|---|---|---|
| Definición de "demo exitosa" | **Won** (`deal_stage ILIKE '%won%'`). ~~`is_validated`~~ — corregido con datos, ver abajo | `is_validated` cubre el **78.9%** de HISPAM (6438/8161): no es señal de éxito, es higiene ("la reunión pasó y era real"). Con esa tasa base el `success_lift` máximo posible es 1/0.789 = **1.27**, o sea todo cae entre 0.9 y 1.2 y no distingue nada. Won es 12.7% (1040/8161): base baja, lift con rango real (máx 7.87), y es lo que Dana quiere decir con "las que cierran al cliente" |
| Filtrar por éxito en la ingesta | **No.** Extraer sobre todo HISPAM y aplicar el filtro de éxito en la agregación | Sin las demos que no cerraron no hay base contra la que comparar, y sin base no se puede decir "esta forma de explicar rinde más". Con Won al 12.7%, filtrar en la ingesta dejaría ~130 transcripts y ninguna referencia |
| Dónde vive la capa AE-side | Tablas nuevas (`ae_*`), no más `insight_type` | La MV, sus RPCs y ~14 vistas asumen la forma actual de `transcript_insights`. Meterlo ahí contamina todos los conteos y obliga a rebuildear la MV. Mismo patrón aislado que `competitor_ads` |
| Modelo de extracción | `gpt-4o` | Medido contra el gate: mini dio **84%** de fidelidad y 4o **91.9%**. No era una suposición — el gate determinístico permite comprobarlo por unos centavos, y conviene re-medir cuando cambien los modelos |
| Gate de calidad | Determinístico, sin juez LLM | Si la cita no aparece literal en el chunk, el modelo la inventó. Es un substring match: corre gratis sobre el 100% de las unidades, no sobre una muestra |
| Publicación al bot | Sólo filas con `human_status = 'approved'` | Le habla a leads reales. Un borrador de LLM no sale sin que una persona lo firme |

---

## 3 · Orden de ejecución

Cada fase es un gate: si no pasa, no se avanza.

### Fase 0 — Diagnóstico · `scripts/ae_diag.py`
Read-only, sin LLM, sin costo.

```bash
python scripts/ae_diag.py --region HISPAM --sample-speakers 20
```

Devuelve las 4 cosas que dimensionan todo lo demás:
1. **Universo** — transcripts / deals / cuántos validated / cuántos Won, y las etapas presentes.
2. **Cobertura de `faq_answer`** — define si la Fase 0.5 alcanza o si hay que esperar la extracción AE-side.
3. **Distribución de `speaker_role`** — confirma (o no) el sesgo a `lead`.
4. **Fiabilidad de los labels de speaker** — ⚠️ **riesgo #1**. Si el `deal_owner` aparece
   como hablante en ≥80% de los transcripts, el AE se aísla determinísticamente por
   nombre: más barato y sin error de atribución. Si no, el LLM tiene que inferirlo y la
   revisión humana pasa de recomendable a obligatoria. El script imprime el veredicto.

### Fase 0.5 — Quick win de FAQs · `scripts/ae_faq_pack.py`
Read-only sobre la DB, escribe sólo en `artifacts/`. Costo: unos centavos de embeddings.

```bash
python scripts/ae_faq_pack.py --region HISPAM --min-cluster 2
python scripts/ae_faq_pack.py --region HISPAM --only-success --synthesize
python scripts/ae_faq_pack.py --no-embeddings   # fallback sin costo
```

No necesita extracción nueva: los insights `faq` ya traen la pregunta textual y, cuando
el AE contestó, la respuesta. Lo que falta es canonicalizar. Agrupa con embeddings
(`text-embedding-3-large`, igual que `embed_transcripts.py`) **dentro de cada topic** de
la taxonomía, y saca el nombre de la empresa de cada cita antes de escribir el pack.

Sale un `.md` legible → **eso se le manda a Dana para validar el formato antes de gastar
en el run completo.** Es la mitad del pedido entregada en un día.

> El agrupado léxico (Jaccard) quedó como fallback y no debería usarse para el pack: no
> une `cuánto sale` con `qué precio tiene`, ni `se integra con` con `tienen integración
> con`. Los sinónimos son la norma en estas preguntas, no la excepción.

### Fase 1 — Schema · `migrations/2026_08_19_ae_speech_units.py`
Aditivo, idempotente, no toca `transcript_insights` ni la MV.

```bash
python migrations/2026_08_19_ae_speech_units.py --dry-run
python migrations/2026_08_19_ae_speech_units.py
```

- `ae_speech_units` — grano fino, append-only, versionada por `ae_prompt_version`. Persiste
  `is_literal` y `attribution` (resultado del chequeo determinístico) para poder filtrar
  el pack a unidades verificadas sin recomputar contra el transcript.
- `ae_term_usages` — tabla hija: hay que agregar por término, no por unidad.
- `ae_glossary_terms`, `ae_pitch_patterns`, `ae_faq_canonical` — derivadas, se recalculan.
  Las tres llevan `human_status`; el endpoint del bot sirve sólo `approved`.

`ae_pitch_patterns.success_lift` es el "filtrar por las más exitosas" del pedido: cuánto
más se usa esa forma de explicar en demos que cerraron que en el resto. La columna
`success_metric` guarda con qué definición se calculó — dos lifts sobre métricas distintas
no son comparables y sin esa columna no habría forma de saber cuál es cuál después.

> El rename de `validated_lift` → `success_lift` está en
> `migrations/2026_08_20_ae_success_lift_rename.py`, aparte porque la migración anterior ya
> está aplicada en producción: editarla sería un no-op y el archivo dejaría de describir el
> schema real.

### Fase 2 — Prompt y prueba de extracción · `ae_prompt_builder.py` + `scripts/ae_extract_test.py`
No escribe en la DB. Costo: unas decenas de centavos.

```bash
python scripts/ae_extract_test.py --sample 5 --max-chunks 3
python scripts/ae_extract_test.py --sample 10 --model gpt-4o-mini   # medir el barato
```

El prompt `ae_v1` está sesgado a **no extraer** antes que a extraer algo dudoso — al
revés que el lead-side, donde el riesgo es perderse insights. Seis `unit_type`:
`pitch_company`, `pitch_module`, `faq_answer`, `objection_handling`,
`discovery_question`, `proof_point`.

El script mide, por unidad y sin juez LLM (`src/skills/ae_fidelity.py`):

| Métrica | Gate |
|---|---|
| **Fidelidad** — la cita aparece literal en el chunk | ≥ 90% |
| **Atribución** — `speaker_name` matchea `deal_owner` | ≤ 5% mismatch |
| Cobertura — unidades por chunk y reparto por `unit_type` | inspección |

Salida doble: `artifacts/ae_test_<ts>.json` (crudo, para diffear entre versiones del
prompt) y `artifacts/ae_test_<ts>.md` (legible, para que lo revise alguien de Sales).

**Si no pasa el gate, se itera el prompt. No se corre el batch.**

### Fase 3 — Run · `ae_parser.py` + `scripts/ae_extract_run.py`
**No correr sin haber pasado el gate de la Fase 2.**

```bash
python scripts/ae_extract_run.py --region HISPAM --dry-run   # cuenta chunks y estima costo
python scripts/ae_extract_run.py --region HISPAM --limit 20  # arrancar chico
python scripts/ae_extract_run.py --region HISPAM             # recorte completo
```

`ae_parser.py` corre el chequeo de fidelidad **antes** de insertar y descarta las citas
no literales (`--keep-non-literal` para guardarlas igual). Persiste `is_literal` y
`attribution` para poder filtrar el pack sin releer el transcript.

Idempotente y reanudable: `content_hash` sobre transcript + chunk + `unit_type` + módulo +
verbatim normalizado + `ae_prompt_version`, con `ON CONFLICT DO NOTHING`. Usa el verbatim
normalizado y no la `paraphrase` a propósito — la paraphrase varía entre corridas aunque
la cita sea idéntica, y eso rompería la idempotencia. Por default saltea transcripts que
ya tienen unidades de esta versión del prompt.

Una transacción por chunk: si algo falla, se pierde ese chunk, no el run. Al final reporta
la tasa de descarte por cita no literal y avisa si pasa el 15% — señal de que el prompt
está parafraseando y hay que parar.

### Fase 4 — Canonicalización · `src/skills/ae_aggregation.py`
Funciones puras, resultado cacheado en las tablas derivadas.

- **Glosario** (`build_glossary`): agrupa por `term_norm`, la grafía más usada queda como
  canónica y el resto como alias. La definición es la glosa más repetida, **no** una
  sintetizada: es cómo lo explican, no cómo debería explicarse.
- **Pitch patterns** (`build_pitch_patterns`): sobre clusters de unidades `pitch_*`, con
  ejemplos filtrados a citas verificadas como literales. El `label` que sale es un
  placeholder — la redacción final la escribe un LLM por cluster y la firma una persona.
- **FAQs**: reusar el clustering de la Fase 0.5, ahora con las respuestas de la extracción AE-side.

**`success_lift`** es la métrica que responde al pedido de filtrar por demos exitosas:
la tasa de éxito del patrón dividida por la tasa base del recorte. `1.0` = no aporta
información, `1.4` = aparece 40% más seguido en las que cerraron. Se divide por la base
porque el `%` crudo sube y baja con la tasa de éxito del recorte — si el 70% de las
demos cuentan como exitosas, cualquier patrón da ~70% y parece bueno.

Qué cuenta como exitosa se elige con `metric` (`won` por default, `validated` disponible
como filtro de higiene). La elección no es cosmética: con `validated` al 78.9% de base, la
métrica no discrimina nada — por eso el default cambió a Won.

Dos advertencias que están en el código y conviene repetir: el `baseline` tiene que venir de
`dataset_baseline()` sobre **todas** las unidades del recorte, no sólo las que traen
términos (si no, el lift queda sesgado a 1.0 — verificado: 1.0 vs 2.22 en el mismo dato). Y
el lift **no es causal**: mide co-ocurrencia. Un patrón con lift alto puede ser consecuencia
de que la demo venía bien, no su causa. Sirve para priorizar qué revisar.

El clustering de `faq_clustering.cluster_by_vectors` es componentes conexas del grafo de
similitud sobre el umbral — matemáticamente el mismo single-linkage, pero en operaciones de
matriz. El doble loop original asumía "n son cientos" y n resultó ~39k: horas contra
segundos (medido: 20k items en 7.5s, con salida idéntica al camino en Python puro).

### Fase 5 — Dos consumidores (pendiente)
No confundirlos: son entregables distintos.

- **Humanos** — vista "Sales Playbook" en `humand-insights-web` (patrón `GlossaryPage.tsx`
  + `lib/data/*-data.ts` + ruta en `app/(dashboard)/`), 3 tabs, con los filtros globales
  existentes + toggle "sólo demos exitosas".
- **El bot** — `/api/knowledge-pack?market=hispam&only_successful=true`: markdown compacto
  versionado, presupuestado a ~3-5k tokens para que entre en el system prompt. Sirve sólo
  `approved`. Si crece, las FAQs pasan a vector store y el bot hace retrieval. **Esto es
  lo que Dana necesita — no un dashboard.**

### Fase 6 — Calidad y refresh (pendiente)
- Revisión: Dana o un AE senior marca `approved`/`edited`/`rejected`.
- Refresh mensual sobre el workflow de `refresh_mv`: sólo transcripts nuevos, entradas
  nuevas entran como `pending`.
- Redacción de PII: el pack de FAQs ya saca el `company_name` de cada cita; la vista web
  debe reusar `redact-quotes.ts`.

---

## 4 · Riesgos

| Riesgo | Mitigación |
|---|---|
| El AE no se puede aislar por nombre (labels pobres o `deal_owner` que no matchea) | Fase 0 lo mide antes de escribir una línea de extracción. Si da rojo: `confidence` tope 0.6 y revisión humana obligatoria |
| El modelo parafrasea en vez de citar | Gate determinístico de fidelidad al 90%, sobre el 100% de las unidades |
| Se atribuye al AE algo que dijo el lead | Chequeo de atribución contra `deal_owner`, gate al 5% |
| Los AEs se contradicen entre sí (precios, plazos) | `ae_faq_canonical.has_conflict`; la síntesis tiene instrucción explícita de marcar `REVISAR:` en vez de elegir |
| Se filtra el nombre de un cliente al bot | Redacción por reemplazo directo, no confiada al LLM |
| Elegir una métrica de éxito que no discrimina | Pasó: `is_validated` al 78.9% acota el lift a 1.27. La Fase 0 imprime la tasa base justamente para detectarlo antes de sacar conclusiones |
| Lift alto sobre pocas demos leído como señal | `min_demos` y orden por cobertura antes que por lift: 3.0 sobre 2 demos es ruido, 1.3 sobre 40 es señal |

---

## 5 · Abierto

1. **HISPAM** = por `country` del deal, por `region`, o por idioma del transcript. Hoy los
   scripts usan `region` vía `build_region_filter_clause` (`src/skills/market_filters.py`),
   que ya mapea los valores sucios de HubSpot (`LATAM`, `Mendoza Province`, `Ciudad de México`).
2. **Quién aprueba** el pack antes de que el bot lo consuma, y con qué cadencia.
3. Si el bot consume un **prompt estático versionado** o hace **retrieval en vivo**.
