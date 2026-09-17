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
  topic: z.string().describe("El tema puntual del post, 2 a 5 palabras, en el idioma del post."),
  audience_signal: z
    .enum(AUDIENCE_SIGNALS)
    .describe(
      "hr_leader: le habla a quien gestiona personas. candidate: le habla a quien " +
        "busca trabajo. general: a cualquiera.",
    ),
  relevance_reason: z
    .string()
    .describe(
      "Por qué este tema le importa a nuestra audiencia, en una oración. " +
        "Si is_relevant_to_hr es false, explicá por qué no.",
    ),
  angle: z.string().describe("Desde qué ángulo aborda el tema, 3 a 8 palabras."),
  target_profiles: z
    .array(z.enum(TARGET_PROFILES))
    .describe(
      "A cuáles de nuestros perfiles objetivo le interesaría esta pieza. " +
        "Vacío si no le sirve a ninguno.",
    ),

  // ── Copy in: el texto DENTRO de la pieza ──────────────────────────────────
  hook: z.string().nullable().describe("La frase de apertura que engancha, textual, máximo 15 palabras."),
  hook_pattern: z.enum(HOOK_PATTERNS).describe("Qué estructura usa la apertura."),
  development: z
    .string()
    .describe("Cómo sigue después del hook: qué argumenta y cómo lo sostiene, en una o dos oraciones."),
  structure: z.enum(COPY_STRUCTURES).describe("Qué forma tiene el desarrollo."),
  cta: z
    .string()
    .nullable()
    .describe("La llamada a la acción dentro de la pieza, textual. Null si no tiene."),
  keywords: z
    .array(z.string())
    .describe(
      "3 a 6 términos del mundo laboral que aparecen en el CUERPO del texto, en " +
        "su idioma original. No repitas los hashtags: esos van aparte.",
    ),
  expressions: z
    .array(z.string())
    .describe("Hasta 3 frases o giros textuales que le dan carácter al texto."),
  tone: z.string().describe("Tono en una o dos palabras: educativo, provocador, emotivo, humorístico, etc."),

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
  humand_angle: z
    .string()
    .nullable()
    .describe(
      "Una línea concreta de cómo Humand adaptaría esta idea. Si replicability " +
        "es alta o media, tiene que haber un ángulo. Null solo si " +
        "is_relevant_to_hr es false o si la pieza depende de la persona.",
    ),
  why_it_worked: z
    .string()
    .describe("Una oración sobre por qué este post generó engagement."),
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
  "Respondé en español, salvo hook, keywords y expressions, que van textuales en",
  "el idioma original de la pieza. Devolvé un objeto por post, con su post_index.",
].join("\n");

/**
 * Lote por llamada. Con 20 el modelo devolvía arrays incompletos y se perdía
 * casi la mitad de los posts en silencio (33 de 60 en la primera corrida). Bajó
 * a 10, y con el schema extendido del brief —de 10 a 19 campos por post— baja a
 * 6: lo que satura no es el contexto de entrada sino el largo de la respuesta.
 */
const BATCH_SIZE = 6;

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

    if (object) {
      if (object.posts.length < batch.length) {
        // No es fatal, pero hay que verlo: si pasa seguido, bajar BATCH_SIZE.
        console.warn(
          `[classify] el modelo devolvió ${object.posts.length} de ${batch.length} posts`,
        );
      }
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
      }
    }
  }

  return out;
}
