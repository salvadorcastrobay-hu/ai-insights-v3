import type { CompetitorAd } from "./types";

const BASE = "https://api.scrapecreators.com/v1/facebook/adLibrary/company/ads";

// Forma cruda (parcial) de la respuesta de ScrapeCreators. Solo tipamos lo que
// usamos; el resto queda en `raw` por si sumamos campos.
type RawImage = { original_image_url?: string; resized_image_url?: string };
type RawVideo = {
  video_hd_url?: string;
  video_sd_url?: string;
  video_preview_image_url?: string;
};
type RawCard = RawImage & RawVideo;

type RawSnapshot = {
  body?: { text?: string | null } | null;
  title?: string | null;
  cta_text?: string | null;
  cta_type?: string | null;
  link_url?: string | null;
  display_format?: string | null;
  images?: RawImage[] | null;
  videos?: RawVideo[] | null;
  cards?: RawCard[] | null;
};

type RawAd = {
  ad_archive_id?: string | null;
  page_id?: string | null;
  page_name?: string | null;
  is_active?: boolean | null;
  start_date?: number | null; // unix seconds
  end_date?: number | null;
  publisher_platform?: string[] | null;
  categories?: string[] | null;
  snapshot?: RawSnapshot | null;
};

type RawResponse = { results?: RawAd[] | null; cursor?: string | null };

function unixToIso(ts: number | null | undefined): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapAd(competitor: string, country: string, ad: RawAd): CompetitorAd | null {
  const id = ad.ad_archive_id ?? null;
  if (!id) return null;
  const snap = ad.snapshot ?? {};
  // `images` = thumbnails mostrables. Para avisos de video el creativo está en
  // video_preview_image_url; para carruseles en cards. Juntamos todo.
  const images: string[] = [];
  const videos: string[] = [];
  for (const im of snap.images ?? []) {
    const u = im.original_image_url ?? im.resized_image_url;
    if (u) images.push(u);
  }
  for (const v of snap.videos ?? []) {
    if (v.video_preview_image_url) images.push(v.video_preview_image_url);
    const vu = v.video_hd_url ?? v.video_sd_url;
    if (vu) videos.push(vu);
  }
  for (const c of snap.cards ?? []) {
    const u = c.resized_image_url ?? c.original_image_url ?? c.video_preview_image_url;
    if (u) images.push(u);
    const vu = c.video_hd_url ?? c.video_sd_url;
    if (vu) videos.push(vu);
  }
  return {
    competitor,
    ad_archive_id: id,
    page_id: ad.page_id ?? null,
    page_name: ad.page_name ?? null,
    is_active: ad.is_active ?? null,
    ad_start_date: unixToIso(ad.start_date),
    ad_end_date: unixToIso(ad.end_date),
    publisher_platform: ad.publisher_platform ?? [],
    display_format: snap.display_format ?? null,
    body_text: snap.body?.text ?? null,
    title: snap.title ?? null,
    cta_text: snap.cta_text ?? null,
    cta_type: snap.cta_type ?? null,
    link_url: snap.link_url ?? null,
    categories: ad.categories ?? [],
    media: { images, videos },
    country,
  };
}

export type FetchParams = {
  companyName?: string;
  pageId?: string;
  country?: string; // default ALL
  status?: "ALL" | "ACTIVE" | "INACTIVE";
  /** Máximo de páginas de cursor a traer (1 crédito c/u). Default 1. */
  maxPages?: number;
};

/**
 * Trae los avisos de un competidor de la Ad Library vía ScrapeCreators.
 * Requiere SCRAPECREATORS_API_KEY. Devuelve avisos normalizados (dedupeados
 * por ad_archive_id). Lanza si falta la key o si la API responde !ok.
 */
export async function fetchCompanyAds(
  competitor: string,
  params: FetchParams,
): Promise<CompetitorAd[]> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("Falta SCRAPECREATORS_API_KEY");

  const country = params.country ?? "ALL";
  const status = params.status ?? "ACTIVE";
  const maxPages = Math.max(1, params.maxPages ?? 1);

  const out = new Map<string, CompetitorAd>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(BASE);
    if (params.pageId) url.searchParams.set("pageId", params.pageId);
    else if (params.companyName) url.searchParams.set("companyName", params.companyName);
    else throw new Error("companyName o pageId requerido");
    url.searchParams.set("country", country);
    url.searchParams.set("status", status);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, {
      headers: { "x-api-key": key },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ScrapeCreators ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as RawResponse;
    for (const raw of json.results ?? []) {
      const mapped = mapAd(competitor, country, raw);
      if (mapped) out.set(mapped.ad_archive_id, mapped);
    }
    cursor = json.cursor ?? null;
    if (!cursor) break;
  }

  return [...out.values()];
}
