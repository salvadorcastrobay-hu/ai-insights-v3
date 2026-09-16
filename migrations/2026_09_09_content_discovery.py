"""
Content Discovery: descubrimiento de contenido viral fuera de competidores.

A diferencia de competitor_organic_*, que modela "el contenido de UN competidor
conocido", esto modela "cualquier post que valga la pena aprender", venga de un
hashtag, de una influencer de RRHH o de un competidor. Por eso el eje deja de
ser `competitor` (text NOT NULL) y pasa a ser la dupla (autor, fuente).

Tablas:
  content_sources          — qué mirar. Reemplaza la config hardcodeada de
                             MONITORED_COMPETITORS para el eje ORGANICO. Los ads
                             pagos siguen leyendo de config.ts (tienen pageId /
                             googleDomain / advertiser, que no aplican acá).
  content_authors          — cuentas descubiertas + baseline de engagement.
  content_posts            — posts, con las metricas de ranking materializadas.
  content_post_sources     — N:M. Un mismo post puede venir de dos hashtags.
  content_metric_snapshots — histórico para momentum.
  content_refresh_jobs     — jobs persistidos. Los jobs del orgánico viven en
                             memoria (globalThis) porque la UI corre en el mismo
                             proceso; acá los pollea una app externa, así que un
                             redeploy no puede perder el estado.
  content_insights         — síntesis agregada por región/fuente (cache jsonb).

Rollback:
    DROP TABLE content_metric_snapshots, content_post_sources, content_posts,
               content_authors, content_refresh_jobs, content_insights,
               content_sources CASCADE;

Usage:
    python3 migrations/2026_09_09_content_discovery.py --dry-run
    python3 migrations/2026_09_09_content_discovery.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# ─── 1. Fuentes configurables ────────────────────────────────────────────────
# Una sola tabla con discriminador `kind` en vez de una tabla por tipo: la UI de
# admin es una grilla única y el job itera una sola lista ordenada por priority.
# La diferencia de comportamiento vive en el conector, no en el schema.
SQL_SOURCES = """
CREATE TABLE IF NOT EXISTS content_sources (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform        text NOT NULL DEFAULT 'instagram',
    kind            text NOT NULL,          -- hashtag|keyword|profile|competitor_profile|own_brand
    value           text NOT NULL,          -- '#' y '@' se guardan SIN el prefijo
    label           text,
    region          text NOT NULL DEFAULT 'hispam',
    language        text NOT NULL DEFAULT 'es-AR',
    audience        text,
    competitor_name text,                   -- puente a competitor_organic_* si aplica
    results_limit   int  NOT NULL DEFAULT 30,   -- cupo por corrida (contención de créditos)
    priority        int  NOT NULL DEFAULT 100,
    is_active       boolean NOT NULL DEFAULT true,
    -- Un keyword no se scrapea directo (Instagram no tiene full-text de posts):
    -- resuelve a hashtags/cuentas candidatas, que quedan acá como hijas en
    -- estado 'suggested' hasta que Content las aprueba. Recién ahí gastan cupo.
    discovered_from uuid REFERENCES content_sources(id) ON DELETE SET NULL,
    approval_state  text NOT NULL DEFAULT 'approved',  -- approved|suggested|rejected
    notes           text,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    last_run_at     timestamptz,
    last_run_status text,
    CONSTRAINT content_sources_kind_chk
        CHECK (kind IN ('hashtag','keyword','profile','competitor_profile','own_brand')),
    CONSTRAINT content_sources_approval_chk
        CHECK (approval_state IN ('approved','suggested','rejected')),
    CONSTRAINT content_sources_uniq UNIQUE (platform, kind, value, region)
);

CREATE INDEX IF NOT EXISTS cs_active_idx   ON content_sources (is_active, priority);
CREATE INDEX IF NOT EXISTS cs_region_idx   ON content_sources (region);
CREATE INDEX IF NOT EXISTS cs_kind_idx     ON content_sources (kind);
CREATE INDEX IF NOT EXISTS cs_approval_idx ON content_sources (approval_state);
"""

# ─── 2. Autores ──────────────────────────────────────────────────────────────
# competitor_organic_profiles no sirve acá: tiene UNIQUE (competitor), o sea un
# handle por competidor. Discovery necesita N cuentas arbitrarias sin competidor.
SQL_AUTHORS = """
CREATE TABLE IF NOT EXISTS content_authors (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform            text NOT NULL DEFAULT 'instagram',
    handle              text NOT NULL,
    full_name           text,
    biography           text,
    website             text,
    followers_count     int,
    following_count     int,
    posts_count         int,
    avatar_url          text,
    is_verified         boolean,
    author_kind         text,       -- influencer|brand|competitor|media|own_brand|unknown
    region_hint         text,
    language_hint       text,
    -- Baseline del scoring. Se recalcula en el paso `rescore` de cada corrida.
    -- Mediana y no promedio: un viral previo no debe aplastar la línea base.
    median_engagement   numeric,
    median_sample_size  int NOT NULL DEFAULT 0,
    follower_tier       text,       -- micro|mid|macro|mega
    is_relevant         boolean,    -- curaduría manual desde la UI
    raw                 jsonb,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    fetched_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT content_authors_uniq UNIQUE (platform, handle)
);

CREATE INDEX IF NOT EXISTS ca_tier_idx     ON content_authors (follower_tier);
CREATE INDEX IF NOT EXISTS ca_relevant_idx ON content_authors (is_relevant);
-- Para el paso de hidratación: qué autores tienen el perfil vencido.
CREATE INDEX IF NOT EXISTS ca_fetched_idx  ON content_authors (fetched_at);
"""

# ─── 3. Posts ────────────────────────────────────────────────────────────────
SQL_POSTS = """
CREATE TABLE IF NOT EXISTS content_posts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform            text NOT NULL DEFAULT 'instagram',
    post_id             text NOT NULL,          -- shortCode de Instagram
    author_handle       text NOT NULL,
    author_id           uuid REFERENCES content_authors(id) ON DELETE SET NULL,
    post_url            text,
    format              text,                   -- image|video|sidecar|reel
    caption             text,
    caption_length      int,
    hashtags            jsonb NOT NULL DEFAULT '[]',
    mentions            jsonb NOT NULL DEFAULT '[]',
    posted_at           timestamptz,
    duration_secs       float,
    likes_count         int,
    comments_count      int,
    video_views         int,
    -- Congelado al momento del fetch, a propósito: dividir los likes de un post
    -- de hace 6 meses por los followers de HOY da un engagement rate falso.
    -- (Es el bug que tiene computeEngagementRatePosts en el orgánico.)
    author_followers_at_fetch int,
    is_pinned           boolean NOT NULL DEFAULT false,
    is_paid_partnership boolean NOT NULL DEFAULT false,
    display_url         text,
    media               jsonb NOT NULL DEFAULT '{"images":[],"videos":[]}',
    recent_comments     jsonb NOT NULL DEFAULT '[]',
    analysis            jsonb,                  -- cache IA por post (fase 3)
    analysis_model      text,
    analyzed_at         timestamptz,
    -- Métricas materializadas en el paso `rescore`, para que la UI ordene por
    -- índice en vez de calcular en el cliente. Ver lib/content/scoring.ts.
    engagement_total    numeric,
    engagement_rate     numeric,
    outlier_factor      numeric,   -- eng / mediana del autor: invariante al tamaño
    viral_score         numeric,
    scored_at           timestamptz,
    raw                 jsonb,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    fetched_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT content_posts_uniq UNIQUE (platform, post_id)
);

CREATE INDEX IF NOT EXISTS cp_viral_idx  ON content_posts (viral_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS cp_posted_idx ON content_posts (posted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS cp_author_idx ON content_posts (author_handle);
CREATE INDEX IF NOT EXISTS cp_unanalyzed_idx ON content_posts (fetched_at) WHERE analysis IS NULL;
"""

# ─── 4. N:M post ↔ fuente ────────────────────────────────────────────────────
# region/language van desnormalizados: el filtro principal de la UI es por
# región y no queremos un join a content_sources en cada query del feed.
SQL_POST_SOURCES = """
CREATE TABLE IF NOT EXISTS content_post_sources (
    post_id       uuid NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
    source_id     uuid NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
    run_id        uuid,
    region        text,
    language      text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, source_id)
);

CREATE INDEX IF NOT EXISTS cps_source_idx ON content_post_sources (source_id);
CREATE INDEX IF NOT EXISTS cps_region_idx ON content_post_sources (region);
"""

# ─── 5. Snapshots de métricas ────────────────────────────────────────────────
SQL_SNAPSHOTS = """
CREATE TABLE IF NOT EXISTS content_metric_snapshots (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id          uuid NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
    snapshot_at      timestamptz NOT NULL DEFAULT now(),
    likes_count      int,
    comments_count   int,
    video_views      int,
    author_followers int,
    engagement_rate  numeric,
    CONSTRAINT content_metric_snapshots_uniq UNIQUE (post_id, snapshot_at)
);

CREATE INDEX IF NOT EXISTS cms_post_idx ON content_metric_snapshots (post_id, snapshot_at DESC);
"""

# ─── 6. Jobs persistidos ─────────────────────────────────────────────────────
# El equivalente orgánico (organic-refresh-job.ts) guarda esto en globalThis.
# Acá no alcanza: el que pollea es otra app, y un redeploy de Railway perdería
# el job. updated_at hace de heartbeat — un job sin latido por >5 min se marca
# failed en el siguiente GET.
SQL_JOBS = """
CREATE TABLE IF NOT EXISTS content_refresh_jobs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    state         text NOT NULL DEFAULT 'queued',    -- queued|running|completed|failed|cancelled
    kind          text NOT NULL DEFAULT 'discovery', -- discovery|analyze|hydrate_authors|rescore
    requested_by  text,
    options       jsonb NOT NULL DEFAULT '{}',
    source_ids    jsonb NOT NULL DEFAULT '[]',
    current_label text,
    progress      jsonb NOT NULL DEFAULT '{}',       -- {done,total,upserted,analyzed,apify_items}
    results       jsonb NOT NULL DEFAULT '[]',       -- por fuente
    cancel_requested boolean NOT NULL DEFAULT false, -- flag cooperativo
    error         text,
    started_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    CONSTRAINT content_refresh_jobs_state_chk
        CHECK (state IN ('queued','running','completed','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS crj_state_idx ON content_refresh_jobs (state, started_at DESC);
"""

# ─── 7. Síntesis agregada ────────────────────────────────────────────────────
SQL_INSIGHTS = """
CREATE TABLE IF NOT EXISTS content_insights (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope          text NOT NULL,   -- region|source|global
    scope_key      text NOT NULL,   -- 'br' | '<source_id>' | 'all'
    payload        jsonb NOT NULL,
    model          text,
    posts_analyzed int,
    generated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT content_insights_uniq UNIQUE (scope, scope_key)
);
"""

# RLS desde el arranque, no como parche posterior. Las tablas competitor_* se
# crearon sin RLS y hubo que cerrarlas después (sql/2026_08_19_enable_rls.sql).
# Sin policies = deny-by-default: anon/authenticated no leen nada por PostgREST.
# Todo el acceso es server-side con service_role, que bypassea RLS.
SQL_GRANTS = """
GRANT SELECT, INSERT, UPDATE, DELETE ON
    content_sources, content_authors, content_posts, content_post_sources,
    content_metric_snapshots, content_refresh_jobs, content_insights
    TO service_role;

ALTER TABLE content_sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_authors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_posts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_post_sources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_metric_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_refresh_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_insights           ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
"""

STEPS = [
    ("content_sources", SQL_SOURCES),
    ("content_authors", SQL_AUTHORS),
    ("content_posts", SQL_POSTS),
    ("content_post_sources", SQL_POST_SOURCES),
    ("content_metric_snapshots", SQL_SNAPSHOTS),
    ("content_refresh_jobs", SQL_JOBS),
    ("content_insights", SQL_INSIGHTS),
    ("grants + RLS + reload", SQL_GRANTS),
]


def main() -> int:
    if "--dry-run" in sys.argv:
        for label, sql in STEPS:
            print(f"-- ── {label} " + "─" * max(0, 60 - len(label)))
            print(sql)
        return 0

    import config  # noqa
    import psycopg2  # noqa

    params = config.get_db_connection_params()
    print(f"Connecting to {params['host']}:{params['port']}...")
    conn = psycopg2.connect(**params, connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SET statement_timeout = '60s';")
        for index, (label, sql) in enumerate(STEPS, start=1):
            print(f"  [{index}/{len(STEPS)}] {label}...")
            cur.execute(sql)
        conn.commit()
        print("✓ content discovery schema listo.")
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Falló (rollback): {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
