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
  cta: z
    .string()
    .nullable()
    .describe("La llamada a la acción dentro de la pieza, textual. Null si no tiene."),
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
      "SOBRE QUÉ afirma, como sustantivo corto de 2 a 4 palabras, sin verbo y " +
        "sin postura. Ejemplos: 'encuestas de clima', 'home office', " +
        "'evaluación de desempeño', 'salario emocional', 'onboarding remoto'. " +
        "Usá el término más común del rubro, no una perífrasis.",
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
  copy_length: number;
  hashtag_count: number;
};

export type ClassifiablePost = {
  post_id: string;
  caption: string | null;
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
  "Para copy in y copy out citá lo que el texto dice de verdad. No inventes un",
  "CTA que no está ni hashtags que no aparecen: la ausencia es un dato válido.",
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
  "`claim_object` es un sustantivo del vocabulario del rubro, sin postura",
  'adentro: "encuestas de clima", no "el problema de las encuestas de clima".',
  "Usá el término que usaría alguien del rubro, no una perífrasis: sobre ese",
  "texto se agrupan los posts entre sí, así que dos posts sobre lo mismo tienen",
  "que escribirlo igual.",
  "",
  "Respondé en español, salvo hook, claim y counterclaim, que van en el idioma",
  "original de la pieza. Devolvé un objeto por post, con su post_index.",
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

function renderPost(post: ClassifiablePost, index: number): string {
  const parts = [`POST ${index}`];
  if (post.author_label) parts.push(`autor: ${post.author_label}`);
  if (post.format) parts.push(`formato: ${post.format}`);
  if (post.likes_count != null) {
    parts.push(`engagement: ${post.likes_count} likes, ${post.comments_count ?? 0} comentarios`);
  }
  // 1200 caracteres cubre el post de LinkedIn típico entero.
  const caption = (post.caption ?? "").slice(0, 1200);
  parts.push(caption ? `texto: ${caption}` : "texto: (sin texto)");
  if (post.hashtags?.length) parts.push(`hashtags: ${post.hashtags.slice(0, 12).join(" ")}`);
  return parts.join("\n");
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
    out.set(post.post_id, {
      ...llm,
      // Contables: se calculan acá en vez de pedírselos al modelo.
      copy_length: (post.caption ?? "").length,
      hashtag_count: post.hashtags?.length ?? 0,
    });
    resolved.add(post.post_id);
  }
  return resolved;
}
