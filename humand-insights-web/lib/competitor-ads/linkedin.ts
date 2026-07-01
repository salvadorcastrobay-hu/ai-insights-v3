import type { CompetitorAd } from "./types";

const SEARCH = "https://api.scrapecreators.com/v1/linkedin/ads/search";

// Forma cruda (parcial) de la respuesta de ScrapeCreators para LinkedIn Ad
// Library. Confirmada contra la API real (no documentada públicamente).
type RawAd = {
  id?: string | null;
  description?: string | null;
  headline?: string | null;
  advertiser?: string | null;
  advertiserLinkedinPage?: string | null;
  image?: string | null;
  video?: string | null;
  organicVideo?: string | null;
  carouselImages?: string[] | null;
  url?: string | null;
  adType?: string | null; // "Message Ad" | "Video Ad" | "Single Image Ad" | ...
  creativeType?: string | null;
  cta?: string | null;
  destinationUrl?: string | null;
  landingPage?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

type RawResponse = {
  success?: boolean;
  ads?: RawAd[] | null;
  paginationToken?: string | null;
  isLastPage?: boolean;
  totalAds?: number;
};

// Mismo patrón de reintentos que scrapecreators.ts: 429/5xx transitorios se
// reintentan con backoff, 4xx no.
async function scFetch(url: URL, key: string, retries = 3): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
    if (res.ok) return res;
    last = res;
    if (res.status < 500 && res.status !== 429) return res;
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
  return last as Response;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function extractMedia(ad: RawAd): { images: string[]; videos: string[] } {
  const images: string[] = [];
  const videos: string[] = [];
  if (ad.image) images.push(ad.image);
  for (const u of ad.carouselImages ?? []) if (u && !images.includes(u)) images.push(u);
  // `video`/`organicVideo` de LinkedIn son mp4 directos (CDN licdn), a
  // diferencia de YouTube en Google — se pueden reproducir en <video> tal cual.
  const v = ad.video ?? ad.organicVideo;
  if (v) videos.push(v);
  return { images, videos };
}

function mapAd(competitor: string, country: string, ad: RawAd): CompetitorAd | null {
  const id = ad.id ?? null;
  if (!id) return null;
  const { images, videos } = extractMedia(ad);
  return {
    source: "linkedin_ads",
    competitor,
    ad_archive_id: id,
    collation_id: null, // LinkedIn no expone id de campaña en este endpoint
    page_id: ad.advertiserLinkedinPage ?? null,
    page_name: ad.advertiser ?? null,
    is_active: null, // el endpoint no distingue activo/inactivo
    ad_start_date: ad.startDate ?? null,
    ad_end_date: ad.endDate ?? null,
    publisher_platform: ["LINKEDIN"],
    display_format: ad.adType ?? null,
    body_text: ad.description ?? null,
    title: ad.headline ?? null,
    cta_text: ad.cta ?? null,
    cta_type: null,
    link_url: ad.destinationUrl ?? ad.landingPage ?? null,
    categories: [],
    media: { images, videos },
    country,
    raw: ad,
  };
}

export type LinkedInFetchParams = {
  /** Nombre a buscar (param `company` de la API). */
  company: string;
  country?: string;
  /** Máximo de páginas de cursor a traer (1 crédito c/u). Default 2. */
  maxPages?: number;
};

/**
 * Trae los avisos de un competidor de la LinkedIn Ad Library vía
 * ScrapeCreators. La búsqueda por nombre es fuzzy (ej. "Buk" también trae
 * "Buket"/"Bukhara") — filtramos por advertiser cuyo nombre normalizado
 * empiece igual que `competitor`, para no guardar avisos de terceros.
 */
export async function fetchLinkedInAds(
  competitor: string,
  params: LinkedInFetchParams,
): Promise<CompetitorAd[]> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("Falta SCRAPECREATORS_API_KEY");

  const maxPages = Math.max(1, params.maxPages ?? 2);
  const wanted = normalizeName(competitor);

  const out = new Map<string, CompetitorAd>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(SEARCH);
    url.searchParams.set("company", params.company);
    if (cursor) url.searchParams.set("paginationToken", cursor);

    const res = await scFetch(url, key);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ScrapeCreators (LinkedIn) ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as RawResponse;
    for (const raw of json.ads ?? []) {
      const advertiser = normalizeName(raw.advertiser ?? "");
      if (!advertiser.startsWith(wanted)) continue; // descarta homónimos
      const mapped = mapAd(competitor, params.country ?? "ALL", raw);
      if (mapped) out.set(mapped.ad_archive_id, mapped);
    }
    if (json.isLastPage || !json.paginationToken) break;
    cursor = json.paginationToken;
  }

  return [...out.values()];
}
