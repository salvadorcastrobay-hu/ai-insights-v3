# Content Discovery — cómo operarlo

Herramienta de research de contenido para el equipo de Content: descubre qué
publican los referentes del rubro, mide qué funcionó, y propone calendario.

Este documento es para operarlo. El análisis contra el brief de Marketing está
en `artifacts/brief_gap_analysis.md`.

## Cómo está partido, y por qué

```
humand-content                          humand-insights-web
(app del equipo de Content)             (el motor)
  │                                        │
  ├── lee Supabase directo ───────────────►│ tablas content_*
  │                                        │
  └── POST /api/internal/content/runs ────►│ Apify · OpenAI · whisper · ffmpeg
                                           │
.github/workflows/content_{daily,weekly} ─►┘
```

**El motor no se mueve de `humand-insights-web`** porque necesita ffmpeg para
extraer frames de video, y eso pide Docker. En Vercel serverless no corre.
Duplicarlo en la app nueva serían dos copias de whisper + Apify divergiendo.

**Los jobs viven en Postgres** (`content_refresh_jobs`), no en memoria. Por eso
la app puede seguir el estado de una corrida aunque el motor se redeploye a
mitad, y por eso un job sin heartbeat por más de 5 minutos se marca `failed`
solo.

## Variables de entorno

En el motor (`humand-insights-web`, hoy Railway):

```
APIFY_API_KEY=                    # Instagram y LinkedIn
SCRAPECREATORS_API_KEY=           # ad libraries (ya existía)
OPENAI_API_KEY=
COMPETITOR_ADS_MODEL=             # default: gpt-4o-mini
CONTENT_ANALYSIS_MODEL=           # default: cae a COMPETITOR_ADS_MODEL
CONTENT_CALENDAR_MODEL=           # default: gpt-4o
CONTENT_ENGINE_TOKEN=             # openssl rand -hex 32
```

En la app (`humand-content`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CONTENT_ENGINE_URL=               # URL del motor
CONTENT_ENGINE_TOKEN=             # EL MISMO valor que en el motor
```

En GitHub Actions, como secrets: `CONTENT_ENGINE_URL` y `CONTENT_ENGINE_TOKEN`.

## Puesta en marcha

1. **Migraciones** (idempotentes, todas con `--dry-run`):

   ```bash
   for m in migrations/2026_09_09_content_discovery.py \
            migrations/2026_09_09b_seed_content_sources.py \
            migrations/2026_09_09c_fix_hashtag_regions.py \
            migrations/2026_09_14_seed_referentes_curados.py \
            migrations/2026_09_14b_seed_linkedin_referentes.py \
            migrations/2026_09_14c_linkedin_columns.py \
            migrations/2026_09_14d_seed_linkedin_queries.py \
            migrations/2026_09_16_content_feedback.py; do
     python3 "$m"
   done
   ```

2. **Rol `content`** en el `app_metadata.roles` de cada usuario en Supabase.
   Los dos apps leen los roles del mismo lugar.

3. **Deploy de `humand-content`.** No necesita ffmpeg, así que va a Vercel o
   Railway indistintamente.

4. **Primera corrida**, a mano antes de confiar en el cron:

   ```bash
   curl -X POST -H "Authorization: Bearer $CONTENT_ENGINE_TOKEN" \
     -H "content-type: application/json" \
     -d '{"kind":"discovery"}' "$CONTENT_ENGINE_URL/api/internal/content/runs"
   ```

## El ciclo

| Cuándo | Qué | Quién lo dispara |
|---|---|---|
| Diario 07:00 UTC | Trae posts nuevos de las fuentes activas | `content_daily.yml` |
| Lunes 09:00 UTC | Clasifica, sintetiza patrones, regenera calendario, toma foto de cobertura | `content_weekly.yml` |
| Cuando haga falta | Aprobar fuentes sugeridas, decidir sobre las piezas | El equipo, desde la app |

El semanal clasifica y **después** sintetiza. Al revés, la síntesis no vería los
posts de la semana.

## Cómo se decide qué "funciona"

No por engagement absoluto ni por engagement rate crudo: el primero siempre
favorece a las cuentas grandes, el segundo a las chicas. Lo que se mide es
cuánto sobre-performó un post **contra la línea base de su propia cuenta**.

```
outlier_factor = engagement / mediana(engagement de los últimos posts de ese autor)
```

Cuatro reglas impiden afirmar de más, y cada una salió de un bug real:

- Sin 5 posts del autor no se calcula outlier.
- Los posts traídos por **búsqueda** no alimentan la mediana: la búsqueda ordena
  por relevancia, o sea devuelve el techo del autor.
- Un post con menos de 48h (72 en LinkedIn) no compite: no maduró.
- Con menos de 8 posts en el corte superior, la síntesis dice que no alcanza en
  vez de inventar patrones.

## Costo

Plan Apify **FREE**: USD 5/mes. Con 2 redes y ~75 fuentes el consumo va por
USD ~4/mes, o sea que está al límite.

Lo caro es Instagram (~USD 0,0054 por cuenta); LinkedIn es marginal
(~USD 0,00005 por corrida). Antes de sumar fuentes, mirar el gasto en el
dashboard de Apify.

El cupo por fuente vive en `content_sources.results_limit` y es la contención:
subirlo multiplica el costo diario para siempre.

## Cosas que van a romper, y qué son

| Síntoma | Causa |
|---|---|
| El motor devuelve HTML en vez de JSON | `/api/internal` se cayó de `PUBLIC_PATHS` en el middleware |
| Una corrida devuelve 0 posts, sin error | `authorKeywords` mal formado: necesita términos de 2+ palabras unidos con `OR`, no comas |
| `fetch failed` al leer muchos posts | Un `.in()` con cientos de ids pasa el límite de 16KB de headers de PostgREST |
| Job en `running` para siempre | El proceso murió; se marca `failed` solo a los 5 min sin heartbeat |
| Un ranking lleno de cuentas diminutas | El piso de alcance quedó mal calibrado |
| Handles que "no resuelven" en lote | Un run de validación con muchos perfiles **trunca**. Validar de a pocos |

## Lo que todavía no hace

Está detallado en `artifacts/brief_gap_analysis.md`, pero en corto: solo cubre
LinkedIn e Instagram (el brief pide seis redes), 8 de 53 competidores, no analiza
lo visual, no toca ads propios ni Google Analytics ni HubSpot, y no hay chatbot.
