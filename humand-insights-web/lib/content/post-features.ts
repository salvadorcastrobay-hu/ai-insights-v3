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
};

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

/** Placas de un carrusel. En LinkedIn el PDF no expone páginas: null. */
function slideCount(post: FeaturablePost, detail: FormatDetail): number | null {
  if (detail === "multi_imagen") return post.media?.images?.length ?? null;
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

  // Las menciones de LinkedIn vienen embebidas en el texto como nombres, no
  // como @handle: ahí el conteo del texto da cero y es honesto que dé cero.
  const mentionCount = Math.max(
    post.mentions?.length ?? 0,
    caption.match(MENTION_RE)?.length ?? 0,
  );

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
    language: detectLanguage(caption),
  };
}
