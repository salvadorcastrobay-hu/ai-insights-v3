# humand-content

App del equipo de Content. Separada de `humand-insights-web` a propósito: son
productos distintos con audiencias distintas — esa es de Sales/Revenue, esta es
de Content y Social Media.

## Cómo se reparte el trabajo con el motor

Esta app **no scrapea ni analiza nada**. El motor pesado (Apify, whisper,
ffmpeg, clasificación) vive en `humand-insights-web` porque necesita ffmpeg y
Docker, y correrlo dos veces sería duplicarlo.

```
humand-content                          humand-insights-web
  │                                        │
  ├── lee Supabase directo ───────────────►│ (mismas tablas content_*)
  │                                        │
  └── POST /api/internal/content/runs ────►│ dispara jobs (scraping, análisis)
                                           │
                                           └── Apify · OpenAI · ffmpeg
```

Los jobs están persistidos en Postgres, así que el polling del estado también
sale de Supabase: el HTTP al motor es solo para *disparar*.

## Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CONTENT_ENGINE_URL=https://ai-insights-v3-production.up.railway.app
CONTENT_ENGINE_TOKEN=            # el mismo valor que en el motor
```

## Desarrollo

```bash
npm install
npm run dev
```
