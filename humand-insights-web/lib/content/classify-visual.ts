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

/** Qué tipo de pieza es, visualmente. */
export const VISUAL_FORMATS = [
  "foto_persona",
  "carrusel_texto",
  "grafico_dato",
  "captura_pantalla",
  "ilustracion",
  "video_persona_camara",
  "video_editado",
  "meme",
  "foto_stock",
  "solo_texto",
] as const;

/** Cuánto texto lleva encima. */
export const TEXT_ON_IMAGE = ["nada", "titular_corto", "parrafo", "listado"] as const;

/** La paleta dominante, que es lo que decide si una pieza "se ve corporativa". */
export const COLOR_KEYS = [
  "azul_corporativo",
  "calido",
  "alto_contraste",
  "pastel",
  "monocromo",
  "multicolor",
] as const;

const VisualSchema = z.object({
  post_index: z.number().int(),
  visual_format: z.enum(VISUAL_FORMATS).describe("Qué tipo de pieza es visualmente."),
  text_on_image: z.enum(TEXT_ON_IMAGE).describe("Cuánto texto hay escrito sobre la imagen."),
  visual_text: z
    .string()
    .nullable()
    .describe(
      "El texto que está ESCRITO SOBRE la imagen, transcripto tal cual y en su " +
        "idioma. Es OCR, no descripción: no cuentes qué se ve, copiá lo que " +
        "dice. Null si no hay texto encima.",
    ),
  color_key: z.enum(COLOR_KEYS).describe("La paleta dominante."),
  face_present: z.boolean().describe("¿Se ve la cara de una persona?"),
  brand_visible: z
    .boolean()
    .describe("¿Hay logo, marca de agua o identidad visual de una empresa?"),
});

const BatchSchema = z.object({ posts: z.array(VisualSchema) });

export type VisualAnalysis = Omit<z.infer<typeof VisualSchema>, "post_index">;

export type AnalyzableImage = {
  post_id: string;
  /** URL firmada de NUESTRO bucket, no del CDN: las del CDN vencen. */
  image_url: string;
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
  "Sobre los formatos que más se confunden:",
  "- carrusel_texto: el creativo es una placa con texto como protagonista.",
  "- foto_stock: una foto genérica de banco de imágenes, sin identidad propia.",
  "- captura_pantalla: un screenshot de una app, un chat o una publicación.",
  "- video_persona_camara: un fotograma de alguien hablando a cámara.",
  "",
  "Devolvé un objeto por imagen, con su post_index.",
].join("\n");

/**
 * Analiza el creativo de un conjunto de posts.
 *
 * No tira: una imagen que no se puede bajar o un lote que falla se saltean y el
 * resto sigue, igual que en la clasificación de texto.
 */
export async function classifyVisuals(
  images: AnalyzableImage[],
): Promise<Map<string, VisualAnalysis>> {
  const out = new Map<string, VisualAnalysis>();
  if (!images.length) return out;

  for (let start = 0; start < images.length; start += BATCH_SIZE) {
    const batch = images.slice(start, start + BATCH_SIZE);

    let object: z.infer<typeof BatchSchema> | null = null;
    for (let attempt = 0; attempt < 2 && !object; attempt += 1) {
      try {
        ({ object } = await generateObject({
          model: openai(visualModel()),
          schema: BatchSchema,
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content: batch.flatMap((img, i) => [
                { type: "text" as const, text: `post_index=${i + 1}` },
                { type: "image" as const, image: new URL(img.image_url) },
              ]),
            },
          ],
        }));
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (attempt === 1) {
          console.warn(`[visual] lote de ${batch.length} falló tras reintento: ${msg}`);
        }
      }
    }
    if (!object) continue;

    if (object.posts.length < batch.length) {
      console.warn(`[visual] el modelo devolvió ${object.posts.length} de ${batch.length}`);
    }
    for (const item of object.posts) {
      const img = batch[item.post_index - 1];
      if (!img) continue;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { post_index, ...analysis } = item;
      out.set(img.post_id, analysis);
    }
  }

  return out;
}
