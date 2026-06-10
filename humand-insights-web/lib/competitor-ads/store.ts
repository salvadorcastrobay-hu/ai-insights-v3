import { getPg } from "@/lib/supabase/pg";
import type { AdSource, CompetitorAd } from "./types";

export type StoredAd = CompetitorAd & {
  first_seen_at: string;
  last_seen_at: string;
};

/** True si el error de postgres es "relation does not exist" (42P01). */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

/** Upsert por (source, competitor, ad_archive_id). Actualiza last_seen_at. */
export async function upsertAds(ads: CompetitorAd[]): Promise<number> {
  if (!ads.length) return 0;
  const sql = getPg();
  let n = 0;
  for (const a of ads) {
    await sql`
      INSERT INTO competitor_ads (
        source, competitor, ad_archive_id, collation_id, page_id, page_name,
        is_active, ad_start_date, ad_end_date, publisher_platform, display_format,
        body_text, title, cta_text, cta_type, link_url, categories, media,
        country, raw, last_seen_at, fetched_at
      ) VALUES (
        ${a.source}, ${a.competitor}, ${a.ad_archive_id}, ${a.collation_id},
        ${a.page_id}, ${a.page_name}, ${a.is_active}, ${a.ad_start_date}, ${a.ad_end_date},
        ${JSON.stringify(a.publisher_platform)}::jsonb, ${a.display_format},
        ${a.body_text}, ${a.title}, ${a.cta_text}, ${a.cta_type}, ${a.link_url},
        ${JSON.stringify(a.categories)}::jsonb, ${JSON.stringify(a.media)}::jsonb,
        ${a.country}, ${JSON.stringify(a.raw ?? null)}::jsonb, now(), now()
      )
      ON CONFLICT (source, competitor, ad_archive_id) DO UPDATE SET
        collation_id = EXCLUDED.collation_id,
        page_id = EXCLUDED.page_id,
        page_name = EXCLUDED.page_name,
        is_active = EXCLUDED.is_active,
        ad_start_date = EXCLUDED.ad_start_date,
        ad_end_date = EXCLUDED.ad_end_date,
        publisher_platform = EXCLUDED.publisher_platform,
        display_format = EXCLUDED.display_format,
        body_text = EXCLUDED.body_text,
        title = EXCLUDED.title,
        cta_text = EXCLUDED.cta_text,
        cta_type = EXCLUDED.cta_type,
        link_url = EXCLUDED.link_url,
        categories = EXCLUDED.categories,
        media = EXCLUDED.media,
        country = EXCLUDED.country,
        raw = EXCLUDED.raw,
        last_seen_at = now(),
        fetched_at = now()
    `;
    n++;
  }
  return n;
}

type Row = {
  source: AdSource;
  competitor: string;
  ad_archive_id: string;
  collation_id: string | null;
  page_id: string | null;
  page_name: string | null;
  is_active: boolean | null;
  ad_start_date: Date | null;
  ad_end_date: Date | null;
  publisher_platform: string[] | null;
  display_format: string | null;
  body_text: string | null;
  title: string | null;
  cta_text: string | null;
  cta_type: string | null;
  link_url: string | null;
  categories: string[] | null;
  media: { images: string[]; videos: string[] } | null;
  country: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
};

function toIso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

function mapRow(r: Row): StoredAd {
  return {
    source: r.source,
    competitor: r.competitor,
    ad_archive_id: r.ad_archive_id,
    collation_id: r.collation_id,
    page_id: r.page_id,
    page_name: r.page_name,
    is_active: r.is_active,
    ad_start_date: toIso(r.ad_start_date),
    ad_end_date: toIso(r.ad_end_date),
    publisher_platform: Array.isArray(r.publisher_platform) ? r.publisher_platform : [],
    display_format: r.display_format,
    body_text: r.body_text,
    title: r.title,
    cta_text: r.cta_text,
    cta_type: r.cta_type,
    link_url: r.link_url,
    categories: Array.isArray(r.categories) ? r.categories : [],
    media: {
      images: Array.isArray(r.media?.images) ? r.media.images : [],
      videos: Array.isArray(r.media?.videos) ? r.media.videos : [],
    },
    country: r.country,
    raw: null,
    first_seen_at: toIso(r.first_seen_at)!,
    last_seen_at: toIso(r.last_seen_at)!,
  };
}

/** Todos los avisos guardados, orden: competidor, más recientes primero. */
export async function loadStoredAds(): Promise<StoredAd[]> {
  const sql = getPg();
  try {
    const rows = await sql<Row[]>`
      SELECT source, competitor, ad_archive_id, collation_id, page_id, page_name,
             is_active, ad_start_date, ad_end_date, publisher_platform, display_format,
             body_text, title, cta_text, cta_type, link_url, categories, media,
             country, first_seen_at, last_seen_at
      FROM competitor_ads
      ORDER BY competitor ASC, ad_start_date DESC NULLS LAST
    `;
    return rows.map(mapRow);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Avisos de un competidor (para el análisis IA). */
export async function loadAdsForCompetitor(competitor: string, source: AdSource): Promise<StoredAd[]> {
  const sql = getPg();
  const rows = await sql<Row[]>`
    SELECT source, competitor, ad_archive_id, collation_id, page_id, page_name,
           is_active, ad_start_date, ad_end_date, publisher_platform, display_format,
           body_text, title, cta_text, cta_type, link_url, categories, media,
           country, first_seen_at, last_seen_at
    FROM competitor_ads
    WHERE competitor = ${competitor} AND source = ${source}
    ORDER BY ad_start_date DESC NULLS LAST
  `;
  return rows.map(mapRow);
}

export async function lastRefreshedAt(): Promise<string | null> {
  const sql = getPg();
  try {
    const rows = await sql<{ max: Date | null }[]>`SELECT MAX(fetched_at) AS max FROM competitor_ads`;
    return toIso(rows[0]?.max ?? null);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

// ─── Insights IA ────────────────────────────────────────────────────────────

export type AdInsight = {
  competitor: string;
  source: AdSource;
  payload: unknown;
  generated_at: string;
};

export async function loadAdInsights(): Promise<AdInsight[]> {
  const sql = getPg();
  try {
    const rows = await sql<{ competitor: string; source: AdSource; payload: unknown; generated_at: Date }[]>`
      SELECT competitor, source, payload, generated_at FROM competitor_ad_insights
    `;
    return rows.map((r) => ({
      competitor: r.competitor,
      source: r.source,
      payload: r.payload,
      generated_at: toIso(r.generated_at)!,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function saveAdInsight(
  competitor: string,
  source: AdSource,
  payload: unknown,
  model: string,
): Promise<void> {
  const sql = getPg();
  await sql`
    INSERT INTO competitor_ad_insights (competitor, source, payload, model, generated_at)
    VALUES (${competitor}, ${source}, ${JSON.stringify(payload)}::jsonb, ${model}, now())
    ON CONFLICT (competitor, source) DO UPDATE SET
      payload = EXCLUDED.payload, model = EXCLUDED.model, generated_at = now()
  `;
}
