-- Audiencia reclasificada (humand-content, filtros de Inspiración) y país por cuenta.
-- Campos nuevos y nullable: no tocan analysis->>audience_signal ni nada que lea el motor.
alter table content_posts add column if not exists audience text;
alter table content_posts add column if not exists audience_secondary text;
alter table content_posts add column if not exists audience_reason text;
alter table content_posts add column if not exists audience_model text;
alter table content_posts add column if not exists audience_classified_at timestamptz;
create index if not exists content_posts_audience_idx on content_posts (audience);

-- ISO 3166-1 alpha-2 en minúscula (ar, mx, cl...). Null = no se sabe.
alter table content_authors add column if not exists country text;
alter table content_authors add column if not exists country_source text;
