/**
 * Lo que se puede CONTAR de un post sin preguntarle a nadie.
 *
 * Todo esto estaba en el `raw` del scraper o en el caption, y no se usaba. Es
 * lo que un copywriter mira cuando copia un post que funcionó —cuánto mide la
 * primera línea, cuántos saltos tiene, si lleva link, cuántas placas tiene el
 * carrusel— y el clasificador no lo veía porque solo leía el texto.
 *
 * Determinístico a propósito: pedirle al modelo que cuente emojis o párrafos es
 * invitarlo a equivocarse, y acá se puede testear sin gastar un token.
 *
 * Tres cosas de acá corrigen el ranking y no solo lo describen:
 *
 * - `format_detail`: en LinkedIn `format` era "image" o "text" y nada más. El
 *   raw trae postVideo, document (carrusel PDF), article, poll y newsletter:
 *   153 de 621 posts estaban mal etiquetados, así que cualquier corte por
 *   formato en LinkedIn era ruido.
 * - `is_collab`: un collab de Instagram se publica en dos perfiles y suma la
 *   audiencia de los dos. Su engagement no mide el contenido sino la
 *   distribución, e inflaba el outlier del 15% de los posts de Instagram.
 * - `comment_bait`: "comentá GUIA y te la mando" junta comentarios por pedido,
 *   no por fricción. `debate_factor` lo leía como debate: un post así llegaba
 *   a "3,5× discutido".
 */

export const FORMAT_DETAILS = [
  "texto",
  "imagen",
  "multi_imagen",
  "carrusel",
  "video",
  "reel",
  "articulo_link",
  "newsletter",
  "encuesta",
] as const;
export type FormatDetail = (typeof FORMAT_DETAILS)[number];

/** Franjas anchas a propósito: ver `localTime`. */
export const DAYPARTS = ["madrugada", "manana", "tarde", "noche"] as const;
export type Daypart = (typeof DAYPARTS)[number];

export const WEEKDAYS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const VIDEO_LENGTHS = ["<15s", "15-30s", "30-60s", "1-3min", ">3min"] as const;
export type VideoLength = (typeof VIDEO_LENGTHS)[number];

export const SLIDE_BUCKETS = ["1", "2-4", "5-7", "8-10", "11+"] as const;
export type SlideBucket = (typeof SLIDE_BUCKETS)[number];

export type PostFeatures = {
  format_detail: FormatDetail;
  /** Placas de un carrusel o fotos de un multi-imagen. null si no aplica. */
  slide_count: number | null;
  slide_bucket: SlideBucket | null;
  video_length: VideoLength | null;
  /** Lo que se ve antes del "ver más". Es el hook real, no el que dice el modelo. */
  first_line: string | null;
  first_line_chars: number | null;
  /** Bloques separados por línea en blanco. El "aire" del post. */
  paragraphs: number;
  emoji_count: number;
  has_external_link: boolean;
  mention_count: number;
  ends_with_question: boolean;
  /** Collab de Instagram: publicado en más de un perfil a la vez. */
  is_collab: boolean;
  /** Pide comentar una palabra a cambio de algo. Infla comentarios. */
  comment_bait: boolean;
  /** Reel con audio propio o con un tema licenciado. null si no es video de IG. */
  audio: "original" | "musica" | null;
  /** Persona o página de empresa. Humand publica como empresa. */
  author_type: "persona" | "empresa" | null;
  is_sponsored: boolean;
  weekday: Weekday | null;
  daypart: Daypart | null;
  /**
   * LinkedIn: qué parte de las reacciones NO fue el like por defecto. Elegir
   * "interesante" o "me encanta" cuesta un gesto más que el like, así que mide
   * intensidad, no volumen.
   */
  non_like_share: number | null;
  /** Idioma del texto, por palabras frecuentes. null si es muy corto o no se distingue. */
  language: Language | null;

  // ── Auditoría de content (oct-2026) ──────────────────────────────────────
  // Todo lo de abajo es determinístico: se calcula del caption, la metadata y
  // el raw del scraper, sin pasar por ningún modelo. Ver el comentario de cada
  // función para el porqué de cada variable.

  /** Personas mencionadas. En LinkedIn sale de `contentAttributes`, no del texto. */
  person_mentions: number;
  /** Empresas mencionadas (LinkedIn). Mencionar una empresa suele ser colaboración. */
  company_mentions: number;
  /** Alcance prestado: el engagement viene de la distribución, no del contenido. */
  distribution_boost: DistributionBoost;
  /** Persona gramatical dominante: el primer driver de LinkedIn. */
  narrative_voice: NarrativeVoice | null;
  /** Líneas con viñeta, número o emoji-viñeta. */
  list_lines: number;
  has_list: boolean;
  /** Caracteres promedio por línea: lo corto con salto de línea retiene en el móvil. */
  avg_line_chars: number | null;
  /** Qué parte de los párrafos es de una sola línea. */
  single_line_paragraph_share: number | null;
  first_line_has_number: boolean;
  first_line_is_question: boolean;
  first_line_words: number | null;
  /** Dónde está el link. LinkedIn castiga el link en el texto. */
  link_placement: LinkPlacement;
  aspect_ratio: AspectRatio | null;
  question_count: number;
  sponsored_signal: SponsoredSignal;
  /** Si nombra un producto del rubro: hablar del producto propio rinde distinto que del problema. */
  brand_mention: BrandMention;
  /** Artículo nativo de LinkedIn contra link que saca de la plataforma. */
  article_type: ArticleType | null;
  /** Reacción no-like que predomina. Es resultado, no driver: valida la emoción. */
  dominant_reaction: string | null;
  /** El idioma del post no es el del mercado. Higiene. */
  language_mismatch: boolean | null;
  comments_disabled: boolean;
  is_repost: RepostKind;
  /** Antes lo decidía el LLM; se cuenta en código. */
  hashtag_strategy: HashtagStrategy;
  /** Reels de Instagram: likes por reproducción, mejor que likes solos. */
  likes_per_play: number | null;
  plays_per_follower: number | null;
};

export const DISTRIBUTION_BOOSTS = ["ninguno", "etiquetas", "menciones", "collab", "varios"] as const;
export type DistributionBoost = (typeof DISTRIBUTION_BOOSTS)[number];

export const NARRATIVE_VOICES = ["yo", "nosotros", "vos_usted", "impersonal"] as const;
export type NarrativeVoice = (typeof NARRATIVE_VOICES)[number];

export const LINK_PLACEMENTS = [
  "ninguno",
  "en_texto",
  "en_comentarios",
  "en_bio",
  "preview_articulo",
] as const;
export type LinkPlacement = (typeof LINK_PLACEMENTS)[number];

export const ASPECT_RATIOS = ["vertical_9_16", "vertical_4_5", "cuadrado", "horizontal"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const SPONSORED_SIGNALS = ["ninguna", "utm_influencer", "hashtag_publi", "paid_partnership"] as const;
export type SponsoredSignal = (typeof SPONSORED_SIGNALS)[number];

export const BRAND_MENTIONS = ["ninguno", "propio", "competidor", "tercero"] as const;
export type BrandMention = (typeof BRAND_MENTIONS)[number];

export const ARTICLE_TYPES = ["articulo_nativo_li", "newsletter", "link_externo", "youtube"] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const REPOST_KINDS = ["original", "repost_con_texto", "repost_puro"] as const;
export type RepostKind = (typeof REPOST_KINDS)[number];

export const HASHTAG_STRATEGIES = [
  "ninguno",
  "pocos_genericos",
  "muchos_genericos",
  "de_nicho",
  "mixto",
] as const;
export type HashtagStrategy = (typeof HASHTAG_STRATEGIES)[number];

export type FeaturablePost = {
  platform: string;
  caption: string | null;
  format: string | null;
  media: { images: string[]; videos: string[] } | null;
  posted_at: string | null;
  duration_secs: number | null;
  is_paid_partnership?: boolean | null;
  mentions?: string[] | null;
  reactions?: unknown;
  raw: unknown;
  hashtags?: string[] | null;
  likes_count?: number | null;
  author_followers_at_fetch?: number | null;
};

// ─── Formato ─────────────────────────────────────────────────────────────────

type LinkedInRawShape = {
  postVideo?: unknown;
  document?: unknown;
  article?: unknown;
  poll?: unknown;
  newsletterTitle?: unknown;
  newsletterUrl?: unknown;
  postImages?: unknown[] | null;
  author?: { type?: string | null } | null;
};

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

/**
 * El formato de LinkedIn, leído de lo que trae el raw.
 *
 * El orden importa: un post con video trae además la portada en postImages, y
 * un newsletter trae además un `article` con el link a la edición.
 */
export function linkedInFormat(raw: unknown): "video" | "document" | "poll" | "newsletter" | "article" | "image" | "text" {
  const r = (raw ?? {}) as LinkedInRawShape;
  if (present(r.postVideo)) return "video";
  if (present(r.document)) return "document";
  if (present(r.poll)) return "poll";
  if (present(r.newsletterTitle) || present(r.newsletterUrl)) return "newsletter";
  if (present(r.article)) return "article";
  if (Array.isArray(r.postImages) && r.postImages.length) return "image";
  return "text";
}

type InstagramRawShape = {
  productType?: string | null;
  coauthorProducers?: unknown[] | null;
  musicInfo?: { uses_original_audio?: boolean | null } | null;
  paidPartnership?: boolean | null;
  isPaidPartnership?: boolean | null;
  childPosts?: unknown[] | null;
};

function formatDetail(post: FeaturablePost): FormatDetail {
  if (post.platform === "linkedin") {
    const images = post.media?.images?.length ?? 0;
    switch (linkedInFormat(post.raw)) {
      case "video":
        return "video";
      case "document":
        return "carrusel";
      case "poll":
        return "encuesta";
      case "newsletter":
        return "newsletter";
      case "article":
        return "articulo_link";
      case "image":
        return images > 1 ? "multi_imagen" : "imagen";
      default:
        return "texto";
    }
  }

  const raw = (post.raw ?? {}) as InstagramRawShape;
  // productType distingue el reel ("clips") del video de feed, que el `type`
  // del scraper llama igual "Video".
  if (raw.productType === "clips" || post.format === "reel") return "reel";
  if (post.format === "video") return "video";
  if (post.format === "sidecar") return "carrusel";
  return "imagen";
}

/**
 * Placas de un carrusel.
 *
 * Decía que en LinkedIn el PDF no expone páginas y devolvía null para todos los
 * carruseles de esa red. Las expone, en `document.totalPageCount`: los 17
 * carruseles de LinkedIn del corpus lo traían y ninguno tenía slide_count.
 */
function slideCount(post: FeaturablePost, detail: FormatDetail): number | null {
  if (detail === "multi_imagen") return post.media?.images?.length ?? null;
  if (detail === "carrusel" && post.platform === "linkedin") return linkedInPageCount(post.raw);
  if (detail !== "carrusel" || post.platform !== "instagram") return null;
  const raw = (post.raw ?? {}) as InstagramRawShape;
  const children = Array.isArray(raw.childPosts) ? raw.childPosts.length : 0;
  return Math.max(children, post.media?.images?.length ?? 0) || null;
}

export function slideBucket(count: number | null): SlideBucket | null {
  if (!count || count < 1) return null;
  if (count === 1) return "1";
  if (count <= 4) return "2-4";
  if (count <= 7) return "5-7";
  if (count <= 10) return "8-10";
  return "11+";
}

export function videoLength(seconds: number | null | undefined): VideoLength | null {
  if (!seconds || !(seconds > 0)) return null;
  if (seconds < 15) return "<15s";
  if (seconds < 30) return "15-30s";
  if (seconds < 60) return "30-60s";
  if (seconds <= 180) return "1-3min";
  return ">3min";
}

// ─── Copy ────────────────────────────────────────────────────────────────────

/**
 * La primera línea con texto. En LinkedIn e Instagram es lo que se ve antes
 * del "ver más", o sea el hook de verdad.
 */
export function firstLine(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const line = caption
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? null;
}

// Extended_Pictographic cubre los emojis sin agarrar dígitos ni '#', que
// técnicamente también son "Emoji" en Unicode.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const LINK_RE = /\bhttps?:\/\/\S+|\blnkd\.in\/\S+|\bbit\.ly\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/gi;
const MENTION_RE = /(^|\s)@[\p{L}\p{N}_.]{2,}/gu;

export function countEmojis(text: string): number {
  return text.match(EMOJI_RE)?.length ?? 0;
}

export function hasExternalLink(text: string): boolean {
  LINK_RE.lastIndex = 0;
  return LINK_RE.test(text);
}

export function countParagraphs(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

/**
 * ¿Termina pidiendo que le respondan? Se mira el último bloque sin hashtags:
 * el post que cierra con "¿y ustedes?" seguido de diez hashtags termina en
 * pregunta igual.
 */
export function endsWithQuestion(text: string): boolean {
  const withoutTags = text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ").trim();
  const blocks = withoutTags.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const last = blocks[blocks.length - 1] ?? "";
  // Un emoji o una flecha al final no cambian que la última oración pregunte.
  return /\?[\s\p{Extended_Pictographic}\p{P}]*$/u.test(last);
}

/**
 * "Comentá GUIA y te la mando", "Comente PIPELINE que eu envio".
 *
 * Dos señales, cualquiera alcanza: pedir que comenten una PALABRA (en
 * mayúsculas o entre comillas), o pedir que comenten a cambio de algo que se
 * manda. Se probó contra el corpus: "dejar de decir 'sí, pero'" no es un
 * pedido, así que el verbo tiene que estar en imperativo y al principio de la
 * frase o después de un corte.
 */
// La inicial va en las dos cajas a mano: KEYWORD_ASK no puede llevar la flag
// `i`, porque lo que distingue "comentá GUIA" de "comentá que te parece" es
// justamente que la palabra pedida viene en mayúsculas.
const COMMENT_VERB =
  "(?:[Cc]omenta|[Cc]omente|[Cc]omentá|[Cc]omentame|[Cc]omment|[Ee]scrib[ea]|[Ee]scribí|[Ee]screva|[Dd]ej[aá]|[Dd]eixe|[Dd]igit[ae])";
const KEYWORD_ASK = new RegExp(
  `(?:^|[\\n.!?👇]\\s*|\\s)${COMMENT_VERB}\\s+(?:aqu[ií]\\s+|abajo\\s+|below\\s+)?(?:la palabra\\s+|a palavra\\s+)?(?:["“«][\\p{L}\\p{N}]{2,}["”»]|[A-ZÁÉÍÓÚÃÕÇ0-9]{2,}(?=[\\s,.!:]|$))`,
  "u",
);
const REWARD_ASK = new RegExp(
  `(?:^|[\\n.!?👇]\\s*|\\s)${COMMENT_VERB}\\b[^\\n]{0,60}?(?:te\\s+(?:lo\\s+|la\\s+)?(?:mando|envío|envio|paso|mandamos|enviamos)|te\\s+manda|eu\\s+(?:te\\s+)?(?:mando|envio)|a gente te manda|receb[ae]|recibir|recib[ií]s|por\\s+DM|na\\s+(?:sua\\s+)?DM|por\\s+privado|no\\s+privado)`,
  "iu",
);

export function isCommentBait(text: string | null | undefined): boolean {
  if (!text) return false;
  return KEYWORD_ASK.test(text) || REWARD_ASK.test(text);
}

const SPONSORED_RE = /(^|[\s*#])(publi|ad|publicidad|publicidade|parceria|patrocinado|sponsored|paid partnership)(?=\s|$|[.,!])/i;

// ─── Cuándo ──────────────────────────────────────────────────────────────────

/**
 * La hora del post en el huso del mercado.
 *
 * Hispam cubre de UTC-3 a UTC-6, así que no tiene un huso: se usa Bogotá, que
 * está en el medio, y el error queda en ±2h. Es la razón de que las franjas
 * sean de seis horas y no de una: con esta muestra y ese error, "publicá a las
 * 9:00" sería afirmar algo que el dato no sostiene.
 */
const MARKET_TZ: Record<string, string> = {
  br: "America/Sao_Paulo",
  es: "Europe/Madrid",
  hispam: "America/Bogota",
  mx: "America/Mexico_City",
  ar: "America/Argentina/Buenos_Aires",
};

export function localTime(
  postedAt: string | null | undefined,
  region: string | null | undefined,
): { weekday: Weekday; daypart: Daypart } | null {
  if (!postedAt) return null;
  const ts = Date.parse(postedAt);
  if (Number.isNaN(ts)) return null;
  const tz = region ? MARKET_TZ[region] : undefined;
  if (!tz) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  if (index < 0 || !Number.isFinite(hour)) return null;

  const daypart: Daypart =
    hour < 6 ? "madrugada" : hour < 12 ? "manana" : hour < 18 ? "tarde" : "noche";
  return { weekday: WEEKDAYS[index], daypart };
}

// ─── Reacciones ──────────────────────────────────────────────────────────────

/** Debajo de esto la proporción es ruido: 3 reacciones de 5 dan 60%. */
const MIN_REACTIONS_FOR_MIX = 30;

export function nonLikeShare(reactions: unknown): number | null {
  if (!Array.isArray(reactions)) return null;
  let total = 0;
  let like = 0;
  for (const r of reactions as Array<{ type?: string; count?: number }>) {
    const n = Number(r?.count ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    total += n;
    if (r?.type === "LIKE") like += n;
  }
  if (total < MIN_REACTIONS_FOR_MIX) return null;
  return Number(((total - like) / total).toFixed(3));
}

// ─── Idioma ──────────────────────────────────────────────────────────────────

export type Language = "pt" | "es" | "en";

/**
 * Palabras que casi solo aparecen en un idioma. Nada de "de", "que" o "a",
 * que comparten portugués y español: esas no distinguen nada.
 */
const LANGUAGE_MARKERS: Record<Language, string[]> = {
  pt: ["não", "você", "vocês", "são", "está", "também", "então", "muito", "isso", "uma", "pessoas", "trabalho", "equipe", "liderança", "gestão", "quando", "mais", "nós", "sobre", "ainda", "já", "às", "ao", "aos", "dos", "das", "pela", "pelo", "tem", "fazer", "é"],
  es: ["no", "usted", "ustedes", "son", "también", "entonces", "mucho", "eso", "una", "personas", "trabajo", "equipo", "liderazgo", "gestión", "cuando", "más", "nosotros", "sobre", "todavía", "ya", "los", "las", "del", "por", "tiene", "hacer", "es", "el", "y", "hay", "pero", "muy"],
  en: ["the", "and", "you", "your", "is", "are", "not", "with", "this", "that", "people", "work", "team", "leadership", "when", "more", "we", "about", "have", "it's", "don't"],
};

/**
 * Idioma del post. Se le pasa explícito al clasificador: con la instrucción
 * general "respondé en español, salvo el claim", el modelo escribía en español
 * el claim de 99 de ~260 posts en portugués.
 */
export function detectLanguage(text: string | null | undefined): Language | null {
  if (!text) return null;
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 5) return null;
  const score: Record<Language, number> = { pt: 0, es: 0, en: 0 };
  const sets = Object.fromEntries(
    Object.entries(LANGUAGE_MARKERS).map(([k, v]) => [k, new Set(v)]),
  ) as Record<Language, Set<string>>;
  for (const w of words) {
    for (const lang of ["pt", "es", "en"] as Language[]) if (sets[lang].has(w)) score[lang] += 1;
  }
  const ranked = (Object.entries(score) as Array<[Language, number]>).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  // Empate o casi: no se afirma nada.
  if (best[1] < 2 || best[1] < second[1] * 1.3) return null;
  return best[0];
}

// ─── Auditoría de content: extractores determinísticos ───────────────────────

type ContentAttribute = { type?: string | null };
type LinkedInExtras = {
  contentAttributes?: ContentAttribute[] | null;
  header?: { text?: string | null } | null;
  article?: { link?: string | null; subtitle?: string | null } | null;
  repost?: unknown;
  document?: { totalPageCount?: number | null } | null;
  postImages?: Array<{ width?: number | null; height?: number | null }> | null;
};
type InstagramExtras = {
  taggedUsers?: unknown[] | null;
  coauthorProducers?: unknown[] | null;
  dimensionsWidth?: number | null;
  dimensionsHeight?: number | null;
  isCommentsDisabled?: boolean | null;
  videoPlayCount?: number | null;
  videoViewCount?: number | null;
};

/**
 * Menciones de LinkedIn.
 *
 * El comentario viejo decía que en LinkedIn "es honesto que dé cero" porque las
 * menciones vienen como nombres y no como @handle. Era falso: el scraper las
 * trae marcadas en `contentAttributes`, como PROFILE_MENTION (personas) y
 * COMPANY_NAME (empresas). Medido: 158 posts daban cero menciones teniéndolas.
 */
export function linkedInMentions(raw: unknown): { persons: number; companies: number } {
  const attrs = ((raw ?? {}) as LinkedInExtras).contentAttributes;
  if (!Array.isArray(attrs)) return { persons: 0, companies: 0 };
  let persons = 0;
  let companies = 0;
  for (const a of attrs) {
    if (a?.type === "PROFILE_MENTION") persons += 1;
    else if (a?.type === "COMPANY_NAME") companies += 1;
  }
  return { persons, companies };
}

/**
 * Páginas del carrusel PDF de LinkedIn.
 *
 * El documento es el formato de mayor tiempo de lectura de LinkedIn y su largo
 * importa. `slideCount` devolvía null para todos porque asumía que el PDF no
 * expone páginas: lo expone, en `document.totalPageCount`.
 */
export function linkedInPageCount(raw: unknown): number | null {
  const n = ((raw ?? {}) as LinkedInExtras).document?.totalPageCount;
  return typeof n === "number" && n > 0 ? n : null;
}

/**
 * Alcance prestado.
 *
 * Etiquetar, mencionar o publicar en collab mete el post en la red de otro. El
 * engagement que sale de ahí es de distribución, no del contenido, y mezclarlo
 * en la síntesis es el mismo problema que ya se resolvió con `is_collab`.
 */
export function distributionBoost(
  platform: string,
  raw: unknown,
  mentions: number,
): DistributionBoost {
  const signals: DistributionBoost[] = [];
  if (platform === "instagram") {
    const r = (raw ?? {}) as InstagramExtras;
    if (Array.isArray(r.taggedUsers) && r.taggedUsers.length) signals.push("etiquetas");
    if (Array.isArray(r.coauthorProducers) && r.coauthorProducers.length) signals.push("collab");
  } else {
    const header = ((raw ?? {}) as LinkedInExtras).header?.text ?? "";
    if (/collaborat|colabor/i.test(header)) signals.push("collab");
  }
  if (mentions > 0) signals.push("menciones");
  if (!signals.length) return "ninguno";
  return signals.length === 1 ? signals[0] : "varios";
}

/*
 * Pronombres y posesivos por persona gramatical, en los tres idiomas del corpus.
 * Se cuentan palabras sueltas y no conjugaciones: la conjugación necesitaría un
 * analizador morfológico, y los pronombres alcanzan para decidir la voz
 * dominante de un post.
 */
const VOICE_WORDS: Record<Exclude<NarrativeVoice, "impersonal">, string[]> = {
  yo: [
    "yo", "mí", "mi", "mis", "conmigo", "eu", "meu", "minha", "meus", "minhas", "comigo",
    "i", "my", "mine", "me",
    // El español y el portugués omiten el pronombre: "aprendí que…", no "yo
    // aprendí". Contando solo pronombres, la primera persona salía en 16% de
    // LinkedIn cuando a ojo es bastante más. Estas son las formas verbales de
    // primera persona más frecuentes en posts de opinión y de experiencia.
    "soy", "estoy", "tengo", "creo", "pienso", "siento", "quiero", "puedo",
    "aprendí", "pensé", "trabajé", "empecé", "decidí", "estuve", "tuve", "hice",
    "dije", "llegué", "viví", "conocí", "comparto", "recuerdo", "confieso", "admito",
    "sou", "estou", "tenho", "acho", "penso", "sinto", "quero", "posso",
    "aprendi", "pensei", "trabalhei", "comecei", "estive", "tive", "fiz",
    "disse", "cheguei", "vivi", "conheci", "compartilho", "lembro", "confesso", "buscava",
  ],
  nosotros: [
    "nosotros", "nosotras", "nuestro", "nuestra", "nuestros", "nuestras", "nos",
    "nós", "nosso", "nossa", "nossos", "nossas",
    "we", "us", "our", "ours",
    // Mismo motivo: "estamos", "tuvimos", "lanzamos" no llevan pronombre.
    "somos", "estamos", "tenemos", "creemos", "hicimos", "aprendimos", "lanzamos",
    "vivimos", "tuvimos", "fuimos", "queremos", "podemos", "trabajamos", "compartimos",
    "temos", "acreditamos", "fizemos", "aprendemos", "lançamos", "vivemos",
    "tivemos", "fomos", "trabalhamos", "compartilhamos",
  ],
  vos_usted: [
    "tú", "tu", "tus", "ti", "contigo", "vos", "usted", "ustedes", "te",
    "você", "vocês", "teu", "tua", "teus", "tuas",
    "you", "your", "yours",
  ],
};

/**
 * Persona gramatical dominante.
 *
 * El primer driver de LinkedIn: el post en primera persona del singular rinde
 * distinto que la voz corporativa. Se devuelve `impersonal` si ninguna persona
 * junta al menos dos apariciones — con una sola no se puede afirmar una voz.
 */
export function narrativeVoice(text: string): NarrativeVoice | null {
  if (!text.trim()) return null;
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (words.length < 8) return null;
  const counts: Record<string, number> = { yo: 0, nosotros: 0, vos_usted: 0 };
  const lookup = new Map<string, string>();
  for (const [voice, list] of Object.entries(VOICE_WORDS)) {
    for (const w of list) lookup.set(w, voice);
  }
  for (const w of words) {
    const voice = lookup.get(w);
    if (voice) counts[voice] += 1;
  }
  // "a gente" es la primera del plural del portugués coloquial y son dos
  // palabras, así que no entra por el diccionario.
  counts.nosotros += (text.toLowerCase().match(/\ba gente\b/g) ?? []).length;
  // Empates se resuelven en este orden: si el autor habla de sí mismo, esa es
  // la voz aunque también le hable al lector.
  const order: Array<Exclude<NarrativeVoice, "impersonal">> = ["yo", "nosotros", "vos_usted"];
  const best = order.reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return counts[best] >= 2 ? best : "impersonal";
}

const LIST_LINE_RE =
  /^\s*(?:[•·\-–—*▪►✓✔→]|\d{1,2}[.)º°]|[①-⑳]|\p{Extended_Pictographic})\s*\S/u;

/** Líneas que arrancan como ítem de lista. Lo escaneable se lee hasta el final. */
export function countListLines(text: string): number {
  return text.split(/\r?\n/).filter((l) => LIST_LINE_RE.test(l)).length;
}

/**
 * El "aire" del texto.
 *
 * El formato de frases cortas separadas por saltos de línea retiene en el móvil.
 * `paragraphs` ya contaba bloques; esto mide cómo están armados.
 */
export function lineRhythm(text: string): { avgLineChars: number | null; singleLineShare: number | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { avgLineChars: null, singleLineShare: null };
  const avg = lines.reduce((a, l) => a + l.length, 0) / lines.length;
  const blocks = text.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  const single = blocks.filter((b) => !/\r?\n/.test(b)).length;
  return {
    avgLineChars: Math.round(avg),
    singleLineShare: blocks.length ? Number((single / blocks.length).toFixed(2)) : null,
  };
}

/** Rasgos del hook medibles sin modelo: número, pregunta y largo. */
export function firstLineSignals(line: string | null): {
  hasNumber: boolean;
  isQuestion: boolean;
  words: number | null;
} {
  if (!line) return { hasNumber: false, isQuestion: false, words: null };
  return {
    hasNumber: /\d/.test(line),
    // "¿" cuenta: una apertura en negrita Unicode o cortada suele perder el "?".
    isQuestion: /[?¿]/.test(line),
    words: (line.match(/[\p{L}\p{N}]+/gu) ?? []).length,
  };
}

const LINK_IN_COMMENTS_RE =
  /(link|enlace|url)[^\n]{0,30}(comentario|comentarios|coment[aá]rios?|comments?)|(comentario|coment[aá]rio|comment)[^\n]{0,20}(link|enlace)|👇\s*(link|enlace)/i;
const LINK_IN_BIO_RE = /(link|enlace)[^\n]{0,15}\bbio\b/i;

/**
 * Dónde está el link.
 *
 * LinkedIn castiga el link externo en el cuerpo del post, y "link en
 * comentarios" o "link en la bio" es justamente la forma de esquivarlo. Tratar
 * los tres casos como "tiene link" —que es lo que hacía `has_external_link`—
 * mezclaba lo que el algoritmo penaliza con el truco para evitarlo.
 */
export function linkPlacement(platform: string, caption: string, raw: unknown): LinkPlacement {
  if (platform === "linkedin" && present(((raw ?? {}) as LinkedInExtras).article)) {
    return "preview_articulo";
  }
  if (hasExternalLink(caption)) return "en_texto";
  if (LINK_IN_COMMENTS_RE.test(caption)) return "en_comentarios";
  if (LINK_IN_BIO_RE.test(caption)) return "en_bio";
  return "ninguno";
}

/**
 * Proporción del creativo.
 *
 * 4:5 y 9:16 ocupan más pantalla en el feed del celular que el cuadrado y el
 * apaisado. En Instagram es decisivo.
 */
export function aspectRatio(platform: string, raw: unknown): AspectRatio | null {
  let w: number | null | undefined;
  let h: number | null | undefined;
  if (platform === "instagram") {
    const r = (raw ?? {}) as InstagramExtras;
    w = r.dimensionsWidth;
    h = r.dimensionsHeight;
  } else {
    const img = ((raw ?? {}) as LinkedInExtras).postImages?.[0];
    w = img?.width;
    h = img?.height;
  }
  if (!w || !h) return null;
  const ratio = h / w;
  if (ratio >= 1.6) return "vertical_9_16";
  if (ratio >= 1.15) return "vertical_4_5";
  if (ratio >= 0.9) return "cuadrado";
  return "horizontal";
}

/** Preguntas en todo el texto. Más preguntas al lector suele traer más comentarios. */
export function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

const UTM_INFLUENCER_RE = /utm_(medium|source|campaign)=[^&\s]*(influenc|creator|embajador|ambassador)/i;

/**
 * Pista de colaboración paga.
 *
 * El influencer pago rinde distinto y contamina la síntesis. Hay casos reales
 * con `utm_medium=influenciadores` en el link del artículo.
 */
export function sponsoredSignal(
  caption: string,
  raw: unknown,
  paidPartnership: boolean | null | undefined,
): SponsoredSignal {
  if (paidPartnership) return "paid_partnership";
  const articleLink = ((raw ?? {}) as LinkedInExtras).article?.link ?? "";
  if (UTM_INFLUENCER_RE.test(caption) || UTM_INFLUENCER_RE.test(articleLink)) {
    return "utm_influencer";
  }
  if (SPONSORED_RE.test(caption)) return "hashtag_publi";
  return "ninguna";
}

/*
 * Competidores que se pueden detectar sin falsos positivos. Fuente: los de
 * `competitor_ads` y `content_sources` con kind=competitor_profile.
 *
 * Quedan AFUERA a propósito "Flash", "Senior" y "Dialog": son palabras comunes
 * ("senior developer", "diálogo") y detectarlas por texto daría más ruido que
 * señal. Es preferible no marcar una mención a marcar cien que no lo son.
 */
const COMPETITOR_RE = new RegExp(
  "(?<![\\p{L}])(beehome|buk|caju|crehana|gupy|mand[üu]\\s?hr|naaloo|peopleforce|rankmi|s[óo]lides)(?![\\p{L}])",
  "iu",
);
const FACTORIAL_RE = /(?<![\p{L}])Factorial(?![\p{L}])/u;
const OWN_BRAND_RE = /(?<![\p{L}])humand(?![\p{L}])/iu;

/**
 * Si el post nombra un producto del rubro.
 *
 * Hipótesis fuerte de practitioner: hablar del producto propio rinde menos que
 * hablar del problema que resuelve.
 */
export function brandMention(caption: string, companyMentions: number): BrandMention {
  if (OWN_BRAND_RE.test(caption)) return "propio";
  if (COMPETITOR_RE.test(caption) || FACTORIAL_RE.test(caption)) return "competidor";
  if (companyMentions > 0) return "tercero";
  return "ninguno";
}

/**
 * Tipo de artículo de LinkedIn.
 *
 * Hoy `articulo_link` mezclaba el artículo nativo —que no saca al usuario de la
 * plataforma— con el link a otra web, que sí. LinkedIn trata distinto a los dos.
 */
export function articleType(raw: unknown): ArticleType | null {
  const format = linkedInFormat(raw);
  if (format === "newsletter") return "newsletter";
  if (format !== "article") return null;
  const link = ((raw ?? {}) as LinkedInExtras).article?.link ?? "";
  if (/linkedin\.com\/pulse\//i.test(link)) return "articulo_nativo_li";
  if (/youtube\.com|youtu\.be/i.test(link)) return "youtube";
  return "link_externo";
}

const REACTION_NAMES: Record<string, string> = {
  EMPATHY: "empatia",
  PRAISE: "aplauso",
  INTEREST: "interes",
  ENTERTAINMENT: "diversion",
  APPRECIATION: "apoyo",
};

/**
 * Qué reacción, aparte del like, predominó.
 *
 * Es un resultado y no un driver: no explica por qué funcionó un post, pero
 * dice qué emoción tocó. Sirve para validar `emotional_trigger` contra lo que
 * la audiencia hizo de verdad.
 */
export function dominantReaction(reactions: unknown): string | null {
  if (!Array.isArray(reactions)) return null;
  let total = 0;
  let best: { type: string; count: number } | null = null;
  for (const r of reactions as Array<{ type?: string; count?: number }>) {
    const count = typeof r?.count === "number" ? r.count : 0;
    total += count;
    if (!r?.type || r.type === "LIKE") continue;
    if (!best || count > best.count) best = { type: r.type, count };
  }
  if (total < MIN_REACTIONS_FOR_MIX) return null;
  if (!best || best.count === 0) return "solo_like";
  return REACTION_NAMES[best.type] ?? best.type.toLowerCase();
}

const MARKET_LANGUAGE: Record<string, Language> = { br: "pt", es: "es", hispam: "es" };

/** El post no está en el idioma del mercado. Un post en español en Brasil rinde menos. */
export function languageMismatch(language: Language | null, region: string | null): boolean | null {
  if (!language || !region) return null;
  const expected = MARKET_LANGUAGE[region];
  return expected ? language !== expected : null;
}

/** Repost o post propio. El engagement de un repost puro es del original. */
export function repostKind(platform: string, caption: string, raw: unknown): RepostKind {
  if (platform !== "linkedin" || !present(((raw ?? {}) as LinkedInExtras).repost)) return "original";
  return caption.trim().length > 20 ? "repost_con_texto" : "repost_puro";
}

/*
 * Hashtags masivos del rubro: los que usa todo el mundo y no segmentan. La
 * lista no pretende ser completa; alcanza para distinguir "pongo los de
 * siempre" de "pongo los de mi nicho".
 */
const GENERIC_HASHTAGS = new Set([
  "rrhh", "recursoshumanos", "rh", "recursoshumanos", "hr", "humanresources",
  "liderazgo", "lideranca", "liderança", "leadership", "trabajo", "trabalho", "work",
  "empleo", "emprego", "talento", "talent", "motivacion", "motivação", "motivacao",
  "emprendimiento", "empreendedorismo", "business", "negocios", "marketing", "linkedin",
  "gestaodepessoas", "gestióndepersonas", "gestiondepersonas", "carreira", "carrera",
  "career", "management", "gestion", "gestão", "futurodeltrabajo", "futurodotrabalho",
  "futureofwork", "cultura", "culture", "innovacion", "inovação", "inovacao",
  "tecnologia", "technology", "ia", "ai",
]);

/**
 * La estrategia de hashtags, contada.
 *
 * Antes la decidía el LLM. Es un conteo con una lista de genéricos: no hace
 * falta un modelo, y sacarlo acorta la respuesta del clasificador, que es lo que
 * hacía volver los lotes incompletos.
 */
export function hashtagStrategy(caption: string, hashtags: string[] | null | undefined): HashtagStrategy {
  const fromText = (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.slice(1));
  const tags = [...new Set([...(hashtags ?? []), ...fromText].map((h) => h.toLowerCase().replace(/^#/, "")))];
  if (!tags.length) return "ninguno";
  const generic = tags.filter((t) => GENERIC_HASHTAGS.has(t)).length;
  if (generic === tags.length) return tags.length <= 3 ? "pocos_genericos" : "muchos_genericos";
  if (generic === 0) return "de_nicho";
  return generic / tags.length >= 0.7 && tags.length > 3 ? "muchos_genericos" : "mixto";
}

/** Reels: interacción por reproducción y alcance relativo al tamaño de la cuenta. */
export function reelMetrics(
  raw: unknown,
  likes: number | null | undefined,
  followers: number | null | undefined,
): { likesPerPlay: number | null; playsPerFollower: number | null } {
  const r = (raw ?? {}) as InstagramExtras;
  const plays = r.videoPlayCount ?? r.videoViewCount ?? null;
  if (!plays || plays <= 0) return { likesPerPlay: null, playsPerFollower: null };
  return {
    likesPerPlay: likes != null ? Number((likes / plays).toFixed(4)) : null,
    playsPerFollower: followers ? Number((plays / followers).toFixed(3)) : null,
  };
}

// ─── Texto de portada (sobre el OCR del análisis visual) ─────────────────────

export const COVER_BUCKETS = ["0", "1-8", "9-25", ">25"] as const;
export type CoverBucket = (typeof COVER_BUCKETS)[number];

export type CoverFeatures = {
  cover_word_count: number;
  cover_bucket: CoverBucket;
  cover_has_number: boolean;
  cover_is_question: boolean;
  cover_is_list_promise: boolean;
};

const LIST_PROMISE_RE =
  /(^|\n)\s*\d{1,2}\s+(errores|claves|tips|formas|maneras|cosas|pasos|razones|señales|ideas|preguntas|erros|dicas|maneiras|coisas|passos|motivos|sinais|perguntas|mistakes|ways|steps|reasons|signs)/i;

/**
 * Rasgos del texto escrito sobre la portada.
 *
 * El OCR ya se pagó en el análisis visual y no se explotaba. En el carrusel y el
 * reel, la portada ES el hook: un titular corto se lee mientras se scrollea y un
 * párrafo no. Todo esto sale gratis de ese texto.
 */
export function coverFeatures(visualText: string | null | undefined): CoverFeatures {
  const text = (visualText ?? "").trim();
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const bucket: CoverBucket = words === 0 ? "0" : words <= 8 ? "1-8" : words <= 25 ? "9-25" : ">25";
  return {
    cover_word_count: words,
    cover_bucket: bucket,
    cover_has_number: /\d/.test(text),
    cover_is_question: /\?/.test(text),
    cover_is_list_promise: LIST_PROMISE_RE.test(text),
  };
}

// ─── Todo junto ──────────────────────────────────────────────────────────────

export function computeFeatures(post: FeaturablePost, region: string | null): PostFeatures {
  const caption = post.caption ?? "";
  const detail = formatDetail(post);
  const slides = slideCount(post, detail);
  const line = firstLine(caption);
  const raw = (post.raw ?? {}) as InstagramRawShape & LinkedInRawShape;
  const when = localTime(post.posted_at, region);

  const isVideo = detail === "reel" || detail === "video";
  const music = raw.musicInfo;

  let authorType: PostFeatures["author_type"] = null;
  if (post.platform === "linkedin") {
    const t = raw.author?.type;
    authorType = t === "company" ? "empresa" : t ? "persona" : null;
  }

  // Las menciones de LinkedIn no vienen como @handle en el texto sino marcadas
  // en `contentAttributes`. El comentario anterior decía que daba cero "con
  // honestidad"; daba cero por no mirar donde estaban. En Instagram no se puede
  // distinguir persona de empresa, así que todas cuentan como personas.
  const textMentions = Math.max(post.mentions?.length ?? 0, caption.match(MENTION_RE)?.length ?? 0);
  const li = post.platform === "linkedin" ? linkedInMentions(post.raw) : { persons: 0, companies: 0 };
  const personMentions = post.platform === "linkedin" ? li.persons : textMentions;
  const companyMentions = li.companies;
  const mentionCount = Math.max(textMentions, personMentions + companyMentions);

  const language = detectLanguage(caption);
  const firstSignals = firstLineSignals(line);
  const rhythm = lineRhythm(caption);
  const listLines = countListLines(caption);
  const reel = post.platform === "instagram" && isVideo
    ? reelMetrics(post.raw, post.likes_count, post.author_followers_at_fetch)
    : { likesPerPlay: null, playsPerFollower: null };

  return {
    format_detail: detail,
    slide_count: slides,
    slide_bucket: slideBucket(slides),
    video_length: isVideo ? videoLength(post.duration_secs) : null,
    first_line: line,
    first_line_chars: line ? line.length : null,
    paragraphs: countParagraphs(caption),
    emoji_count: countEmojis(caption),
    has_external_link: hasExternalLink(caption),
    mention_count: mentionCount,
    ends_with_question: endsWithQuestion(caption),
    is_collab:
      post.platform === "instagram" &&
      Array.isArray(raw.coauthorProducers) &&
      raw.coauthorProducers.length > 0,
    comment_bait: isCommentBait(caption),
    audio:
      post.platform === "instagram" && isVideo && music && typeof music.uses_original_audio === "boolean"
        ? music.uses_original_audio
          ? "original"
          : "musica"
        : null,
    author_type: authorType,
    is_sponsored: Boolean(post.is_paid_partnership) || SPONSORED_RE.test(caption),
    weekday: when?.weekday ?? null,
    daypart: when?.daypart ?? null,
    non_like_share: post.platform === "linkedin" ? nonLikeShare(post.reactions) : null,
    language,

    person_mentions: personMentions,
    company_mentions: companyMentions,
    distribution_boost: distributionBoost(post.platform, post.raw, personMentions + companyMentions),
    narrative_voice: narrativeVoice(caption),
    list_lines: listLines,
    has_list: listLines >= 2,
    avg_line_chars: rhythm.avgLineChars,
    single_line_paragraph_share: rhythm.singleLineShare,
    first_line_has_number: firstSignals.hasNumber,
    first_line_is_question: firstSignals.isQuestion,
    first_line_words: firstSignals.words,
    link_placement: linkPlacement(post.platform, caption, post.raw),
    aspect_ratio: aspectRatio(post.platform, post.raw),
    question_count: countQuestions(caption),
    sponsored_signal: sponsoredSignal(caption, post.raw, post.is_paid_partnership),
    brand_mention: brandMention(caption, companyMentions),
    article_type: post.platform === "linkedin" ? articleType(post.raw) : null,
    dominant_reaction: post.platform === "linkedin" ? dominantReaction(post.reactions) : null,
    language_mismatch: languageMismatch(language, region),
    comments_disabled:
      post.platform === "instagram" &&
      ((post.raw ?? {}) as { isCommentsDisabled?: boolean | null }).isCommentsDisabled === true,
    is_repost: repostKind(post.platform, caption, post.raw),
    hashtag_strategy: hashtagStrategy(caption, post.hashtags),
    likes_per_play: reel.likesPerPlay,
    plays_per_follower: reel.playsPerFollower,
  };
}
