# syntax=docker/dockerfile:1.7
# Next.js 16 + Node 24 LTS, standalone output. Optimizado para Railway.

# ─── Stage 1: install deps ─────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ─── Stage 2: build ────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars: NEXT_PUBLIC_* y SUPABASE_SERVICE_ROLE_KEY se
# inyectan en el bundle/build. Railway los pasa automáticamente si
# están seteados en el service env.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_PROMPT_VERSION
ARG SUPABASE_SERVICE_ROLE_KEY
ARG PYTHON_SERVICE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_PROMPT_VERSION=$NEXT_PUBLIC_PROMPT_VERSION
ENV SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
ENV PYTHON_SERVICE_URL=$PYTHON_SERVICE_URL

# Skip telemetry, no-color para logs limpios en Railway
ENV NEXT_TELEMETRY_DISABLED=1

# El proyecto no tiene carpeta public/ — creamos placeholder vacío para que
# el COPY del runner stage no falle. Next.js no la requiere si no hay
# assets estáticos.
RUN mkdir -p public

RUN npm run build

# ─── Stage 3: runner ───────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# User no-root por buena práctica
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copiamos solo lo necesario para correr (standalone output)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Railway inyecta $PORT en runtime. Si no, default 3000.
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
