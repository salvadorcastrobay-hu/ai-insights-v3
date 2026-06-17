import type { CompetitorAd } from "./types";

const BASE = "https://api.scrapecreators.com/v1/facebook/adLibrary/company/ads";
const DETAIL = "https://api.scrapecreators.com/v1/facebook/adLibrary/ad";

// Forma cruda (parcial) de la respuesta de ScrapeCreators. Solo tipamos lo que
// usamos; el objeto completo se guarda en `raw`.
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
  extra_images?: RawImage[] | null;
  extra_videos?: RawVideo[] | null;
};

type RawAd = {
  ad_archive_id?: string | null;
  collation_id?: string | null;
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

// Fetch a ScrapeCreators con reintentos ante errores transitorios (5xx/429).
// La Ad Library de FB devuelve 500 de a ratos; un par de reintentos lo salva.
async function scFetch(url: URL, key: string, retries = 3): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
    if (res.ok) return res;
    last = res;
    if (res.status < 500 && res.status !== 429) return res; // 4xx → no reintentar
    // Backoff generoso: FB devuelve 429 (rate limit) envuelto en 500.
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
  return last as Response;
}

function unixToIso(ts: number | null | undefined): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// `images` = thumbnails mostrables. Para video el creativo está en
// video_preview_image_url; para carruseles en cards. Juntamos todo.
function extractMedia(snap: RawSnapshot): { images: string[]; videos: string[] } {
  const images: string[] = [];
  const videos: string[] = [];
  const add = (list: string[], url: string | undefined) => {
    if (url && !list.includes(url)) list.push(url);
  };
  for (const im of [...(snap.images ?? []), ...(snap.extra_images ?? [])]) {
    const u = im.original_image_url ?? im.resized_image_url;
    add(images, u);
  }
  for (const v of [...(snap.videos ?? []), ...(snap.extra_videos ?? [])]) {
    add(images, v.video_preview_image_url);
    const vu = v.video_hd_url ?? v.video_sd_url;
    add(videos, vu);
  }
  for (const c of snap.cards ?? []) {
    const u = c.resized_image_url ?? c.original_image_url ?? c.video_preview_image_url;
    add(images, u);
    const vu = c.video_hd_url ?? c.video_sd_url;
    add(videos, vu);
  }
  return { images, videos };
}

function mapAd(competitor: string, country: string, ad: RawAd): CompetitorAd | null {
  const id = ad.ad_archive_id ?? null;
  if (!id) return null;
  const snap = ad.snapshot ?? {};
  const { images, videos } = extractMedia(snap);
  return {
    source: "meta_ads",
    competitor,
    ad_archive_id: id,
    collation_id: ad.collation_id ?? null,
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
    raw: ad,
  };
}

export type FetchParams = {
  companyName?: string;
  pageId?: string;
  country?: string; // default ALL
  status?: "ALL" | "ACTIVE" | "INACTIVE";
  sortBy?: "total_impressions" | "relevancy_monthly_grouped";
  /** Máximo de páginas de cursor a traer (1 crédito c/u). Default 3. */
  maxPages?: number;
  /**
   * Para los avisos cuyo snapshot del listado vino SIN creativo (típico en
   * DCO / multi-version), pedir el detalle por aviso y completar la media.
   * Cuesta 1 crédito extra por aviso afectado. Default false.
   */
  enrichMissingMedia?: boolean;
};

/** Trae el creativo de un aviso puntual (endpoint de detalle). 1 crédito. */
export async function fetchAdMedia(adArchiveId: string): Promise<{ images: string[]; videos: string[] } | null> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("Falta SCRAPECREATORS_API_KEY");
  const url = new URL(DETAIL);
  url.searchParams.set("id", adArchiveId);
  const res = await scFetch(url, key);
  if (!res.ok) return null;
  const json = (await res.json()) as { snapshot?: RawSnapshot } | RawSnapshot;
  const snap = ("snapshot" in json && json.snapshot ? json.snapshot : json) as RawSnapshot;
  return extractMedia(snap);
}

/** Completa la media de los avisos vacíos vía detalle, con cap de concurrencia. */
async function enrichMissingMedia(ads: CompetitorAd[], limit: number): Promise<void> {
  const targets = ads.filter((a) => a.media.images.length === 0 && a.media.videos.length === 0);
  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      const a = targets[i++];
      try {
        const m = await fetchAdMedia(a.ad_archive_id);
        if (m && (m.images.length || m.videos.length)) a.media = m;
      } catch {
        /* si el detalle falla, el aviso queda sin media (igual que antes) */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
}

/**
 * Trae los avisos de un competidor de la Meta Ad Library vía ScrapeCreators.
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
  const sortBy = params.sortBy ?? "relevancy_monthly_grouped";
  const maxPages = Math.max(1, params.maxPages ?? 3);

  const out = new Map<string, CompetitorAd>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(BASE);
    if (params.pageId) url.searchParams.set("pageId", params.pageId);
    else if (params.companyName) url.searchParams.set("companyName", params.companyName);
    else throw new Error("companyName o pageId requerido");
    url.searchParams.set("country", country);
    url.searchParams.set("status", status);
    url.searchParams.set("sort_by", sortBy);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await scFetch(url, key);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429 || /\b429\b/.test(text)) {
        throw new Error("Facebook está limitando los pedidos (429 / rate limit). Esperá unos minutos y reintentá.");
      }
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

  const ads = [...out.values()];
  if (params.enrichMissingMedia) {
    // Concurrencia baja: el detalle por aviso son pedidos extra a FB; con 4 en
    // paralelo se dispara el rate limit (429). 2 es más gentil.
    await enrichMissingMedia(ads, 2);
  }
  return ads;
}
