/**
 * Graph API de Meta: nuestras cuentas de Instagram y nuestras cuentas
 * publicitarias, leídas de forma nativa y no por scraping.
 *
 * Por qué nativo para lo propio (verificado contra la API el 2026-11-10):
 *   - Trae lo que Apify no ve: alcance, vistas, guardados y compartidos de cada
 *     post. Un post de @humand.br: alcance 392, vistas 554, 5 compartidos.
 *   - No gasta cupo de Apify, que queda entero para las cuentas de otros.
 *   - Los ads dicen qué post de Instagram usa cada anuncio
 *     (`instagram_permalink_url`), así que se puede marcar lo pautado.
 *
 * Necesita META_ACCESS_TOKEN con instagram_basic, instagram_manage_insights,
 * pages_show_list, pages_read_engagement y ads_read. Solo ve las cuentas que
 * el dueño del token comparte: @humand.es hoy no está (vive en otro portafolio
 * de negocio), y para esa cuenta la ingesta sigue por Apify.
 *
 * Todo lo que transforma es puro y se testea sin red; lo que pega a la API
 * está separado en las funciones `fetch*`.
 */
import type { ContentPostUpsert } from "./store";

const GRAPH = "https://graph.facebook.com/v21.0";

export function metaToken(): string | null {
  return process.env.META_ACCESS_TOKEN?.trim() || null;
}

type GraphPage<T> = { data?: T[]; paging?: { next?: string }; error?: { message?: string } };

async function graph<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || body.error) {
    // El token va en la URL: nunca se loguea la URL, solo el mensaje de Meta.
    throw new Error(`Meta Graph: ${body.error?.message ?? res.status}`);
  }
  return body;
}

function withToken(path: string, params: Record<string, string | number | undefined> = {}): string {
  const token = metaToken();
  if (!token) throw new Error("Falta META_ACCESS_TOKEN");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  qs.set("access_token", token);
  return `${GRAPH}/${path}?${qs.toString()}`;
}

/** Recorre todas las páginas de un listado, hasta `max` elementos. */
async function graphAll<T>(firstUrl: string, max = Infinity): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = firstUrl;
  while (url && out.length < max) {
    const page: GraphPage<T> = await graph<GraphPage<T>>(url);
    out.push(...(page.data ?? []));
    url = page.paging?.next;
  }
  return out.slice(0, max);
}

/** Corre `fn` sobre `items` con a lo sumo `n` en paralelo. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ─── Instagram propio ────────────────────────────────────────────────────────

export type InstagramAccount = {
  id: string;
  username: string;
  name?: string | null;
  biography?: string | null;
  website?: string | null;
  followers_count?: number | null;
  follows_count?: number | null;
  media_count?: number | null;
  profile_picture_url?: string | null;
};

const ACCOUNT_FIELDS = "id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url";

let accountsCache: { at: number; accounts: InstagramAccount[] } | null = null;

/**
 * Cuentas de Instagram que el token puede leer: las vinculadas a páginas que
 * administra y las del portafolio de negocio. Cacheado unos minutos: una
 * corrida pregunta por cada fuente propia.
 */
export async function listInstagramAccounts(): Promise<InstagramAccount[]> {
  if (!metaToken()) return [];
  if (accountsCache && Date.now() - accountsCache.at < 10 * 60_000) return accountsCache.accounts;

  const byId = new Map<string, InstagramAccount>();
  const pages = await graphAll<{ instagram_business_account?: InstagramAccount }>(
    withToken("me/accounts", { fields: `instagram_business_account{${ACCOUNT_FIELDS}}`, limit: 100 }),
  );
  for (const p of pages) if (p.instagram_business_account) byId.set(p.instagram_business_account.id, p.instagram_business_account);

  // Las del portafolio que no están en una página propia (ej. @humand.mx).
  const businesses = await graphAll<{ owned_instagram_accounts?: { data?: Array<{ id: string }> } }>(
    withToken("me/businesses", { fields: "owned_instagram_accounts{id}", limit: 50 }),
  ).catch(() => []);
  const missing = businesses
    .flatMap((b) => b.owned_instagram_accounts?.data ?? [])
    .filter((a) => !byId.has(a.id));
  for (const a of missing) {
    const account = await graph<InstagramAccount>(withToken(a.id, { fields: ACCOUNT_FIELDS })).catch(() => null);
    if (account) byId.set(account.id, account);
  }

  accountsCache = { at: Date.now(), accounts: [...byId.values()] };
  return accountsCache.accounts;
}

export async function findInstagramAccount(handle: string): Promise<InstagramAccount | null> {
  const wanted = handle.replace(/^@/, "").trim().toLowerCase();
  const accounts = await listInstagramAccounts().catch((err) => {
    console.warn("[meta] no pude listar cuentas de Instagram:", (err as Error)?.message ?? err);
    return [];
  });
  return accounts.find((a) => a.username.toLowerCase() === wanted) ?? null;
}

export type GraphMedia = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD" | string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  shortcode?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  is_comment_enabled?: boolean;
  children?: { data?: Array<{ id: string; media_type: string; media_url?: string; thumbnail_url?: string }> };
};

/** Lo que Meta mide de cada post y Apify no ve. */
export type NativeInsights = {
  reach: number | null;
  views: number | null;
  saved: number | null;
  shares: number | null;
  total_interactions: number | null;
};

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,shortcode,timestamp,like_count,comments_count,children{id,media_type,media_url,thumbnail_url}";

/** Posts de una cuenta, del más nuevo al más viejo, desde `since` (YYYY-MM-DD) si se da. */
export async function fetchInstagramMedia(igUserId: string, opts: { since?: string | null; max: number }): Promise<GraphMedia[]> {
  const sinceMs = opts.since ? Date.parse(opts.since) : null;
  const out: GraphMedia[] = [];
  let url: string | undefined = withToken(`${igUserId}/media`, { fields: MEDIA_FIELDS, limit: 50 });
  while (url && out.length < opts.max) {
    const page: GraphPage<GraphMedia> = await graph<GraphPage<GraphMedia>>(url);
    const items = page.data ?? [];
    for (const m of items) {
      // Vienen ordenados por fecha: el primero más viejo que la ventana corta.
      if (sinceMs != null && m.timestamp && Date.parse(m.timestamp) < sinceMs) return out;
      out.push(m);
      if (out.length >= opts.max) break;
    }
    url = page.paging?.next;
  }
  return out;
}

const INSIGHT_METRICS = ["reach", "views", "saved", "shares", "total_interactions"] as const;

export function parseInsights(body: { data?: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }> }): NativeInsights {
  const out: NativeInsights = { reach: null, views: null, saved: null, shares: null, total_interactions: null };
  for (const m of body.data ?? []) {
    if (!(INSIGHT_METRICS as readonly string[]).includes(m.name)) continue;
    const v = m.values?.[0]?.value ?? m.total_value?.value;
    out[m.name as keyof NativeInsights] = typeof v === "number" ? v : null;
  }
  return out;
}

export async function fetchMediaInsights(mediaId: string): Promise<NativeInsights | null> {
  try {
    const body = await graph<Parameters<typeof parseInsights>[0]>(
      withToken(`${mediaId}/insights`, { metric: INSIGHT_METRICS.join(",") }),
    );
    return parseInsights(body);
  } catch (err) {
    // Posts anteriores a que la cuenta fuera de empresa no tienen insights.
    console.warn(`[meta] sin insights para ${mediaId}:`, (err as Error)?.message ?? err);
    return null;
  }
}

/** El código del post en la URL (instagram.com/p/<code>/). Es el post_id que guarda Apify. */
export function shortcodeFromPermalink(url: string | null | undefined): string | null {
  const m = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([^/?#]+)/.exec(url ?? "");
  return m ? m[1] : null;
}

/**
 * Un post de la Graph API con la forma que guarda la ingesta.
 *
 * El post_id es el shortcode, igual que con Apify: si una cuenta pasa de un
 * camino al otro, los posts son las mismas filas y no se duplican. El raw
 * imita los campos de Apify que lee computeFeatures (productType, childPosts,
 * type) y guarda el original en `graph`.
 */
export function mapGraphMedia(
  media: GraphMedia,
  account: Pick<InstagramAccount, "username" | "followers_count">,
  insights: NativeInsights | null,
): (ContentPostUpsert & { native_insights: (NativeInsights & { fetched_at: string }) | null }) | null {
  const code = media.shortcode ?? shortcodeFromPermalink(media.permalink);
  if (!code) return null;
  const caption = media.caption ?? null;
  const children = media.children?.data ?? [];
  const images: string[] = [];
  const videos: string[] = [];
  const add = (list: string[], v?: string) => {
    if (v && !list.includes(v)) list.push(v);
  };
  if (media.media_type === "VIDEO") {
    add(images, media.thumbnail_url);
    add(videos, media.media_url);
  } else {
    add(images, media.media_url);
  }
  for (const c of children) {
    if (c.media_type === "VIDEO") {
      add(images, c.thumbnail_url);
      add(videos, c.media_url);
    } else add(images, c.media_url);
  }
  const format = media.media_type === "CAROUSEL_ALBUM" ? "sidecar" : media.media_type === "VIDEO" ? "video" : "image";
  const tags = (re: RegExp) => [...(caption ?? "").matchAll(re)].map((m) => m[1]);

  return {
    platform: "instagram",
    post_id: code,
    author_handle: account.username,
    post_url: media.permalink ?? `https://www.instagram.com/p/${code}/`,
    format,
    caption,
    caption_length: caption ? caption.length : null,
    hashtags: tags(/#([\p{L}\p{N}_]+)/gu),
    mentions: tags(/@([A-Za-z0-9._]+)/g),
    posted_at: media.timestamp ? new Date(media.timestamp).toISOString() : null,
    duration_secs: null,
    likes_count: media.like_count ?? null,
    comments_count: media.comments_count ?? null,
    // Para videos, "views" de Meta es lo comparable con videoViewCount de Apify.
    video_views: media.media_type === "VIDEO" ? insights?.views ?? null : null,
    // Meta sí da compartidos en Instagram; Apify no.
    shares_count: insights?.shares ?? null,
    author_followers_at_fetch: account.followers_count ?? null,
    is_pinned: false,
    is_paid_partnership: false,
    display_url: images[0] ?? null,
    media: { images, videos },
    recent_comments: [],
    native_insights: insights ? { ...insights, fetched_at: new Date().toISOString() } : null,
    raw: {
      source: "meta_graph",
      type: format === "sidecar" ? "Sidecar" : format === "video" ? "Video" : "Image",
      productType: media.media_product_type === "REELS" ? "clips" : media.media_type === "CAROUSEL_ALBUM" ? "carousel_container" : "feed",
      childPosts: children.map((c) => ({ type: c.media_type === "VIDEO" ? "Video" : "Image" })),
      shortCode: code,
      graph: media,
    },
  };
}

/**
 * Posts e insights de una cuenta propia, listos para upsert. Los insights se
 * piden de a varios en paralelo: es un request por post.
 */
export async function fetchOwnInstagramPosts(
  account: InstagramAccount,
  opts: { since?: string | null; max: number },
): Promise<ReturnType<typeof mapGraphMedia>[]> {
  const media = await fetchInstagramMedia(account.id, opts);
  const insights = await pool(media, 5, (m) => fetchMediaInsights(m.id));
  return media.map((m, i) => mapGraphMedia(m, account, insights[i]));
}

// ─── Ads propios ─────────────────────────────────────────────────────────────

export type AdAccount = { id: string; account_id: string; name: string; currency: string; account_status: number };

/** Cuentas publicitarias activas que el token puede leer. */
export async function listAdAccounts(): Promise<AdAccount[]> {
  const all = await graphAll<AdAccount>(
    withToken("me/adaccounts", { fields: "id,account_id,name,currency,account_status", limit: 100 }),
  );
  // 1 = activa. Las "(Read-Only)" vienen en 2 y no gastan.
  return all.filter((a) => a.account_status === 1);
}

export type AdInsightRow = {
  ad_id: string;
  ad_name?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  objective?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
  date_start?: string;
  date_stop?: string;
};

export type AdMeta = {
  id: string;
  name?: string;
  effective_status?: string;
  created_time?: string;
  creative?: {
    id?: string;
    title?: string;
    body?: string;
    object_type?: string;
    thumbnail_url?: string;
    image_url?: string;
    instagram_permalink_url?: string;
    effective_instagram_media_id?: string;
  };
};

/** Métricas por anuncio en la ventana. Solo vienen los que tuvieron impresiones. */
export async function fetchAdInsights(accountId: string, since: string, until: string): Promise<AdInsightRow[]> {
  return graphAll<AdInsightRow>(
    withToken(`${accountId}/insights`, {
      level: "ad",
      time_range: JSON.stringify({ since, until }),
      fields: "ad_id,ad_name,adset_name,campaign_id,campaign_name,objective,spend,impressions,reach,clicks,actions,date_start,date_stop",
      limit: 500,
    }),
  );
}

/** Creatividad y estado de una lista de anuncios, de a 50 por request. */
export async function fetchAdsMeta(adIds: string[]): Promise<Map<string, AdMeta>> {
  const out = new Map<string, AdMeta>();
  const fields =
    "id,name,effective_status,created_time,creative.thumbnail_width(480).thumbnail_height(480){id,title,body,object_type,thumbnail_url,image_url,instagram_permalink_url,effective_instagram_media_id}";
  for (let i = 0; i < adIds.length; i += 50) {
    const batch = adIds.slice(i, i + 50);
    const body = await graph<Record<string, AdMeta>>(withToken("", { ids: batch.join(","), fields }));
    for (const [id, ad] of Object.entries(body)) out.set(id, ad);
  }
  return out;
}

/** Acciones que cuentan como lead, en orden de preferencia. Se toma la primera que aparezca. */
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

export function leadsFrom(actions: AdInsightRow["actions"]): number {
  for (const type of LEAD_ACTIONS) {
    const hit = actions?.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export type OwnAdRow = {
  ad_id: string;
  ad_account_id: string;
  ad_account_name: string;
  currency: string;
  campaign_id: string | null;
  campaign_name: string | null;
  objective: string | null;
  adset_name: string | null;
  ad_name: string | null;
  status: string | null;
  created_time: string | null;
  creative_title: string | null;
  creative_body: string | null;
  object_type: string | null;
  thumbnail_url: string | null;
  ig_permalink: string | null;
  ig_shortcode: string | null;
  period_start: string;
  period_end: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  actions: AdInsightRow["actions"] | null;
  fetched_at: string;
};

/** Junta métricas y creatividad en la fila que se guarda. */
export function toOwnAdRow(
  account: AdAccount,
  row: AdInsightRow,
  meta: AdMeta | undefined,
  period: { since: string; until: string },
): OwnAdRow {
  const creative = meta?.creative ?? {};
  const permalink = creative.instagram_permalink_url ?? null;
  return {
    ad_id: row.ad_id,
    ad_account_id: account.id,
    ad_account_name: account.name,
    currency: account.currency,
    campaign_id: row.campaign_id ?? null,
    campaign_name: row.campaign_name ?? null,
    objective: row.objective ?? null,
    adset_name: row.adset_name ?? null,
    ad_name: row.ad_name ?? meta?.name ?? null,
    status: meta?.effective_status ?? null,
    created_time: meta?.created_time ? new Date(meta.created_time).toISOString() : null,
    creative_title: creative.title ?? null,
    creative_body: creative.body ?? null,
    object_type: creative.object_type ?? null,
    thumbnail_url: creative.image_url ?? creative.thumbnail_url ?? null,
    ig_permalink: permalink,
    ig_shortcode: shortcodeFromPermalink(permalink),
    period_start: period.since,
    period_end: period.until,
    spend: Number(row.spend ?? 0) || 0,
    impressions: Number(row.impressions ?? 0) || 0,
    reach: Number(row.reach ?? 0) || 0,
    clicks: Number(row.clicks ?? 0) || 0,
    leads: leadsFrom(row.actions),
    actions: row.actions ?? null,
    fetched_at: new Date().toISOString(),
  };
}
