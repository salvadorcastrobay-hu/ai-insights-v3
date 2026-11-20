-- Meta nativo para lo propio: métricas de nuestros posts y nuestros ads.
--
-- content_posts.native_insights: lo que la Graph API mide de cada post propio
-- y Apify no ve (alcance, vistas, guardados, compartidos). Solo para cuentas
-- que el token de Meta puede leer; el resto queda en null.
--
-- content_own_ads: un anuncio por fila con sus métricas en la ventana de la
-- última corrida (se reescribe cada vez). ig_shortcode es el post de Instagram
-- que usa el anuncio: cruza con content_posts.post_id para marcar lo pautado.

alter table content_posts
  add column if not exists native_insights jsonb,
  add column if not exists native_fetched_at timestamptz;

create table if not exists content_own_ads (
  ad_id text primary key,
  ad_account_id text not null,
  ad_account_name text,
  currency text,
  campaign_id text,
  campaign_name text,
  objective text,
  adset_name text,
  ad_name text,
  status text,
  created_time timestamptz,
  creative_title text,
  creative_body text,
  object_type text,
  thumbnail_url text,
  ig_permalink text,
  ig_shortcode text,
  period_start date not null,
  period_end date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  leads integer not null default 0,
  actions jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists content_own_ads_account_idx on content_own_ads (ad_account_id);
create index if not exists content_own_ads_shortcode_idx on content_own_ads (ig_shortcode);

alter table content_own_ads enable row level security;
