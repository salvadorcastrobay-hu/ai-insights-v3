/**
 * Qué se VE en el post.
 *
 * Espejo de classify.ts pero sobre la imagen, no sobre el texto. Se corre solo
 * sobre el corte superior de cada mercado: analizar mil imágenes para después
 * mirar cuarenta es pagar por lo que no se lee.
 *
 * SOLO ENUMS, CERO PROSA. El valor no está en la tarjeta —al lado de la foto,
 * describirla es ruido pago— sino en el agregado: "el 62% del corte superior es
 * carrusel de texto plano y el 80% de lo nuestro es foto de stock". Eso exige
 * campos tabulables, y `computeLift` necesita el denominador. Un campo que no
 * se puede contar no entra.
 *
 * `visual_text` es la excepción y es OCR, no descripción: el texto que está
 * escrito sobre la imagen es parte del copy, y hoy se pierde entero.
 */
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { coverFeatures, type CoverFeatures } from "./post-features";

/**
 * Qué tipo de pieza es. Antes mezclaba tipo con persona y con video
 * ("foto_persona", "video_persona_camara"): tres decisiones distintas en un
 * solo campo, y ninguna se podía cruzar con las otras. Ahora la persona y el
 * estilo de video van en sus propios ejes.
 */
export const CREATIVE_TYPES = [
  "foto_real",
  "foto_stock",
  "placa_texto",
  "infografia_dato",
  "captura",
  "ilustracion",
  "meme",
  "collage",
] as const;

/** Cuánto texto lleva encima. */
export const TEXT_ON_IMAGE = ["nada", "titular_corto", "parrafo", "listado"] as const;

/**
 * El debate creativo real del rubro: lo casero contra lo producido. Es lo que
 * se discute en la reunión de brief — cuánto hay que producir.
 */
export const PRODUCTION_LEVELS = ["casero", "plantilla", "producido"] as const;

/** Cómo aparece la persona. Es la decisión que se toma antes de filmar. */
export const PERSON_FRAMINGS = [
  "sin_persona",
  "primer_plano",
  "plano_medio",
  "cuerpo_entero",
  "grupo",
] as const;

/**
 * QUIÉN aparece, en la medida en que se puede saber mirando. Es la pregunta
 * que más se repite en una reunión de contenido ("¿ponemos la cara del CEO o
 * un modelo?") y `person_framing` no la contestaba: un primer plano de stock y
 * uno real tenían la misma etiqueta.
 */
export const PERSON_IDENTITIES = [
  "sin_persona",
  "persona_real",
  "modelo_stock",
  "persona_ilustrada",
] as const;

export const PEOPLE_COUNTS = ["0", "1", "2-5", "6+"] as const;

/** Dónde transcurre. El escenario de evento salió de `person_framing` a acá. */
export const SETTINGS = [
  "fondo_diseno",
  "oficina",
  "casa_remoto",
  "evento_escenario",
  "exterior",
  "estudio_fondo_liso",
  "otro",
] as const;

/**
 * Cuánto se ve la marca. Un booleano no distinguía el logo chico en la esquina
 * de la pieza que es un aviso: son decisiones opuestas.
 */
export const BRAND_TREATMENTS = ["ninguna", "logo_discreto", "marca_dominante"] as const;

/** Qué se capturó, cuando es una captura. Un tuit capturado y una UI de producto no son la misma jugada. */
export const SCREENSHOT_SUBJECTS = [
  "no_es_captura",
  "post_red_social",
  "chat_mensaje",
  "app_producto",
  "articulo_noticia",
  "otro",
] as const;

/**
 * Estilo del video, juzgado por la portada. Es una lectura de un fotograma, no
 * del video entero: por eso existe `no_determinable`, y la síntesis lo muestra
 * como contraste, nunca como certeza.
 */
export const VIDEO_STYLES = [
  "no_es_video",
  "cabeza_parlante",
  "pov_situacion",
  "animacion_motion",
  "entrevista_dialogo",
  "tutorial_pantalla",
  "registro_evento",
  "montaje_broll",
  "no_determinable",
] as const;

const VisualSchema = z.object({
  post_index: z.number().int(),
  creative_type: z
    .enum(CREATIVE_TYPES)
    .describe("Qué tipo de pieza es. En un video, juzgá la portada."),
  text_on_image: z.enum(TEXT_ON_IMAGE).describe("Cuánto texto hay escrito sobre la imagen."),
  visual_text: z
    .string()
    .nullable()
    .describe(
      "El texto que está ESCRITO SOBRE la imagen, transcripto tal cual y en su " +
        "idioma. Es OCR, no descripción: no cuentes qué se ve, copiá lo que " +
        "dice. Null si no hay texto encima.",
    ),
  production_level: z
    .enum(PRODUCTION_LEVELS)
    .describe(
      "casero: foto o video de celular, sin diseño. plantilla: diseño armado " +
        "con plantilla o herramienta tipo Canva, tipografía y colores planos. " +
        "producido: dirección de arte, fotografía profesional o edición cuidada.",
    ),
  person_identity: z
    .enum(PERSON_IDENTITIES)
    .describe(
      "persona_real: alguien que se nota real (foto propia, de equipo, de un " +
        "evento). modelo_stock: foto de banco de imágenes, pose y luz de " +
        "catálogo. persona_ilustrada: dibujo, avatar o 3D.",
    ),
  people_count: z.enum(PEOPLE_COUNTS).describe("Cuántas personas se ven."),
  person_framing: z
    .enum(PERSON_FRAMINGS)
    .describe(
      "primer_plano: cara ocupando la mayor parte. plano_medio: de la cintura " +
        "para arriba. cuerpo_entero: se ve la persona completa. grupo: varias " +
        "personas. sin_persona si no hay nadie.",
    ),
  setting: z
    .enum(SETTINGS)
    .describe(
      "Dónde transcurre. fondo_diseno: no hay lugar, es un fondo de color o " +
        "diseño. estudio_fondo_liso: persona sobre fondo neutro de estudio.",
    ),
  product_ui_visible: z
    .boolean()
    .describe("¿Se ve la pantalla o interfaz de un software o app?"),
  brand_treatment: z
    .enum(BRAND_TREATMENTS)
    .describe(
      "logo_discreto: logo o marca de agua chica. marca_dominante: la marca o " +
        "el producto es el centro de la pieza, se lee como aviso.",
    ),
  screenshot_of: z.enum(SCREENSHOT_SUBJECTS).describe("Si es una captura, de qué."),
  video_style: z
    .enum(VIDEO_STYLES)
    .describe(
      "Solo si el post es video (se indica junto a la imagen). cabeza_parlante: " +
        "alguien hablando a cámara. pov_situacion: escena actuada en primera " +
        "persona o situación identificable. animacion_motion: gráfica animada. " +
        "entrevista_dialogo: dos o más personas conversando. tutorial_pantalla: " +
        "grabación de pantalla. registro_evento: charla o evento filmado. " +
        "montaje_broll: tomas de apoyo editadas. no_es_video si es imagen.",
    ),
  cover_is_designed: z
    .boolean()
    .describe(
      "En un video: ¿la portada es una placa diseñada con título, y no un " +
        "fotograma crudo? false si no es video.",
    ),
  burned_captions: z
    .boolean()
    .describe("¿Hay subtítulos quemados sobre el fotograma, del tipo que transcribe lo que se dice?"),
});

const BatchSchema = z.object({ posts: z.array(VisualSchema) });

export type VisualAnalysis = Omit<z.infer<typeof VisualSchema>, "post_index"> &
  CoverFeatures & { visual_version: string };

/**
 * Sube cuando cambia el schema. El loader vuelve a pedir lo analizado con otra
 * versión: un análisis viejo no tiene los campos nuevos y mezclarlo en el
 * agregado da shares que no suman.
 */
export const VISUAL_VERSION = "2026-10-01.auditoria-content";

export type AnalyzableImage = {
  post_id: string;
  /** URL firmada de NUESTRO bucket, no del CDN: las del CDN vencen. */
  image_url: string;
  /** Si es video, la imagen es la portada: el modelo lo tiene que saber para juzgar el estilo. */
  is_video?: boolean;
};

/**
 * Lotes chicos: la visión es más lenta por ítem que el texto y cada imagen
 * cuesta ~765 tokens de entrada, así que un lote grande tarda mucho y arriesga
 * el timeout del request igual que pasó con la clasificación de texto.
 */
const BATCH_SIZE = 4;

function visualModel(): string {
  // La visión necesita un modelo multimodal; mini la soporta pero confunde
  // carrusel con captura con demasiada frecuencia para un campo que después se
  // agrega y se muestra como hallazgo.
  return process.env.CONTENT_VISUAL_MODEL ?? "gpt-4o";
}

const SYSTEM = [
  "Analizás el CREATIVO de posts de redes del mundo de RRHH: qué se ve, no qué",
  "dice el texto que los acompaña.",
  "",
  "Para cada imagen devolvé solo los campos del schema. No escribas",
  "descripciones: los campos son categorías que después se cuentan entre miles",
  "de posts, así que lo único que importa es que elijas bien la categoría.",
  "",
  "`visual_text` es la excepción y es transcripción literal: copiá el texto que",
  "está escrito ENCIMA de la imagen, con sus mayúsculas y sus saltos. No",
  "resumas y no traduzcas.",
  "",
  "Sobre los tipos que más se confunden:",
  "- placa_texto: el creativo es una placa con texto como protagonista.",
  "- infografia_dato: el protagonista es un número, un gráfico o una tabla.",
  "- foto_stock: una foto genérica de banco de imágenes, sin identidad propia.",
  "- captura: un screenshot de una app, un chat, un artículo o una publicación.",
  "- casero vs plantilla: si hay tipografía puesta encima con fondo de color,",
  "  es plantilla aunque se vea simple. Casero es sin diseño agregado.",
  "",
  "Cada imagen viene marcada como imagen o como portada de video. Si es imagen,",
  "video_style es no_es_video y cover_is_designed es false. Si es video y el",
  "fotograma no alcanza para saber el estilo, usá no_determinable: un estilo",
  "inventado contamina el agregado más que un hueco.",
  "",
  "Devolvé un objeto por imagen, con su post_index.",
].join("\n");

/**
 * Analiza el creativo de un conjunto de posts.
 *
 * No tira: una imagen que no se puede bajar o un lote que falla se saltean y el
 * resto sigue, igual que en la clasificación de texto.
 */
/** Una imagen que el modelo rechaza sola: no se vuelve a mandar. */
export type UnusableImage = { unusable: "imagen_invalida"; reason: string };

const INVALID_IMAGE_RE = /valid image|supported image formats|image data/i;

async function runBatch(
  batch: AnalyzableImage[],
): Promise<{ object: z.infer<typeof BatchSchema> | null; error: string | null }> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { object } = await generateObject({
        model: openai(visualModel()),
        schema: BatchSchema,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: batch.flatMap((img, i) => [
              {
                type: "text" as const,
                text: `post_index=${i + 1} (${img.is_video ? "portada de video" : "imagen"})`,
              },
              { type: "image" as const, image: new URL(img.image_url) },
            ]),
          },
        ],
      });
      return { object, error: null };
    } catch (err) {
      lastError = (err as Error)?.message ?? String(err);
      // Una imagen inválida no se arregla reintentando.
      if (INVALID_IMAGE_RE.test(lastError)) break;
    }
  }
  return { object: null, error: lastError };
}

/**
 * Analiza el creativo de un conjunto de posts.
 *
 * No tira. Si un lote falla, se reintenta de a una imagen: antes una sola
 * imagen inválida —los manifiestos de carrusel PDF de LinkedIn no son
 * imágenes— tiraba el lote entero, y como nunca quedaba marcada, volvía en
 * cada tanda arrastrando a tres sanas con ella. Ahora la que falla sola sale
 * en `unusable` y el job la marca para no volver a pagarla.
 */
export async function classifyVisuals(
  images: AnalyzableImage[],
): Promise<Map<string, VisualAnalysis | UnusableImage>> {
  const out = new Map<string, VisualAnalysis | UnusableImage>();
  if (!images.length) return out;

  const store = (batch: AnalyzableImage[], object: z.infer<typeof BatchSchema>) => {
    if (object.posts.length < batch.length) {
      console.warn(`[visual] el modelo devolvió ${object.posts.length} de ${batch.length}`);
    }
    for (const item of object.posts) {
      const img = batch[item.post_index - 1];
      if (!img) continue;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { post_index, ...analysis } = item;
      // Un modelo que contesta "cabeza_parlante" sobre una imagen fija se
      // corrige acá: el formato lo sabemos nosotros, no lo adivina él.
      if (!img.is_video) {
        analysis.video_style = "no_es_video";
        analysis.cover_is_designed = false;
      }
      out.set(img.post_id, {
        ...analysis,
        ...coverFeatures(analysis.visual_text),
        visual_version: VISUAL_VERSION,
      });
    }
  };

  for (let start = 0; start < images.length; start += BATCH_SIZE) {
    const batch = images.slice(start, start + BATCH_SIZE);
    const { object, error } = await runBatch(batch);
    if (object) {
      store(batch, object);
      continue;
    }

    console.warn(`[visual] lote de ${batch.length} falló (${error}); reintento de a una`);
    for (const img of batch) {
      const single = await runBatch([img]);
      if (single.object) {
        store([img], single.object);
      } else if (single.error && INVALID_IMAGE_RE.test(single.error)) {
        out.set(img.post_id, { unusable: "imagen_invalida", reason: single.error.slice(0, 200) });
      }
    }
  }

  return out;
}
