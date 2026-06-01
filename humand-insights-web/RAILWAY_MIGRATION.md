# Migración Vercel → Railway (Next.js dashboard)

Pasos para mover `humand-insights-web` de Vercel a Railway sin downtime.

## Pre-requisitos

- Acceso al proyecto Railway que ya tiene el servicio `humand-insights-api` (FastAPI)
- Credenciales de Supabase a mano (las mismas que ya están en Vercel)

## 1. Crear nuevo service en Railway (5 min)

1. Railway dashboard → entrá al **mismo project** donde está la FastAPI
2. **New** → **GitHub Repo**
3. Seleccionás `salvadorcastrobay-hu/ai-insights-v3`
4. Branch: `main`
5. Service name: `humand-insights-web`
6. **Root Directory**: `humand-insights-web` ← importante
7. Railway autodetecta el `Dockerfile` y lo usa para buildear

## 2. Variables de entorno (10 min)

En el service `humand-insights-web` → **Variables** → agregás:

```bash
# Supabase (públicas, se bakean en el build)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_PROMPT_VERSION=v3.0

# Supabase server-side (no expuesta al cliente)
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Apunta al servicio FastAPI en el mismo project Railway
PYTHON_SERVICE_URL=https://humand-insights-api.railway.internal
# Si la comunicación interna no funciona, usá la URL pública del FastAPI:
# PYTHON_SERVICE_URL=https://humand-insights-api-production.up.railway.app

# Feature flag para Phase 2 RPC (opcional)
USE_RPC_AGGREGATIONS=false
```

**Copia/pega los mismos values que tenés en Vercel.** No los re-generes.

## 3. Build args (importante para Next.js)

Las `NEXT_PUBLIC_*` necesitan estar disponibles DURANTE el build (no solo en runtime), porque Next.js las bakea al bundle. Railway las pasa automáticamente como build args si están seteadas en el service env. Si después del primer build ves errores tipo "Missing NEXT_PUBLIC_SUPABASE_URL" → confirmá que están seteadas ANTES de triggerar el deploy.

## 4. Deploy inicial (10-15 min)

Railway buildea automáticamente al crear el service. Mirá los **Build logs**:

- Stage `deps` → `npm ci` (~30s)
- Stage `builder` → `next build` (~1-2 min)
- Stage `runner` → copia standalone output

Si el build OK, levanta el container. Healthcheck a la URL del service.

**Service URL**: aparece arriba del service. Típicamente `https://humand-insights-web-production-XXXX.up.railway.app`.

## 5. Validar el deploy temporal (10 min)

Antes de tocar producción, probás la URL de Railway directo:

1. Abrir la URL → debería redirigir a `/login`
2. Login con un user existente
3. Navegar todas las pages: executive-summary, pains-detail, chat, etc.
4. **OOM check**: stress test abriendo /executive-summary y /pains-detail varias veces. Si no rompe → win.
5. Test chat → verificar que `/api/chat/*` proxy llega a la FastAPI bien

## 6. Configurar memoria si hace falta (5 min)

Si OOMs persisten, Railway → service → **Settings → Resources** → subir Memory.

Default Hobby plan: 512MB. Subir a **2GB o 4GB** según necesidad. Railway cobra por uso real, así que solo gastás lo que consumas.

## 7. Custom domain o reuso del dominio Vercel (opcional)

### Opción A: dominio Railway temporal
- Compartís la URL Railway al equipo: `https://humand-insights-web-...up.railway.app`
- Más simple. Bookmark.

### Opción B: dominio custom (si querés mantener `humand-insights-web.vercel.app`)
- Railway → service → Settings → Domains
- Add custom domain → te da un CNAME
- Apuntás el DNS al CNAME (requiere ownership del dominio o config con Vercel)

## 8. Pause Vercel (último paso, NO borrar)

Una vez que confirmás que Railway anda:

1. Vercel dashboard → tu proyecto → Settings → General → scroll abajo
2. **Pause Project** (no Delete) — queda como backup vivo, sin servir tráfico
3. Si en el futuro querés volver a Vercel, lo "Resume" en 1 click

## Rollback rápido si algo sale mal

Vercel sigue activo en paralelo durante 2-7. Si Railway tira problema:
- Le decís al equipo que vuelvan a `humand-insights-web.vercel.app`
- Investigás Railway con calma
- Deploy fix → re-validás → re-anuncias

## Diferencias técnicas vs Vercel

| Aspecto | Vercel | Railway |
|---|---|---|
| Build | Detecta Next.js automático | Usa `Dockerfile` que armamos |
| Cold start | ~10s para cargar 50MB | ~0s (proceso persistente) |
| Memoria | 1024MB hard cap | Configurable (default 512MB, hasta 8GB) |
| Logging | Vercel logs | Railway logs (más completos, con search) |
| Crons | GitHub Actions (lo que ya tenemos) | Idem |
| Edge cache | Sí (no usamos) | No |
| Image optimization | Sí (no usamos) | No |

## Pendiente post-migración

- **DNS**: si vas a usar dominio custom, configurarlo
- **Token tracker**: chequear que `/api/usage/me` siga funcionando (es un proxy a la FastAPI)
- **n8n weekly digest**: sigue igual (no apunta a Vercel)
- **GitHub Actions cron**: siguen igual (no apuntan a Vercel)
