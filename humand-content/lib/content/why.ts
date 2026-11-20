import { label } from "@/lib/content/labels";
import { type ContentPost, type PatternLift, type RegionSynthesis } from "@/lib/content/types";

/**
 * "Por qué funcionó", con datos.
 *
 * Cruza lo que tiene el post con lo que la síntesis de su mercado mide que
 * aparece más entre los posts que más rinden. No es una causa: es "esto que
 * tiene es lo mismo que tienen los que rinden". Por eso la UI dice "pudo".
 *
 * Mismo umbral que los hallazgos del inicio (1,3× y tres autores): por debajo,
 * en un corte de cincuenta posts, la diferencia es uno o dos posts.
 */

/** `axis` deja que la tarjeta no repita en "Qué podés tomar" lo que ya está acá. */
export type WhyReason = { axis: string; text: string; lift: number };
export type WhyItWorked = { region: string; reasons: WhyReason[] };

const MIN_LIFT = 1.3;
const MIN_AUTHORS = 3;
const MAX_REASONS = 3;

/** Claves que describen una ausencia: "no tiene X" no se puede copiar. */
const NOT_A_REASON = new Set(["otro", "ninguno", "ninguna", "nadie", "generico", "ni_numero_ni_pregunta"]);

type Feat = Record<string, unknown> | null | undefined;

/**
 * Cada eje: qué valor tiene el post y cómo decirlo como algo que el post hace.
 * Quedan afuera author_role y author_cadence: describen a la cuenta, no a la
 * pieza, y no hay nada que Content pueda tomar de ellos. También la apertura
 * (hook_pattern) y la emoción: el juez gpt-4o les da 53% y 65% de acierto en
 * la clasificación, y como razón salían dudosas o falsas una de cada dos veces.
 */
const AXES: Array<{
  axis: string;
  get: (s: RegionSynthesis) => PatternLift[] | null | undefined;
  value: (p: ContentPost, f: Feat) => string | null | undefined;
  say: (key: string) => string | null;
}> = [
  {
    axis: "format",
    get: (s) => s.winning_formats,
    value: (p) => p.features?.format_detail,
    say: (k) => `Formato ${label(k).toLowerCase()}`,
  },
  {
    axis: "theme",
    get: (s) => s.winning_themes,
    value: (p) => p.analysis?.theme,
    say: (k) => `Habla de ${label(k).toLowerCase()}`,
  },
  {
    axis: "structure",
    get: (s) => s.winning_structures,
    value: (p) => p.analysis?.structure,
    say: (k) =>
      ({
        caso: "Cuenta un caso",
        reflexion_breve: "Es una reflexión breve",
        tesis_y_argumentos: "Plantea una tesis y la argumenta",
        dato_y_lectura: "Da un dato y lo interpreta",
        how_to: "Explica cómo hacer algo",
        pregunta_y_respuesta: "Se hace una pregunta y la responde",
        anecdota: "Cuenta una anécdota",
        lista: "Está armado como lista",
      })[k] ?? null,
  },
  {
    axis: "cta",
    get: (s) => s.winning_ctas,
    value: (p) => p.analysis?.cta_type,
    say: (k) =>
      ({
        pregunta_abierta: "Cierra con una pregunta abierta",
        ir_a_link: "Manda a un link",
        // El clasificador mete acá demos y webinars, no solo eventos.
        inscribirse_evento: "Invita a anotarse (evento, webinar o demo)",
        guardar_o_compartir: "Pide guardar o compartir",
        etiquetar: "Pide etiquetar a alguien",
        contacto_comercial: "Invita a contactar",
        // Comentar una palabra junta comentarios por pedido: no es una razón
        // para imitar, y la tarjeta ya lo marca como advertencia.
      })[k] ?? null,
  },
  {
    axis: "timeliness",
    get: (s) => s.winning_timeliness,
    value: (p) => p.analysis?.timeliness,
    say: (k) =>
      ({
        coyuntura: "Toca un tema de actualidad",
        efemeride: "Se cuelga de una fecha",
        evergreen: "Es atemporal",
      })[k] ?? null,
  },
  {
    axis: "intent",
    get: (s) => s.winning_axes?.content_intent,
    value: (p) => p.analysis?.content_intent,
    say: (k) =>
      ({
        cultura_propia_employer_brand: "Muestra la cultura de la empresa desde adentro",
        opinion_liderazgo: "Da una opinión propia",
        evento_webinar: "Promociona un evento",
        celebracion_logro: "Celebra un logro",
        educativo_practico: "Enseña algo aplicable",
        dato_o_noticia: "Comparte un dato o una noticia",
        personal: "Es personal",
      })[k] ?? null,
  },
  {
    axis: "evidence",
    get: (s) => s.winning_axes?.evidence_type,
    value: (p) => p.analysis?.evidence_type,
    say: (k) => `Se apoya en ${label(k)}`,
  },
  {
    axis: "protagonist",
    get: (s) => s.winning_axes?.protagonist,
    value: (p) => p.analysis?.protagonist,
    say: (k) =>
      ({
        equipo_empleados: "El protagonista es el equipo",
        autor: "El protagonista es el autor",
        el_lector: "Le habla al lector de su propia situación",
        cliente: "El protagonista es un cliente",
        experto_externo: "El protagonista es un experto",
      })[k] ?? null,
  },
  {
    axis: "specificity",
    get: (s) => s.winning_axes?.specificity,
    value: (p) => p.analysis?.specificity,
    say: (k) =>
      ({ muy_concreto: "Es muy concreto: nombra personas, cifras o casos", algo_concreto: "Baja a algo concreto" })[k] ??
      null,
  },
  {
    axis: "voice",
    get: (s) => s.winning_axes?.narrative_voice,
    value: (_p, f) => f?.narrative_voice as string | undefined,
    say: (k) =>
      ({
        yo: "Está escrito en primera persona",
        nosotros: "Está escrito en plural",
        vos_usted: "Le habla directo al lector",
        impersonal: "Está escrito en impersonal",
      })[k] ?? null,
  },
  {
    axis: "first_line",
    get: (s) => s.winning_axes?.first_line,
    value: (_p, f) => (!f ? null : f.first_line_has_number ? "con_numero" : f.first_line_is_question ? "pregunta" : null),
    say: (k) => ({ con_numero: "La primera línea tiene un número", pregunta: "La primera línea es una pregunta" })[k] ?? null,
  },
  {
    axis: "list",
    get: (s) => s.winning_axes?.has_list,
    value: (_p, f) => (!f || f.has_list == null ? null : f.has_list ? "con_lista" : "sin_lista"),
    say: (k) => ({ con_lista: "Usa una lista", sin_lista: "Va en prosa, sin listas" })[k] ?? null,
  },
  {
    axis: "link",
    get: (s) => s.winning_axes?.link_placement,
    value: (_p, f) => f?.link_placement as string | undefined,
    say: (k) => ({ en_texto: "Pone el link en el texto", en_comentarios: "Pone el link en los comentarios" })[k] ?? null,
  },
  {
    axis: "aspect",
    get: (s) => s.winning_axes?.aspect_ratio,
    value: (_p, f) => f?.aspect_ratio as string | undefined,
    say: (k) =>
      ({
        cuadrado: "Imagen cuadrada",
        vertical_4_5: "Imagen vertical 4:5",
        vertical_9_16: "Vertical 9:16",
        horizontal: "Imagen horizontal",
      })[k] ?? null,
  },
];

function reasonsFor(post: ContentPost, synthesis: RegionSynthesis): WhyReason[] {
  const f = post.features as Feat;
  const out: WhyReason[] = [];
  for (const axis of AXES) {
    const key = axis.value(post, f);
    if (!key || NOT_A_REASON.has(key)) continue;
    const row = axis.get(synthesis)?.find((r) => r.key === key);
    if (!row || row.lift < MIN_LIFT || (row.top_authors ?? 0) < MIN_AUTHORS) continue;
    const text = axis.say(key);
    if (text) out.push({ axis: axis.axis, text, lift: row.lift });
  }
  return out.sort((a, b) => b.lift - a.lift).slice(0, MAX_REASONS);
}

/**
 * Las razones de un post contra su mercado.
 *
 * Un post puede venir de fuentes de más de un mercado. Si hay un mercado
 * filtrado se usa ese; si no, el primero, igual que el motor cuando arma la
 * síntesis. No se elige "el que más razones da": sería buscar el mercado que
 * mejor lo explica en vez del que lo midió. Null cuando el post no es de RRHH
 * (la síntesis solo mira esos) o su mercado no tiene síntesis.
 */
export function whyItWorked(
  post: ContentPost,
  syntheses: RegionSynthesis[],
  preferredRegion?: string,
): WhyItWorked | null {
  if (post.analysis?.audience_signal !== "hr_leader") return null;
  const region = preferredRegion ?? post.regions?.[0];
  const synthesis = syntheses.find((s) => s.region === region && !s.insufficient_sample);
  if (!region || !synthesis) return null;
  return { region, reasons: reasonsFor(post, synthesis) };
}

/**
 * Los rasgos del post, en las mismas frases que "Por qué pudo funcionar". Lo
 * usa Insights propios para comparar nuestros posts entre sí, sin síntesis.
 */
export function postTraits(post: ContentPost): Array<{ axis: string; key: string; text: string }> {
  const f = post.features as Feat;
  const out: Array<{ axis: string; key: string; text: string }> = [];
  for (const axis of AXES) {
    const key = axis.value(post, f);
    if (!key || NOT_A_REASON.has(key)) continue;
    const text = axis.say(key);
    if (text) out.push({ axis: axis.axis, key, text });
  }
  return out;
}

export type MarketPattern = { axis: string; text: string; lift: number; authors: number };

/**
 * Lo que más se repite en lo que rinde en un mercado, con las mismas frases y
 * el mismo umbral que la tarjeta: lo que dice Insights claves y lo que dice
 * cada post tienen que ser la misma lectura.
 */
export function marketPatterns(synthesis: RegionSynthesis, limit = 5): MarketPattern[] {
  if (synthesis.insufficient_sample) return [];
  const out: MarketPattern[] = [];
  for (const axis of AXES) {
    for (const row of axis.get(synthesis) ?? []) {
      if (NOT_A_REASON.has(row.key) || row.lift < MIN_LIFT || (row.top_authors ?? 0) < MIN_AUTHORS) continue;
      const text = axis.say(row.key);
      if (text) out.push({ axis: axis.axis, text, lift: row.lift, authors: row.top_authors ?? 0 });
    }
  }
  return out.sort((a, b) => b.lift - a.lift).slice(0, limit);
}
