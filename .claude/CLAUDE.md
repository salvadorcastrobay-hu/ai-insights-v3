# AI Insights v3

## Arquitectura
- **Agents** (`src/agents/`): Componentes con estado y scope definido
- **Skills** (`src/skills/`): Funciones puras, reutilizables, sin I/O externo
- **Connectors** (`src/connectors/`): Wrappers de APIs externas
- **Models** (`src/models/`): Pydantic schemas compartidos
- **Prompts** (`src/prompts/`): Templates de LLM en markdown
- **Dashboard** (`dashboard/`): Streamlit app, consumidor del pipeline

## Convenciones
- Todo texto visible al usuario en español
- Prompts en español para extracción, en inglés para código
- Modelo default para extracción: ver config.py OPENAI_MODEL
- Modelo para QA: siempre gpt-4o
- Taxonomía: fuente de verdad es src/skills/taxonomy.py
- Versionado de insights: campo prompt_version en transcript_insights

## Comandos frecuentes
- `python3 -m src.cli run --sample 5 --model gpt-4o` — Test rápido
- `python3 -m src.cli qa --sample 30` — QA evaluation
- `streamlit run dashboard/app.py` — Dashboard local
- DB: Supabase PostgreSQL (ver config.py para conexión)

## No hacer
- No commitear .env ni config.yaml con passwords
- No usar gpt-4o-mini para QA evaluation
- No eliminar insights sin versionar primero (usar prompt_version)
- No agregar frameworks de agentes (CrewAI, LangGraph, etc.)
