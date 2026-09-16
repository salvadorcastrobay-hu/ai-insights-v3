/**
 * Conector de LinkedIn orgánico vía los actores harvestapi de Apify.
 *
 * Por qué LinkedIn y no solo Instagram: la audiencia B2B de RRHH vive acá. De
 * 17 referentes del rubro relevados, 12 no tienen Instagram con volumen (Jordi
 * Alemany: 291.000 en LinkedIn contra 30 en Instagram). Y, a diferencia del
 * hashtag scraper de Instagram —que devuelve lo más reciente, sin engagement—
 * la búsqueda de LinkedIn ordena por RELEVANCIA y trae likes, comentarios y
 * shares reales. Medido el 2026-09-14: USD 0,00005 por corrida.
 *
 * Limitación medida: el objeto author NO trae followersCount en ninguno de los
 * dos actores. Por eso en LinkedIn no hay engagement rate ni percentil de
 * cohorte, y el ranking se apoya en el outlier contra la mediana del propio
 * autor — que es la capa que más importa igual.
 *
 * Requisito: APIFY_API_KEY.
 */

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_PROFILE_POSTS = "harvestapi~linkedin-profile-posts";
const ACTOR_POST_SEARCH = "harvestapi~linkedin-post-search";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 420_000; // 7 min

export type LinkedInReaction = { type: string; count: number };

export type RawLinkedInPost = {
  id?: string | null;
  entityId?: string | null;
  shareUrn?: string | null;
  linkedinUrl?: string | null;
  content?: string | null;
  type?: string | null;
  postedAt?: { timestamp?: number; date?: string } | string | null;
  engagement?: {
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    reactions?: LinkedInReaction[] | null;
  } | null;
  author?: {
    name?: string | null;
    info?: string | null;
    linkedinUrl?: string | null;
    publicIdentifier?: string | null;
    universalName?: string | null;
    urn?: string | null;
    avatar?: unknown;
    type?: string | null; // "user" | "company"
  } | null;
  postImages?: Array<{ url?: string | null }> | null;
  /** Presente cuando el post es un repost de otro. */
  repost?: unknown;
  repostId?: string | null;
};

function apiKey(): string {
  const k = process.env.APIFY_API_KEY;
  if (!k) throw new Error("Falta APIFY_API_KEY en el entorno.");
  return k;
}

async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${APIFY_BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey()}`,
      ...opts?.headers,
    },
  });
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

async function pollRun(runId: string, timeoutMs = POLL_TIMEOUT_MS): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await apiFetch(`/actor-runs/${runId}`);
    if (!res.ok) continue;
    const json = (await res.json()) as {
      data?: { status?: string; defaultDatasetId?: string };
    };
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

async function fetchDataset(datasetId: string): Promise<RawLinkedInPost[]> {
  const res = await apiFetch(`/datasets/${datasetId}/items?format=json&clean=true`);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Dataset fetch failed (${res.status}): ${text}`);
  }
  return ((await res.json()) ?? []) as RawLinkedInPost[];
}

/** Acepta un handle suelto o una URL y devuelve siempre la URL de perfil. */
export function linkedInProfileUrl(value: string): string {
  const clean = value.trim().replace(/^@/, "");
  if (/^https?:\/\//i.test(clean)) return clean.split("?")[0];
  const path = clean.replace(/^(in|company)\//, "");
  // Los perfiles de empresa se distinguen por prefijo explícito en el value.
  return clean.startsWith("company/")
    ? `https://www.linkedin.com/company/${path}/`
    : `https://www.linkedin.com/in/${path}/`;
}

export type LinkedInFetchOpts = {
  maxPosts?: number;
  /** Ventana temporal. 3 meses da margen para tener mediana por autor. */
  postedLimit?: "any" | "24h" | "week" | "month" | "3months";
  /**
   * Los reposts inflan el conteo del autor con engagement que no es suyo y
   * ensucian la mediana que usa el ranking. Por defecto quedan afuera.
   */
  includeReposts?: boolean;
};

/** Posts de uno o varios perfiles. Un solo run cubre N perfiles. */
export async function fetchLinkedInProfilePosts(
  values: string[],
  opts: LinkedInFetchOpts = {},
): Promise<RawLinkedInPost[]> {
  const targetUrls = [...new Set(values.map(linkedInProfileUrl))];
  if (!targetUrls.length) return [];

  const runId = await startRun(ACTOR_PROFILE_POSTS, {
    targetUrls,
    maxPosts: opts.maxPosts ?? 30,
    postedLimit: opts.postedLimit ?? "3months",
    includeReposts: opts.includeReposts ?? false,
    includeQuotePosts: false,
    scrapeReactions: false,
    scrapeComments: false,
  });
  return fetchDataset(await pollRun(runId));
}

/**
 * Palabras del headline que identifican a alguien de RRHH.
 *
 * Es el filtro que hace usable la búsqueda por tema: sin esto, "comunicación
 * interna" devuelve traductores, coaches y managers de e-commerce.
 *
 * FORMATO, medido contra la API el 2026-09-15 — no es obvio y rompe en silencio:
 *   - lista separada por comas -> 0 resultados. El actor la toma como UNA frase.
 *   - "OR" explícito entre términos -> funciona.
 *   - un acrónimo suelto ("RRHH") -> 0 resultados; dentro de un OR sí matchea.
 * O sea: términos de dos o más palabras, unidos con OR.
 *
 * Va sobre el headline (el rol autodeclarado) y NO sobre la industria del
 * perfil: la industria se hereda de la empresa, así que la directora de RRHH de
 * un banco figura como "Banking". Filtrar por industria dejaría afuera
 * justamente a la audiencia in-house y dejaría adentro la burbuja de
 * consultoras y vendors de HR-tech, que son nuestros competidores.
 */
const HR_AUTHOR_KEYWORDS: Record<string, string> = {
  "pt-BR": "Recursos Humanos OR Gestão de Pessoas OR Gente e Gestão OR Cultura Organizacional",
  "es-AR": "Recursos Humanos OR RRHH OR Gestión de Personas OR Capital Humano OR Cultura Organizacional",
  "es-ES": "Recursos Humanos OR RRHH OR Gestión de Personas OR Capital Humano OR Cultura Organizacional",
  "en-US": "Human Resources OR People Operations OR Employee Experience OR Talent Acquisition",
};

export function hrAuthorKeywords(language: string | null | undefined): string {
  if (!language) return HR_AUTHOR_KEYWORDS["es-AR"];
  return (
    HR_AUTHOR_KEYWORDS[language] ??
    HR_AUTHOR_KEYWORDS[language.startsWith("pt") ? "pt-BR" : "es-AR"]
  );
}

/** Léxico para el post-filtro local del headline. Barato y sin gastar créditos. */
const HR_HEADLINE_LEXICON = [
  "rh", "recursos humanos", "gente e gestao", "gente e gestão", "gestao de pessoas",
  "gestão de pessoas", "dho", "talento", "talentos", "cultura", "rrhh", "people",
  "hrbp", "capital humano", "chro", "employee", "comunicacion interna",
  "comunicação interna", "endomarketing", "clima", "hr ",
];

/**
 * ¿El headline del autor es de alguien de RRHH?
 *
 * Red de seguridad sobre `authorKeywords`: como la búsqueda cuesta
 * USD 0,00001 por post, conviene pedir de más y filtrar duro acá — es
 * determinístico, testeable sin gastar créditos y ajustable sin volver a la API.
 */
export function looksLikeHrAuthor(headline: string | null | undefined): boolean {
  if (!headline) return false;
  const normalized = headline
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return HR_HEADLINE_LEXICON.some((term) =>
    normalized.includes(term.normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
  );
}

export type LinkedInSearchOpts = LinkedInFetchOpts & {
  /** 'relevance' es lo que hace útil a este canal: prioriza lo que funcionó. */
  sortBy?: "relevance" | "date";
  /** Acota el ruido: la búsqueda por tema sola trae devs y IT managers. */
  authorKeywords?: string;
  /** Si viene, se usa para derivar authorKeywords cuando no se pasa explícito. */
  language?: string | null;
  contentType?: "all" | "videos" | "images";
};

/**
 * Busca posts por tema, ordenados por relevancia.
 *
 * Es la diferencia grande con Instagram: acá la búsqueda devuelve engagement
 * real, así que los resultados se rankean directo en vez de servir solo para
 * descubrir cuentas.
 */
export async function searchLinkedInPosts(
  query: string,
  opts: LinkedInSearchOpts = {},
): Promise<RawLinkedInPost[]> {
  const clean = query.trim();
  if (!clean) return [];

  const runId = await startRun(ACTOR_POST_SEARCH, {
    searchQueries: [clean],
    maxPosts: opts.maxPosts ?? 25,
    sortBy: opts.sortBy ?? "relevance",
    // Relevancia SIN ventana devuelve evergreen de hace dos años: no dice qué
    // está funcionando ahora, y el decay lo hundiría después de haberlo pagado.
    postedLimit: opts.postedLimit ?? "month",
    profileScraperMode: "short",
    authorKeywords: opts.authorKeywords ?? hrAuthorKeywords(opts.language),
    ...(opts.contentType ? { contentType: opts.contentType } : {}),
  });
  const posts = await fetchDataset(await pollRun(runId));
  // Post-filtro local: la red de seguridad sobre authorKeywords.
  return posts.filter((p) => looksLikeHrAuthor(p.author?.info));
}
