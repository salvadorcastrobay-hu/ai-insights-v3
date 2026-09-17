/**
 * Conector para los scrapers de Instagram de Apify.
 *
 * Dos ejes:
 *   - por perfil (fetchInstagramFeed / fetchInstagramPosts): el camino original,
 *     usado por el monitoreo de competidores.
 *   - por hashtag y búsqueda (fetchInstagramHashtag / searchInstagram): discovery
 *     de contenido que no sale de una cuenta que ya conocemos.
 *
 * Los actores devuelven items con el mismo shape (RawInstagramPost), así que el
 * mapeo aguas abajo se reusa tal cual.
 *
 * Requisito: variable APIFY_API_KEY en el entorno.
 */

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_PROFILE = "apify~instagram-scraper";
const ACTOR_HASHTAG = "apify~instagram-hashtag-scraper";
const ACTOR_SEARCH = "apify~instagram-search-scraper";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 180_000; // 3 min — runs lentos en cold start
// Los runs por hashtag recorren más páginas que los de un perfil solo.
const HASHTAG_POLL_TIMEOUT_MS = 420_000; // 7 min

export type RawInstagramPost = {
  id: string;
  shortCode: string;
  url: string;
  type: string;          // "Image" | "Video" | "Sidecar" | "Reel"
  caption: string | null;
  timestamp: string;     // ISO
  likesCount: number | null;
  commentsCount: number | null;
  videoViewCount: number | null;
  videoDuration: number | null;        // segundos
  isPinned: boolean | null;
  isPaidPartnership: boolean | null;
  hashtags: string[];
  mentions: string[];
  displayUrl: string | null;
  videoUrl?: string | null;
  images?: string[] | null;
  childPosts?: Array<{ displayUrl?: string | null; videoUrl?: string | null; type?: string | null }> | null;
  latestComments: Array<{ text: string; timestamp: string }> | null;
  ownerUsername?: string | null;
  ownerFullName?: string | null;
  ownerBiography?: string | null;
  ownerExternalUrl?: string | null;
  ownerFollowersCount?: number | null;
  ownerFollowsCount?: number | null;
  ownerPostsCount?: number | null;
  ownerProfilePicUrl?: string | null;
  username?: string | null;
  fullName?: string | null;
  biography?: string | null;
  externalUrl?: string | null;
  followersCount?: number | null;
  followsCount?: number | null;
  postsCount?: number | null;
  profilePicUrl?: string | null;
};

export type RawInstagramProfile = {
  handle: string;
  profile_url: string | null;
  full_name: string | null;
  biography: string | null;
  website: string | null;
  followers_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  avatar_url: string | null;
  raw: unknown;
};

function apiKey(): string {
  const k = process.env.APIFY_API_KEY;
  if (!k) throw new Error("Falta APIFY_API_KEY en el entorno.");
  return k;
}

async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const key = apiKey();
  const url = `${APIFY_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      ...opts?.headers,
    },
  });
  return res;
}

async function startRun(actorId: string, input: Record<string, unknown>): Promise<string> {
  const res = await apiFetch(`/acts/${actorId}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Apify run start failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { data?: { id?: string } };
  const runId = json?.data?.id;
  if (!runId) throw new Error("Apify no devolvió runId");
  return runId;
}

async function pollRun(runId: string, timeoutMs: number = POLL_TIMEOUT_MS): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await apiFetch(`/actor-runs/${runId}`);
    if (!res.ok) continue;
    const json = (await res.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    const status = json?.data?.status;
    if (status === "SUCCEEDED") {
      const datasetId = json?.data?.defaultDatasetId;
      if (!datasetId) throw new Error("Run succeeded pero sin defaultDatasetId");
      return datasetId;
    }
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${runId} terminó con estado: ${status}`);
    }
  }
  throw new Error(`Apify run ${runId} no completó en ${timeoutMs / 1000}s`);
}

async function fetchDataset<T = RawInstagramPost>(datasetId: string): Promise<T[]> {
  const res = await apiFetch(`/datasets/${datasetId}/items?format=json&clean=true`);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Dataset fetch failed (${res.status}): ${text}`);
  }
  const items = (await res.json()) as unknown[];
  return (items ?? []) as T[];
}

/**
 * Trae posts orgánicos de Instagram para un handle dado.
 * Inicia un run en Apify, espera que termine, y devuelve los items.
 */
export async function fetchInstagramPosts(
  handle: string,
  opts: { maxItems?: number } = {},
): Promise<RawInstagramPost[]> {
  const feed = await fetchInstagramFeed(handle, opts);
  return feed.posts;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function profileFromFirstPost(handle: string, posts: RawInstagramPost[]): RawInstagramProfile {
  const first = posts[0] as Record<string, unknown> | undefined;
  const fallbackUrl = `https://www.instagram.com/${handle}/`;
  return {
    handle: str(first?.ownerUsername) ?? str(first?.username) ?? handle,
    profile_url: fallbackUrl,
    full_name: str(first?.ownerFullName) ?? str(first?.fullName),
    biography: str(first?.ownerBiography) ?? str(first?.biography),
    website: str(first?.ownerExternalUrl) ?? str(first?.externalUrl),
    followers_count: num(first?.ownerFollowersCount) ?? num(first?.followersCount),
    following_count: num(first?.ownerFollowsCount) ?? num(first?.followsCount),
    posts_count: num(first?.ownerPostsCount) ?? num(first?.postsCount),
    avatar_url: str(first?.ownerProfilePicUrl) ?? str(first?.profilePicUrl),
    raw: first ?? null,
  };
}

export async function fetchInstagramFeed(
  handle: string,
  opts: { maxItems?: number } = {},
): Promise<{ profile: RawInstagramProfile; posts: RawInstagramPost[] }> {
  const maxItems = opts.maxItems ?? 50;
  const runId = await startRun(ACTOR_PROFILE, {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: "posts",
    resultsLimit: maxItems,
    addParentData: true,
  });
  const datasetId = await pollRun(runId);
  const posts = await fetchDataset(datasetId);
  return { profile: profileFromFirstPost(handle, posts), posts };
}

// ─── Discovery: hashtags, búsqueda y hidratación de autores ──────────────────

/**
 * Trae posts de un hashtag. `tag` va sin '#'.
 *
 * `resultsLimit` del actor es por hashtag, así que mapea 1:1 con el
 * `results_limit` de content_sources — que es la contención de créditos: la
 * búsqueda por hashtag cobra por resultado y sin tope escala rápido.
 *
 * Ojo: los items de hashtag suelen venir SIN ownerFollowersCount. El caller
 * tiene que hidratar los autores con fetchInstagramProfiles antes de calcular
 * cualquier engagement rate.
 */
export async function fetchInstagramHashtag(
  tag: string,
  opts: { maxItems?: number } = {},
): Promise<RawInstagramPost[]> {
  const clean = tag.replace(/^#/, "").trim();
  if (!clean) return [];
  // Input verificado contra el schema del build: hashtags (requerido),
  // resultsType, resultsLimit. No acepta addParentData como el de perfil.
  const runId = await startRun(ACTOR_HASHTAG, {
    hashtags: [clean],
    resultsType: "posts",
    resultsLimit: opts.maxItems ?? 30,
  });
  const datasetId = await pollRun(runId, HASHTAG_POLL_TIMEOUT_MS);
  return fetchDataset(datasetId);
}

/**
 * Hidrata N perfiles en un solo run (mucho más barato que uno por cuenta).
 * Se usa para completar followers_count de las cuentas que aparecen en
 * discovery y todavía no conocemos.
 */
export async function fetchInstagramProfiles(
  handles: string[],
): Promise<RawInstagramProfile[]> {
  const clean = [...new Set(handles.map((h) => h.replace(/^@/, "").trim()).filter(Boolean))];
  if (!clean.length) return [];

  const runId = await startRun(ACTOR_PROFILE, {
    directUrls: clean.map((h) => `https://www.instagram.com/${h}/`),
    resultsType: "details",
    resultsLimit: 1,
    addParentData: false,
  });
  const datasetId = await pollRun(runId);
  const items = await fetchDataset<Record<string, unknown>>(datasetId);

  return items.map((item) => {
    const handle = str(item.username) ?? str(item.ownerUsername) ?? "";
    return {
      handle,
      profile_url: handle ? `https://www.instagram.com/${handle}/` : null,
      full_name: str(item.fullName) ?? str(item.ownerFullName),
      biography: str(item.biography) ?? str(item.ownerBiography),
      website: str(item.externalUrl) ?? str(item.ownerExternalUrl),
      followers_count: num(item.followersCount) ?? num(item.ownerFollowersCount),
      following_count: num(item.followsCount) ?? num(item.ownerFollowsCount),
      posts_count: num(item.postsCount) ?? num(item.ownerPostsCount),
      avatar_url: str(item.profilePicUrlHD) ?? str(item.profilePicUrl) ?? str(item.ownerProfilePicUrl),
      raw: item,
    } satisfies RawInstagramProfile;
  }).filter((p) => p.handle);
}

export type InstagramSearchSuggestion = {
  kind: "hashtag" | "user";
  value: string;
  label: string | null;
  followers: number | null;
  posts: number | null;
};

/**
 * Resuelve un término libre a hashtags y cuentas candidatas.
 *
 * Instagram no tiene búsqueda full-text de posts: no se puede scrapear
 * "clima laboral" directo. El flujo es en dos pasos — esto devuelve candidatos,
 * que quedan en content_sources como 'suggested' hasta que Content los aprueba.
 * Recién ahí consumen cupo de scraping.
 */
export async function searchInstagram(
  query: string,
  type: "hashtag" | "user",
  opts: { limit?: number } = {},
): Promise<InstagramSearchSuggestion[]> {
  const clean = query.trim();
  if (!clean) return [];

  const runId = await startRun(ACTOR_SEARCH, {
    search: clean,
    searchType: type,
    searchLimit: opts.limit ?? 10,
  });
  const datasetId = await pollRun(runId);
  const items = await fetchDataset<Record<string, unknown>>(datasetId);

  return items
    .map((item) => {
      const value =
        type === "hashtag"
          ? (str(item.name) ?? str(item.hashtag))?.replace(/^#/, "")
          : str(item.username);
      if (!value) return null;
      return {
        kind: type,
        value,
        label: str(item.fullName) ?? str(item.name),
        followers: num(item.followersCount),
        posts: num(item.postsCount) ?? num(item.mediaCount),
      } satisfies InstagramSearchSuggestion;
    })
    .filter((x): x is InstagramSearchSuggestion => x !== null);
}
