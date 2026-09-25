/**
 * Clasificación de posts de discovery.
 *
 * Deliberadamente separado de `competitor-ads/organic-analyze.ts`: ese analiza
 * la estrategia de UN competidor conocido y está en producción alimentando la
 * vista de Monitoreo de Competidores. Acá el objeto es otro — un post de un
 * referente cualquiera— y forzar el mismo schema genera basura: un reel de una
 * influencer de RRHH no mapea a un módulo de producto de Humand.
 *
 * Por qué hace falta: el ranking por engagement solo no alcanza. En la primera
 * corrida de LinkedIn, un post de una referente sobre ir al Rock in Rio con sus
 * hijas rindió 20x su promedio y entró al top. Lo personal funciona, pero no
 * sirve para el calendario. `is_relevant_to_hr` es el filtro de eso.
 *
 * Costo: se clasifica sobre el TEXTO (caption), que en LinkedIn es el contenido
 * entero. No se toca la transcripción de video —lo caro— en esta etapa.
 */
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

function classifyModel(): string {
  return (
    process.env.CONTENT_ANALYSIS_MODEL ??
    process.env.COMPETITOR_ADS_MODEL ??
    "gpt-4o-mini"
  );
}

/** Temas alineados a los módulos de Humand, para que el corte sea accionable. */
export const CONTENT_THEMES = [
  "comunicacion_interna",
  "clima_cultura",
  "desempeno",
  "onboarding",
  "reconocimiento",
  "rotacion_retencion",
  "liderazgo",
  "dei",
  "futuro_del_trabajo",
  "reclutamiento",
  "otro",
] as const;

/** Patrón de apertura. Es lo más replicable de un post que funcionó. */
export const HOOK_PATTERNS = [
  "pregunta",
  "dato_shock",
  "listicle",
  "storytelling",
  "contrarian",
  "pov",
  "tutorial",
  "humor",
  "anuncio",
  "cita",
  "otro",
] as const;

export const AUDIENCE_SIGNALS = ["hr_leader", "candidate", "general"] as const;

/**
 * Los seis perfiles del brief (sección 7). Es un filtro de relevancia: "todo
 * hallazgo debe evaluarse en función de si le interesaría a alguno de estos".
 *
 * Convive con `audience_signal` en vez de reemplazarlo: esto dice A QUIÉN de
 * nuestra audiencia le sirve, y audience_signal dice si la pieza le habla al
 * que COMPRA o al que busca trabajo. Son preguntas distintas y las dos importan
 * — las cuentas más grandes del rubro le hablan a candidatos.
 */
export const TARGET_PROFILES = [
  "hr_manager",
  "people",
  "chro",
  "ceo",
  "dueno_pyme",
  "operations",
] as const;

/** Estructura del desarrollo, después del hook. */
/**
 * Enum cerrado a propósito. `tone` era `z.string()` "en una o dos palabras" y
 * produjo 79 valores distintos sobre 983 posts; `topic` produjo 907, o sea
 * prácticamente uno por post. `tally()` agrupa por match exacto, así que los
 * conteos quedaban fragmentados y el ranking que salía en pantalla era
 * arbitrario. Un eje agregable necesita vocabulario cerrado.
 */
/**
 * Lo que hace funcionar al post más allá del tema. Es lo único transferible:
 * el tema es de quien lo escribió, el mecanismo se puede usar en otro tema.
 */
export const MECHANISMS = [
  "tension_con_el_consenso",
  "dato_propietario",
  "admision_de_error",
  "ritual_interno_concreto",
  "desmontar_practica_comun",
  "checklist_operable",
  "caso_con_numeros",
  "pregunta_diagnostica",
  "reencuadre_de_un_termino",
  "ninguno",
] as const;

/**
 * Qué le pide el post al lector. `cta` es texto libre y no se puede contar;
 * esto sí. `comentar_palabra_clave` va separado de `pregunta_abierta` porque
 * los dos juntan comentarios y no son lo mismo: uno es fricción, el otro es
 * un formulario de captura disfrazado.
 */
export const CTA_TYPES = [
  "ninguno",
  "pregunta_abierta",
  "comentar_palabra_clave",
  "guardar_o_compartir",
  "etiquetar",
  "ir_a_link",
  "seguir",
  "inscribirse_evento",
  "contacto_comercial",
] as const;

/**
 * Si la pieza se puede replicar cualquier semana o tiene ventana. Es lo que
 * decide si una idea va al calendario del mes que viene o ya pasó.
 */
export const TIMELINESS = ["evergreen", "coyuntura", "efemeride"] as const;

/**
 * Versión del prompt y del schema. Va a `content_posts.analysis_version`: con
 * dos versiones conviviendo, un agregado que las mezcla sin saberlo compara
 * campos que no existían en la mitad de las filas.
 */
export const ANALYSIS_VERSION = "2026-09-23g.pasada-enfocada";

export const TONES = [
  "educativo",
  "informativo",
  "reflexivo",
  "provocador",
  "emotivo",
  "inspirador",
  "critico",
  "humoristico",
  "tecnico",
  "celebratorio",
] as const;

export const COPY_STRUCTURES = [
  "lista",
  "caso",
  "opinion",
  "how_to",
  "comparacion",
  "dato_y_lectura",
  "anecdota",
  "pregunta_y_respuesta",
  "anuncio",
  "otro",
] as const;

/** Qué hace con los hashtags. La ausencia también es una decisión. */
export const HASHTAG_STRATEGIES = [
  "ninguno",
  "pocos_genericos",
  "muchos_genericos",
  "de_nicho",
  "mixto",
] as const;

const PostAnalysisSchema = z.object({
  post_index: z.number().int(),
  /**
   * El filtro que importa. Un post puede explotar de engagement y no tener nada
   * que ver con RRHH (vida personal, política, deportes).
   */
  is_relevant_to_hr: z
    .boolean()
    .describe(
      "¿El post trata sobre trabajo, gestión de personas, cultura o liderazgo? " +
        "false si es vida personal, deportes, política u otro tema ajeno, " +
        "aunque el autor sea de RRHH.",
    ),
  theme: z.enum(CONTENT_THEMES).describe("Tema principal. 'otro' si no encaja."),
  audience_signal: z
    .enum(AUDIENCE_SIGNALS)
    .describe(
      "hr_leader: le habla a quien gestiona personas. candidate: le habla a quien " +
        "busca trabajo. general: a cualquiera.",
    ),
  target_profiles: z
    .array(z.enum(TARGET_PROFILES))
    .describe(
      "A cuáles de nuestros perfiles objetivo le interesaría esta pieza. " +
        "Vacío si no le sirve a ninguno.",
    ),

  // ── Copy in: el texto DENTRO de la pieza ──────────────────────────────────
  hook: z.string().nullable().describe("La frase de apertura que engancha, textual, máximo 15 palabras."),
  hook_pattern: z.enum(HOOK_PATTERNS).describe("Qué estructura usa la apertura."),
  structure: z.enum(COPY_STRUCTURES).describe("Qué forma tiene el desarrollo."),
  tone: z
    .enum(TONES)
    .describe("El registro dominante del texto."),

  // ── Copy out: el texto que acompaña ───────────────────────────────────────
  hashtag_strategy: z
    .enum(HASHTAG_STRATEGIES)
    .describe("Qué hace con los hashtags. 'ninguno' también es una decisión válida y frecuente."),
  replicability: z
    .enum(["alta", "media", "baja"])
    .describe(
      "¿Humand podría hacer algo parecido? alta: formato y tema reutilizables. " +
        "baja: depende de la persona, su historia o su autoridad personal.",
    ),

  // ── Qué AFIRMA el post ────────────────────────────────────────────────────
  //
  // Reemplaza a humand_angle y why_it_worked, que eran relleno medible:
  // el 46% de los ángulos empezaba con uno de cuatro verbos genéricos, y 32
  // "por qué funcionó" arrancaban con "el post generó engagement" — que es
  // circular, porque el engagement es el criterio con el que lo elegimos.
  //
  // La categoría borra lo único replicable. Dos posts etiquetados igual
  // (contrarian + clima_cultura) pueden sostener cosas opuestas: "el clima no
  // se arregla con encuestas" contra "la encuesta es el primer paso". Lo que
  // se puede replicar, o refutar, es la afirmación.
  claim: z
    .string()
    .nullable()
    .describe(
      "La afirmación que el post sostiene, como oración declarativa completa, " +
        "en el idioma del post, máximo 20 palabras. Tiene que ser algo con lo " +
        "que un profesional de RRHH informado PODRÍA estar en desacuerdo. " +
        "Null si el post no sostiene nada discutible: anuncio, lista de " +
        "recursos, anécdota personal, saludo, celebración.",
    ),
  counterclaim: z
    .string()
    .nullable()
    .describe(
      "La posición contraria, tal como la sostendría alguien real del rubro. " +
        "Si al escribirla te queda algo que nadie defendería en serio ('la " +
        "cultura no importa', 'hay que tratar mal a la gente'), entonces el " +
        "claim era una obviedad: devolvé null en los dos.",
    ),
  claim_object: z
    .string()
    .nullable()
    .describe(
      "LA PRÁCTICA CONCRETA sobre la que afirma, como sustantivo de 2 a 5 " +
        "palabras, sin verbo y sin postura. Tiene que ser algo de lo que se " +
        "pueda estar a favor o en contra. " +
        "SÍ: 'encuestas de clima', 'evaluación anual de desempeño', " +
        "'home office', 'liderazgo vulnerable', 'entrevistas por competencias'. " +
        "NO: 'liderazgo', 'cultura organizacional', 'recursos humanos', " +
        "'comunicación' — son categorías, nadie está a favor o en contra de " +
        "ellas, y agrupan posts que no discuten lo mismo. " +
        "Si solo te sale una categoría amplia, buscá la práctica puntual que " +
        "el post cuestiona o defiende dentro de ella.",
    ),
  claim_stance: z
    .enum(["a_favor", "en_contra", "condicional", "descriptivo"])
    .nullable()
    .describe(
      "Postura respecto del objeto. a_favor: lo defiende o recomienda. " +
        "en_contra: lo critica, lo desmiente o dice que no alcanza. " +
        "condicional: funciona solo bajo ciertas condiciones. descriptivo: " +
        "reporta sin tomar partido.",
    ),
  transferable_mechanism: z
    .enum(MECHANISMS)
    .describe(
      "QUÉ hace que el post funcione, más allá del tema. Es lo único que se " +
        "transfiere entre marcas. 'ninguno' si funciona por quién lo firma.",
    ),
});

const BatchSchema = z.object({ posts: z.array(PostAnalysisSchema) });

type LlmAnalysis = Omit<z.infer<typeof PostAnalysisSchema>, "post_index">;

/**
 * Lo que se guarda por post. `copy_length` y `hashtag_count` NO se le piden al
 * modelo: son contables y pedirle que cuente es invitarlo a equivocarse.
 */
export type PostAnalysis = LlmAnalysis & {
  /** Sale de la pasada de CTA (`classifyCtas`), no del lote principal. */
  cta: string | null;
  /** Opcionales en el tipo porque las filas anteriores a ANALYSIS_VERSION no los tienen. */
  cta_type?: CtaType;
  /** También sale de la pasada enfocada. */
  timeliness?: (typeof TIMELINESS)[number];
  copy_length: number;
  hashtag_count: number;
  /**
   * De dónde salió `hook`. El 18% de los hooks del modelo (202 de 1126) no
   * estaba en el texto aunque el prompt pide cita textual: los parafraseaba.
   * Cuando pasa, se reemplaza por la primera línea real, que es lo que el
   * lector ve antes del "ver más".
   */
  hook_source?: "modelo" | "primera_linea";
};

export type ClassifiablePost = {
  post_id: string;
  caption: string | null;
  /**
   * Detectado por regla en post-features.ts. Cuando es true manda sobre el
   * modelo: la regla acertó 100% en el QA y el modelo lo confundía con
   * pregunta_abierta.
   */
  comment_bait?: boolean;
  /** Detectado por palabras frecuentes. Ver detectLanguage. */
  language?: "pt" | "es" | "en" | null;
  hashtags?: string[];
  format?: string | null;
  author_label?: string | null;
  likes_count?: number | null;
  comments_count?: number | null;
};

const SYSTEM = [
  "Sos analista de contenido para el equipo de Content de Humand, un software de",
  "RRHH (comunicación interna, cultura, gestión de personas) que le vende a",
  "empresas medianas y grandes en Brasil, México, Argentina y España.",
  "",
  "Te paso posts de referentes del rubro que tuvieron buen rendimiento. Tu trabajo",
  "es entender POR QUÉ funcionaron y si sirven de insumo para nuestro calendario.",
  "",
  "Tres cosas importan más que el resto:",
  "1. is_relevant_to_hr — sé estricto. Un referente de RRHH que postea sobre su",
  "   fin de semana tuvo un post popular, no un post útil para nosotros.",
  "2. audience_signal — distinguí si le habla a quien GESTIONA personas o a quien",
  "   BUSCA trabajo. Son audiencias distintas y solo la primera es nuestro comprador.",
  "3. target_profiles — nuestra audiencia son HR Managers, People, CHROs, CEOs,",
  "   dueños de PyME y Operations. No alcanza con que la pieza sea viral: tiene",
  "   que interesarle a alguno de ellos. Si no le interesa a ninguno, dejalo vacío.",
  "",
  "Para copy in y copy out citá lo que el texto dice de verdad. No inventes",
  "hashtags que no aparecen: la ausencia es un dato válido.",
  "`hook` es COPIA LITERAL de la apertura —lo primero que se lee—, no la mejor",
  "frase del post: no la resumas, no la corrijas y no la busques más abajo.",
  "",
  "Si el texto es largo te llega cortado con […].",
  "",
  "",
  "EL CAMPO MÁS IMPORTANTE ES `claim`. Un claim no es un tema ni un resumen: es",
  "una afirmación que se puede sostener o refutar.",
  "",
  '- "Habla de la importancia del feedback" NO es un claim: es un tema.',
  '- "El feedback anual llega tarde para corregir nada" SÍ es un claim:',
  "  alguien puede estar en desacuerdo.",
  "",
  "Antes de dar un claim por bueno, escribí su contraria y miralá. Si tu",
  "counterclaim es algo que ningún profesional defendería en público —'la",
  "cultura no importa', 'hay que tratar mal a la gente'—, entonces tu claim era",
  "una obviedad disfrazada. Devolvé null en los dos.",
  "",
  "Preferí null antes que forzar un claim. Muchos posts que funcionan no",
  "afirman nada: anuncios, listas de recursos, anécdotas, celebraciones. Eso es",
  "un dato válido, no una falla tuya.",
  "",
  "`claim_object` es la PRÁCTICA sobre la que se discute, no la categoría que la",
  "contiene. La prueba: si no se puede estar a favor o en contra de eso, está mal.",
  "",
  '- "liderazgo" está MAL: nadie está en contra del liderazgo. Lo que se',
  '  discute es "liderazgo vulnerable", "liderazgo por miedo", "líder como',
  '  referente técnico".',
  '- "cultura organizacional" está MAL por lo mismo. Lo discutible es "cultura',
  '  como consecuencia del liderazgo", "rituales de cultura", "cultura remota".',
  "",
  "Sin postura adentro del objeto: 'encuestas de clima', no 'el problema de las",
  "encuestas de clima'. Sobre ese texto se agrupan los posts entre sí, así que",
  "dos posts que discuten lo mismo tienen que escribirlo igual.",
  "",
  "IDIOMA: hook, claim y counterclaim van en el idioma del post, que te indico",
  "en 'idioma del post'. Un post en portugués tiene su claim en portugués: no lo",
  "traduzcas. El resto de los campos, en español. Devolvé un objeto por post, con",
  "su post_index.",
].join("\n");

/**
 * Lote por llamada. Con 20 el modelo devolvía arrays incompletos y se perdía
 * casi la mitad de los posts en silencio (33 de 60 en la primera corrida). Bajó
 * a 10, y con el schema extendido del brief —de 10 a 19 campos por post— baja a
 * 6: lo que satura no es el contexto de entrada sino el largo de la respuesta.
 */
// Se sacaron cinco campos de texto libre largo (relevance_reason, angle,
// development, keywords, expressions) y se cerraron topic y tone. Lo que
// saturaba era el LARGO DE LA RESPUESTA, no el contexto de entrada, así que el
// lote vuelve a 10 — que es donde estaba antes de que el schema se inflara.
const BATCH_SIZE = 10;

/**
 * Cabeza y cola del texto, no los primeros N caracteres.
 *
 * Antes se cortaba en 1200 "porque cubre el LinkedIn típico". No lo cubre: 271
 * de 621 posts de LinkedIn son más largos, y en 229 de esos el CTA quedó null
 * — el CTA está al final, justo en lo que se cortaba. El medio es lo que menos
 * información da sobre hook, cierre y pedido.
 */
const HEAD_CHARS = 950;
const TAIL_CHARS = 400;

/**
 * Corta por code points, no por unidades UTF-16.
 *
 * `slice()` puede partir un emoji en dos y dejar un surrogate suelto, que no
 * es JSON válido: la API rechazaba el lote entero ("failed to parse JSON
 * value"), y así quedaron 61 posts sin cta_type en el primer backfill.
 */
export function safeSlice(text: string, start: number, end?: number): string {
  const chars = Array.from(text);
  return chars.slice(start, end).join("");
}

export function clipCaption(caption: string | null | undefined): string {
  const text = caption ?? "";
  const length = Array.from(text).length;
  if (length <= HEAD_CHARS + TAIL_CHARS + 50) return text;
  return `${safeSlice(text, 0, HEAD_CHARS)}\n[…]\n${safeSlice(text, -TAIL_CHARS)}`;
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lo que se ve antes del "ver más", con margen: LinkedIn corta cerca de los
 * 210 caracteres en desktop e Instagram cerca de 125.
 */
const ABOVE_THE_FOLD_CHARS = 300;

/**
 * Deja el hook del modelo solo si es la APERTURA del texto.
 *
 * Dos fallas distintas, medidas con un juez gpt-4o: el modelo parafraseaba
 * (18% de los hooks no estaban en el texto) o elegía una frase buena del
 * medio, que es literal pero no es lo que el lector ve antes del "ver más".
 * Las dos se descartan y quedan con la primera línea real.
 *
 * Se compara normalizado —sin tildes, puntuación ni mayúsculas— porque el
 * modelo a veces le saca un emoji a la frase, y eso sigue siendo una cita.
 */
export function groundHook(
  hook: string | null,
  caption: string | null | undefined,
): { hook: string | null; source: "modelo" | "primera_linea" } {
  const text = caption ?? "";
  const probe = normalizeForMatch(hook ?? "").slice(0, 25);
  const fold = normalizeForMatch(safeSlice(text, 0, ABOVE_THE_FOLD_CHARS));
  if (hook && probe.length >= 8 && fold.includes(probe)) {
    return { hook, source: "modelo" };
  }
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
  if (!line) return { hook, source: "modelo" };
  const words = line.split(/\s+/);
  return {
    hook: words.length > 15 ? `${words.slice(0, 15).join(" ")}…` : line,
    source: "primera_linea",
  };
}

function renderPost(post: ClassifiablePost, index: number): string {
  const parts = [`POST ${index}`];
  if (post.author_label) parts.push(`autor: ${post.author_label}`);
  if (post.format) parts.push(`formato: ${post.format}`);
  if (post.language) {
    const names = { pt: "portugués", es: "español", en: "inglés" } as const;
    parts.push(`idioma del post: ${names[post.language]} (hook, claim y counterclaim van en este idioma)`);
  }
  if (post.likes_count != null) {
    parts.push(`engagement: ${post.likes_count} likes, ${post.comments_count ?? 0} comentarios`);
  }
  const caption = clipCaption(post.caption);
  parts.push(caption ? `texto: ${caption}` : "texto: (sin texto)");
  if (post.hashtags?.length) parts.push(`hashtags: ${post.hashtags.slice(0, 12).join(" ")}`);
  return parts.join("\n");
}

// ─── Pasada de CTA ───────────────────────────────────────────────────────────

export type CtaType = (typeof CTA_TYPES)[number];

/**
 * El CTA va en una pasada aparte, enfocada, y no en el lote principal.
 *
 * Medido con un juez gpt-4o: dentro del lote de veinticinco campos por post el
 * mini acertaba el cta_type el 68-79% de las veces, e ignoraba reglas
 * explícitas del prompt ("Vocês concordam?" seguía saliendo `ninguno`). Es un
 * campo que depende del CIERRE del texto, y el lote principal lo lee entero
 * con atención repartida. Acá ve solo apertura y cierre, y responde tres
 * campos. `timeliness` vino después por la misma razón: se estancó en ~80% en
 * el lote principal, y la fecha de un webinar o el nombre de una efeméride
 * están en la apertura o en el cierre.
 */
const CtaSchema = z.object({
  post_index: z.number().int(),
  timeliness: z
    .enum(TIMELINESS)
    .describe(
      "evergreen: tiene sentido publicarlo cualquier mes del año. coyuntura: " +
        "depende de un hecho reciente QUE EL TEXTO NOMBRA (una ley, una noticia, " +
        "un estudio de este año, un lanzamiento). Un post que invita a un " +
        "evento, webinar o programa CON FECHA es coyuntura aunque el tema sea " +
        "atemporal: la pieza vence cuando pasa la fecha. " +
        "efemeride: atado a una fecha o campaña del calendario (Setembro " +
        "Amarelo, Día de la Mujer, Pride, Día del Trabajador, vuelta de " +
        "vacaciones, fin de año, Black Friday). Un tema de moda sin hecho " +
        "concreto —IA, burnout, gen Z— es evergreen.",
    ),
  cta: z
    .string()
    .nullable()
    .describe(
      "La llamada a la acción dentro de la pieza, textual: la frase donde le " +
        "PIDE algo al lector. Una idea o un consejo no es un CTA. Null si no tiene.",
    ),
  cta_type: z
    .enum(CTA_TYPES)
    .describe(
      "Qué le pide al lector. Si pide varias cosas, la principal. " +
        "pregunta_abierta: pide opinión o experiencia. " +
        "comentar_palabra_clave: 'comentá X y te mando…'. guardar_o_compartir: " +
        "'guardalo', 'compartilo con tu equipo'. inscribirse_evento: anotarse a " +
        "un evento, webinar, curso o programa ('quedan plazas', 'inscribite'), " +
        "aunque sea con link. ir_a_link: leer, ver o descargar algo en un link " +
        "o en comentarios. contacto_comercial: demo, DM, contactanos. " +
        "ninguno si no pide nada — y entonces `cta` es null.",
    ),
});

const CtaBatchSchema = z.object({ posts: z.array(CtaSchema) });

const CTA_SYSTEM = [
  "Leés la apertura y el cierre de posts de LinkedIn e Instagram y decís dos",
  "cosas: qué le PIDE el post al lector, y si la pieza tiene fecha de vencimiento.",
  "",
  "Reglas, en orden:",
  "1. 'Comentá X y te mando…' → comentar_palabra_clave.",
  "2. Precio, fecha, horario, 'quedan plazas', 'inscribite', 'aforo', 'arranca el",
  "   día…' → inscribirse_evento, aunque el pedido termine en un link.",
  "3. Una pregunta dirigida al lector, esté en la apertura o en el cierre",
  "   ('¿y vos?', 'E você?', 'Vocês concordam?', '¿qué opinan?', '¿te pasó?')",
  "   → pregunta_abierta. Una pregunta retórica que el propio post responde no.",
  "4. 'Guardalo', 'compartilo', 'reenviáselo a tu jefe' → guardar_o_compartir.",
  "5. Leer, ver o descargar algo (link, 'en comentarios', 'en la bio') → ir_a_link.",
  "6. 'Etiquetá a…' → etiquetar. 'Seguime' → seguir. Demo, DM, 'escribinos'",
  "   para comprar → contacto_comercial.",
  "7. 'Espero que te inspire', 'gracias por leer', un hashtag de campaña: no",
  "   piden nada → ninguno, y `cta` null.",
  "",
  "Si pide varias cosas, la que más se destaca. `cta` es la frase textual del",
  "pedido, en su idioma.",
  "",
  "`timeliness` — si la pieza tiene ventana:",
  "- efemeride: nombra un día o campaña del calendario (Setembro Amarelo, Día de",
  "  la Mujer, Día del Reclutador, Pride, fin de año, vuelta de vacaciones).",
  "- coyuntura: invita a algo CON FECHA (webinar el 24/9, programa que arranca",
  "  en octubre, búsqueda laboral abierta), o depende de un hecho reciente que",
  "  nombra (una ley, una noticia, un estudio de este año, un lanzamiento).",
  "- evergreen: todo lo demás. Un tema de moda sin hecho concreto (IA, burnout)",
  "  es evergreen.",
  "",
  "Devolvé un objeto por post, con su post_index.",
].join("\n");

/** La pasada enfocada puede ir con otro modelo que el lote principal. */
function focusedModel(): string {
  return process.env.CONTENT_FOCUSED_MODEL ?? classifyModel();
}

const CTA_BATCH_SIZE = 15;
const OPENING_CHARS = 300;
const CLOSING_CHARS = 500;

function renderForCta(caption: string | null, index: number): string {
  const text = (caption ?? "").trim();
  if (!text) return `POST ${index}\n(sin texto)`;
  if (Array.from(text).length <= OPENING_CHARS + CLOSING_CHARS + 50) return `POST ${index}\n${text}`;
  return `POST ${index}\napertura: ${safeSlice(text, 0, OPENING_CHARS)}\n[…]\ncierre: ${safeSlice(text, -CLOSING_CHARS)}`;
}

export type FocusedFields = {
  cta: string | null;
  cta_type: CtaType;
  timeliness: (typeof TIMELINESS)[number];
};

export async function classifyCtas(
  posts: Array<{ post_id: string; caption: string | null }>,
): Promise<Map<string, FocusedFields>> {
  const out = new Map<string, FocusedFields>();
  for (let start = 0; start < posts.length; start += CTA_BATCH_SIZE) {
    const batch = posts.slice(start, start + CTA_BATCH_SIZE);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pending = batch.filter((p) => !out.has(p.post_id));
      if (!pending.length) break;
      try {
        const { object } = await generateObject({
          model: openai(focusedModel()),
          schema: CtaBatchSchema,
          system: CTA_SYSTEM,
          prompt: pending.map((p, i) => renderForCta(p.caption, i + 1)).join("\n\n---\n\n"),
        });
        for (const item of object.posts) {
          const post = pending[item.post_index - 1];
          if (!post) continue;
          out.set(post.post_id, {
            cta: item.cta_type === "ninguno" ? null : item.cta,
            cta_type: item.cta_type,
            timeliness: item.timeliness,
          });
        }
      } catch (err) {
        if (attempt === 1) {
          console.warn(`[classify] pasada de CTA falló: ${(err as Error)?.message ?? err}`);
        }
      }
    }
  }
  return out;
}

/**
 * Clasifica posts en lotes. Devuelve un mapa post_id -> análisis.
 *
 * Un lote que falla no aborta el resto: se pierde ese lote y se sigue. Con
 * cientos de posts, que una llamada se caiga no puede costar la corrida entera.
 */
export async function classifyPosts(
  posts: ClassifiablePost[],
): Promise<Map<string, PostAnalysis>> {
  const out = new Map<string, PostAnalysis>();
  if (!posts.length) return out;

  for (let start = 0; start < posts.length; start += BATCH_SIZE) {
    const batch = posts.slice(start, start + BATCH_SIZE);
    const done = await classifyBatch(batch, out);

    /*
     * El modelo devuelve lotes incompletos con cierta frecuencia: pide seis y
     * vuelven tres, sin error. Antes eso solo dejaba un warning y los que
     * faltaban se descartaban hasta la corrida siguiente.
     *
     * Ahora se reintentan los que faltan, de a dos: lo que satura no es el
     * contexto de entrada sino el largo de la respuesta —veintiún campos por
     * post— así que un lote más chico entra entero.
     */
    const missing = batch.filter((p) => !done.has(p.post_id));
    if (!missing.length) continue;

    console.warn(
      `[classify] faltaron ${missing.length} de ${batch.length}; reintentando de a dos`,
    );
    for (let i = 0; i < missing.length; i += 2) {
      await classifyBatch(missing.slice(i, i + 2), out);
    }

    const stillMissing = missing.filter((p) => !out.has(p.post_id));
    if (stillMissing.length) {
      // Quedan sin analysis, así que la próxima corrida los vuelve a tomar.
      console.warn(`[classify] ${stillMissing.length} posts quedaron sin clasificar`);
    }
  }

  // La pasada de CTA completa lo que el lote principal ya no pide. Si falla
  // para un post, queda sin cta_type —que es "no sabemos", no "ninguno"— y el
  // agregado lo saltea.
  const ctas = await classifyCtas(
    posts.filter((p) => out.has(p.post_id)).map((p) => ({ post_id: p.post_id, caption: p.caption })),
  );
  for (const post of posts) {
    const analysis = out.get(post.post_id);
    if (!analysis) continue;
    const found = ctas.get(post.post_id);
    analysis.cta = found?.cta ?? null;
    analysis.timeliness = found?.timeliness;
    // La regla determinística manda: acertó 100% en el QA.
    analysis.cta_type = post.comment_bait ? "comentar_palabra_clave" : found?.cta_type;
  }

  return out;
}

/**
 * Clasifica un lote y escribe en `out`. Devuelve los post_id que resolvió, que
 * es lo que permite saber cuáles faltaron.
 */
async function classifyBatch(
  batch: ClassifiablePost[],
  out: Map<string, PostAnalysis>,
): Promise<Set<string>> {
  const resolved = new Set<string>();
  if (!batch.length) return resolved;

  const prompt = batch.map((p, i) => renderPost(p, i + 1)).join("\n\n---\n\n");

  let object: z.infer<typeof BatchSchema> | null = null;
  // Un reintento: los fallos acá son transitorios (rate limit, corte) o de
  // parseo, y los dos se resuelven volviendo a pedir.
  for (let attempt = 0; attempt < 2 && !object; attempt++) {
    try {
      ({ object } = await generateObject({
        model: openai(classifyModel()),
        schema: BatchSchema,
        system: SYSTEM,
        prompt,
      }));
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      if (attempt === 1) {
        console.warn(`[classify] lote de ${batch.length} posts falló tras reintento: ${msg}`);
      }
    }
  }
  if (!object) return resolved;

  for (const item of object.posts) {
    const post = batch[item.post_index - 1];
    if (!post) continue;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { post_index, ...llm } = item;
    const grounded = groundHook(llm.hook, post.caption);
    out.set(post.post_id, {
      ...llm,
      // Los completa la pasada de CTA al final de classifyPosts.
      cta: null,
      hook: grounded.hook,
      hook_source: grounded.source,
      // Contables: se calculan acá en vez de pedírselos al modelo.
      copy_length: (post.caption ?? "").length,
      hashtag_count: post.hashtags?.length ?? 0,
    });
    resolved.add(post.post_id);
  }
  return resolved;
}
