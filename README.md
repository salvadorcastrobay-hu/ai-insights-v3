# Humand Sales Insights v3

Plataforma de extracción y consumo de insights normalizados a partir de
transcripts de llamadas de ventas. Ingesta automática desde Fathom +
HubSpot, extracción estructurada con OpenAI, persistencia en Supabase y
dashboard en Next.js para Marketing, Producto y Ventas.

---

## Arquitectura

```
┌──────────────┐   ┌──────────────────┐   ┌────────────┐   ┌──────────────┐
│  Fathom API  │──▶│                  │   │            │   │  Next.js     │
│  HubSpot API │   │  Python pipeline │──▶│  Supabase  │──▶│  dashboard   │
└──────────────┘   │  (ingest → chunk │   │ (Postgres) │   │  + FastAPI   │
                   │   → extract →    │   │            │   │  (charts/IA) │
                   │   parse → load)  │   │            │   │              │
                   └──────────────────┘   └────────────┘   └──────────────┘
        ▲                                       │
        │                                       │
   GitHub Actions                          Insights Copilot
   (daily cron 06:00 UTC)                  + MCP server
```

---

## Stack

| Capa             | Tech                                   | Ubicación                       |
|------------------|----------------------------------------|---------------------------------|
| Ingesta          | Python · Fathom API · HubSpot API      | `ingest.py`, `fathom_client.py`, `hubspot_client.py` |
| Pipeline         | Python · OpenAI Batch API · tiktoken   | `pipeline.py`, `batch_processor.py`, `chunker.py`, `parser.py` |
| Taxonomía        | Python · Supabase seed                 | `taxonomy.py`, `seed_taxonomy.py` |
| DB               | Supabase (Postgres + pgvector)         | `schema.sql`, `migrate_schema.py` |
| API              | FastAPI · OpenAI                       | `src/api/main.py` (deploy Railway) |
| Dashboard        | Next.js 15 · React · Tailwind · shadcn | `humand-insights-web/` (deploy Vercel) |
| Automatización   | GitHub Actions                         | `.github/workflows/daily_ingest.yml` |
| Copilot / MCP    | Python · OpenAI · MCP                  | `insights_copilot.py`, `insights_mcp_server.py` |
| Dashboard legacy | Streamlit                              | `dashboard.py` (mantenido solo como referencia) |

---

## Qué extrae

Cada transcript se procesa contra una taxonomía HR completa y produce 5
tipos de insights normalizados:

| Tipo                 | Detalle                                                      |
|----------------------|--------------------------------------------------------------|
| Pain                 | 87 subtypes mapeados a módulos HR                            |
| Product Gap          | Features faltantes (taxonomía sincronizada con el roadmap)   |
| Competitive Signal   | 78 competidores · 6 tipos de relación                        |
| Deal Friction        | 12 subtypes de bloqueadores                                  |
| FAQ                  | 15 topics de preguntas frecuentes                            |

Todo queda vinculado a módulos HR + categorías, con `prompt_version` para
versionar la extracción y dimensiones de deal (industry, region, segment,
deal_stage, amount) para análisis cruzado.

---

## Estructura del repo

```
ai-insights-v3-main/
├── main.py                  · CLI entry point
├── pipeline.py              · Orquestador (fetch → chunk → batch → parse → load)
├── ingest.py                · Fathom + HubSpot + deal matching
├── chunker.py               · Chunking token-aware
├── batch_processor.py       · OpenAI Batch API (submit, poll, download)
├── parser.py                · Validación Pydantic + normalización
├── db.py                    · Cliente Supabase
├── embed_transcripts.py     · Embeddings para RAG
├── taxonomy.py              · Fuente de verdad de módulos/pains/features
├── models.py                · Schemas Pydantic compartidos
├── config.py                · Variables de entorno
├── schema.sql               · DDL Supabase
├── insights_copilot.py      · Copilot conversacional
├── insights_mcp_server.py   · MCP server para clientes externos
├── dashboard.py             · Dashboard Streamlit (legacy)
│
├── src/
│   ├── api/main.py          · FastAPI (sql-chat, campaign-advisor, health)
│   ├── agents/              · Componentes con estado
│   ├── skills/              · Funciones puras reutilizables
│   ├── connectors/          · Wrappers de APIs externas
│   ├── models/              · Schemas compartidos
│   └── prompts/             · Templates LLM en markdown
│
├── humand-insights-web/     · Next.js dashboard
│   ├── app/                 · App Router pages
│   ├── components/          · UI components
│   ├── lib/                 · Supabase client, queries, charts
│   └── scripts/             · Migraciones y herramientas TS
│
├── sql/                     · Migraciones SQL versionadas
├── scripts/                 · Reruns manuales y utilidades
├── views/                   · SQL views del dashboard
└── .github/workflows/       · Cron + reruns automatizados
```

---

## Setup

### Python pipeline

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Completar: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY,
#            FATHOM_API_KEY, FATHOM_TEAM_FILTER, HUBSPOT_API_KEY

# Crear schema + seed taxonomía
python main.py setup
```

### Next.js dashboard

```bash
cd humand-insights-web
npm install
cp .env.example .env.local   # SUPABASE_URL, SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
npm run dev                  # http://localhost:3000
```

### FastAPI (charts + chat con IA)

```bash
uvicorn src.api.main:app --reload --port 8000
```

---

## CLI

```bash
# Ingesta Fathom + HubSpot (incremental, desde la última corrida)
python main.py ingest --since 2026-05-15

# Extracción full (Batch API, todos los transcripts nuevos)
python main.py run

# Sample con API directa (rápido, sin batch)
python main.py run --sample 5 --model gpt-4o

# Solo generar JSONL sin enviar
python main.py run --dry-run

# Resumir batch interrumpido
python main.py run --resume

# Estado del batch en curso
python main.py status

# QA evaluation
python main.py qa --sample 30 --report

# Embeddings para RAG
python main.py embed --since 2026-05-01

# Backfill de Fathom summaries
python main.py backfill-summaries
```

---

## Pipeline

```
0. INGEST   → Fathom meetings + HubSpot deals → raw_deals + transcripts
1. FETCH    → Leer transcripts no procesados (filtrados por prompt_version)
2. CHUNK    → tiktoken, split si >12K tokens
3. BUILD    → Generar JSONL para OpenAI Batch API
4. SUBMIT   → Enviar batch
5. POLL     → Esperar completion
6. PARSE    → Validar con Pydantic, normalizar contra taxonomía
7. LOAD     → Upsert a Supabase con dedup por (transcript_id, prompt_version)
```

Estado serializado en `state.json` para resume seguro.

---

## Automatización

GitHub Actions corre `daily_ingest.yml` todos los días a las **06:00 UTC**
(03:00 ART). Trae transcripts nuevos de Fathom y refresca el estado de
todos los deals en `raw_deals`.

**Secrets requeridos** en `Settings → Secrets and variables → Actions`:

```
SUPABASE_URL · SUPABASE_KEY · SUPABASE_DB_PASSWORD
FATHOM_API_KEY · FATHOM_TEAM_FILTER · HUBSPOT_API_KEY
```

Trigger manual: `workflow_dispatch` con inputs opcionales `source` y `since`.
La extracción con LLM queda manual (`python main.py run`) — el cron solo
hace sync de datos.

---

## Dashboard

- **Prod**: `https://humand-insights-web.vercel.app`
- **Stack**: Next.js 15 (App Router) + Tailwind + shadcn/ui + Supabase
- **Auth**: Supabase Auth (login con email Humand)
- **Páginas clave**: Executive Summary, Pains, Product Gaps, Competitive
  Intelligence, FAQs, Deal Friction, Chat con IA, Campaign Advisor

API consumida desde el frontend: FastAPI en Railway (`src/api/main.py`).

---

## Convenciones

- Todo texto visible al usuario en **español**
- Prompts: español para extracción, inglés para código
- Modelo extracción: ver `OPENAI_MODEL` en `config.py`
- Modelo QA: siempre `gpt-4o`
- Taxonomía: fuente de verdad en `taxonomy.py`, sincronizada con `tax_modules`/`tax_feature_names` en Supabase
- Versionado: campo `prompt_version` en `transcript_insights`

Más detalle en `.claude/CLAUDE.md` y `AGENTS.md`.

---

## Costos

| Concepto                                | Costo aproximado |
|-----------------------------------------|------------------|
| OpenAI Batch API (~500 transcripts)     | $1-2 USD         |
| Supabase (Pro plan)                     | $25 / mes        |
| Vercel (Hobby/Pro)                      | $0-20 / mes      |
| Railway (FastAPI)                       | $5-10 / mes      |
| GitHub Actions (uso actual)             | $0               |
