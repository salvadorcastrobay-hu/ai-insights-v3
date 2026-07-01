import type { CompetitorAd } from "./types";

const LIST = "https://api.scrapecreators.com/v1/google/company/ads";
const DETAIL = "https://api.scrapecreators.com/v1/google/ad";

// Forma cruda (parcial) de la respuesta de ScrapeCreators para Google Ads
// Transparency Center. Confirmada contra la API real (no documentada
// públicamente en el listado de endpoints).
type RawListAd = {
  advertiserId?: string | null;
  creativeId?: string | null;
  format?: "text" | "image" | "video" | string | null;
  adUrl?: string | null;
  advertiserName?: string | null;
  imageUrl?: string | null;
  firstShown?: string | null;
  lastShown?: string | null;
};

type RawListResponse = { ads?: RawListAd[] | null };

type RawVariation = {
  headline?: string | null;
  description?: string | null;
  allText?: string | null;
  destinationUrl?: string | null;
  imageUrl?: string | null;
  visibleUrl?: string | null;
  videoId?: string | null;
  youtubeUrl?: string | null;
  image?: string | null;
};

type RawDetail = {
  advertiserId?: string | null;
  creativeId?: string | null;
  format?: string | null;
  url?: string | null;
  variations?: RawVariation[] | null;
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

function ytThumbnail(videoId: string): string {
  // Thumbnail estático público de YouTube, no requiere API key.
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function mapAd(competitor: string, list: RawListAd, detail: RawDetail | null): CompetitorAd | null {
  const id = list.creativeId ?? null;
  if (!id) return null;

  const variation = detail?.variations?.[0] ?? null;
  const images: string[] = [];
  const videos: string[] = [];
  // Los videos de Google Ads Transparency son links a YouTube (no un archivo
  // reproducible directo) — guardamos el thumbnail como imagen y el link de
  // YouTube en link_url; `videos` queda vacío a propósito.
  if (variation?.videoId) images.push(ytThumbnail(variation.videoId));
  else if (variation?.imageUrl ?? list.imageUrl) images.push((variation?.imageUrl ?? list.imageUrl) as string);

  const bodyText = variation?.allText ?? variation?.description ?? null;

  return {
    source: "google_ads",
    competitor,
    ad_archive_id: id,
    collation_id: null,
    page_id: list.advertiserId ?? null,
    page_name: list.advertiserName ?? null,
    is_active: null, // Google Ads Transparency no distingue activo/inactivo
    ad_start_date: list.firstShown ?? null,
    ad_end_date: null, // "lastShown" no es un end_date real (se actualiza mientras siga corriendo)
    publisher_platform: ["GOOGLE"],
    display_format: list.format ?? null,
    body_text: bodyText,
    title: variation?.headline ?? null,
    cta_text: null,
    cta_type: null,
    link_url: variation?.youtubeUrl ?? variation?.destinationUrl ?? list.adUrl ?? null,
    categories: [],
    media: { images, videos },
    country: null,
    raw: { list, detail },
  };
}

export type GoogleAdsFetchParams = {
  /** Dominio del sitio del competidor (más preciso que buscar por nombre). */
  domain: string;
  /** Máximo de avisos a enriquecer con el detalle (1 crédito c/u). Default 20. */
  maxAds?: number;
};

/**
 * Trae los avisos de un competidor de Google Ads Transparency Center vía
 * ScrapeCreators. El listado por dominio no trae texto/creativo — hay que
 * pedir el detalle por cada creativeId (1 crédito extra c/u), igual que el
 * enrichMissingMedia de Meta.
 */
export async function fetchGoogleAds(
  competitor: string,
  params: GoogleAdsFetchParams,
): Promise<CompetitorAd[]> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("Falta SCRAPECREATORS_API_KEY");

  const listUrl = new URL(LIST);
  listUrl.searchParams.set("domain", params.domain);
  const listRes = await scFetch(listUrl, key);
  if (!listRes.ok) {
    const text = await listRes.text().catch(() => "");
    throw new Error(`ScrapeCreators (Google) ${listRes.status}: ${text.slice(0, 200)}`);
  }
  const listJson = (await listRes.json()) as RawListResponse;
  const maxAds = Math.max(1, params.maxAds ?? 20);
  const ads = (listJson.ads ?? []).slice(0, maxAds);

  const out: CompetitorAd[] = [];
  // Concurrencia baja: el detalle es 1 pedido extra por aviso.
  let i = 0;
  const limit = 3;
  const worker = async () => {
    while (i < ads.length) {
      const list = ads[i++];
      if (!list.adUrl) continue;
      let detail: RawDetail | null = null;
      try {
        const detailUrl = new URL(DETAIL);
        detailUrl.searchParams.set("url", list.adUrl);
        const res = await scFetch(detailUrl, key);
        if (res.ok) detail = (await res.json()) as RawDetail;
      } catch {
        /* si el detalle falla, el aviso queda sin creativo (igual que Meta) */
      }
      const mapped = mapAd(competitor, list, detail);
      if (mapped) out.push(mapped);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, ads.length) }, worker));

  return out;
}
