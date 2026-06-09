import { getPg } from "@/lib/supabase/pg";
import type { CompetitorAd } from "./types";

export type StoredAd = CompetitorAd & {
  first_seen_at: string;
  last_seen_at: string;
};

/** Upsert por (competitor, ad_archive_id). Actualiza last_seen_at en cada refresh. */
export async function upsertAds(ads: CompetitorAd[]): Promise<number> {
  if (!ads.length) return 0;
  const sql = getPg();
  let n = 0;
  for (const a of ads) {
    await sql`
      INSERT INTO competitor_ads (
        competitor, ad_archive_id, page_id, page_name, is_active,
        ad_start_date, ad_end_date, publisher_platform, display_format,
        body_text, title, cta_text, cta_type, link_url, categories, media,
        country, last_seen_at, fetched_at
      ) VALUES (
        ${a.competitor}, ${a.ad_archive_id}, ${a.page_id}, ${a.page_name}, ${a.is_active},
        ${a.ad_start_date}, ${a.ad_end_date},
        ${JSON.stringify(a.publisher_platform)}::jsonb, ${a.display_format},
        ${a.body_text}, ${a.title}, ${a.cta_text}, ${a.cta_type}, ${a.link_url},
        ${JSON.stringify(a.categories)}::jsonb, ${JSON.stringify(a.media)}::jsonb,
        ${a.country}, now(), now()
      )
      ON CONFLICT (competitor, ad_archive_id) DO UPDATE SET
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
        last_seen_at = now(),
        fetched_at = now()
    `;
    n++;
  }
  return n;
}

type Row = {
  competitor: string;
  ad_archive_id: string;
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

/** Todos los avisos guardados, orden: competidor, más recientes primero. */
export async function loadStoredAds(): Promise<StoredAd[]> {
  const sql = getPg();
  const rows = await sql<Row[]>`
    SELECT competitor, ad_archive_id, page_id, page_name, is_active,
           ad_start_date, ad_end_date, publisher_platform, display_format,
           body_text, title, cta_text, cta_type, link_url, categories, media,
           country, first_seen_at, last_seen_at
    FROM competitor_ads
    ORDER BY competitor ASC, ad_start_date DESC NULLS LAST
  `;
  return rows.map((r) => ({
    competitor: r.competitor,
    ad_archive_id: r.ad_archive_id,
    page_id: r.page_id,
    page_name: r.page_name,
    is_active: r.is_active,
    ad_start_date: toIso(r.ad_start_date),
    ad_end_date: toIso(r.ad_end_date),
    publisher_platform: r.publisher_platform ?? [],
    display_format: r.display_format,
    body_text: r.body_text,
    title: r.title,
    cta_text: r.cta_text,
    cta_type: r.cta_type,
    link_url: r.link_url,
    categories: r.categories ?? [],
    media: r.media ?? { images: [], videos: [] },
    country: r.country,
    first_seen_at: toIso(r.first_seen_at)!,
    last_seen_at: toIso(r.last_seen_at)!,
  }));
}

/** Última vez que se hizo refresh (max fetched_at). */
export async function lastRefreshedAt(): Promise<string | null> {
  const sql = getPg();
  const rows = await sql<{ max: Date | null }[]>`SELECT MAX(fetched_at) AS max FROM competitor_ads`;
  return toIso(rows[0]?.max ?? null);
}
