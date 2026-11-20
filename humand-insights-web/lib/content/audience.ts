/**
 * Audiencia de cada post y país de cada cuenta.
 *
 * Los dos los pidió Content (llamada del 23/10) para los filtros de
 * Inspiración: audiencias más finas que "RRHH / candidatos" (empleados,
 * management, pymes) y Argentina y México separados de HISPAM.
 *
 * Se corrieron primero a mano sobre la base y se validaron con un juez gpt-4o
 * (2026-11-02):
 *   - Audiencia, gpt-4o-mini: 90% correcta o aceptable en un piloto de 60;
 *     en la corrida completa, 30/30 en empleados y 28/30 en management.
 *   - País, gpt-4o: solo se guarda con confianza media o alta; "desconocido"
 *     queda registrado para no volver a preguntarlo cada semana.
 *
 * Esto deja que lo que entra después se clasifique solo, con los mismos
 * prompts. Los campos son aparte (content_posts.audience*,
 * content_authors.country*): no tocan analysis ni nada que lea la síntesis.
 */
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { getSupabaseAdmin } from "./store";

export const AUDIENCES = ["rrhh", "management_ceo", "pymes", "empleados", "candidatos", "general"] as const;

const AUDIENCE_MODEL = () => process.env.CONTENT_AUDIENCE_MODEL ?? "gpt-4o-mini";
const COUNTRY_MODEL = () => process.env.CONTENT_COUNTRY_MODEL ?? "gpt-4o";
const CONCURRENCY = 6;

const LABELS = `- rrhh: profesionales y líderes de Recursos Humanos / People (HRBP, talento, cultura, comunicación interna). El post habla de prácticas de gestión de personas desde el rol de RRHH.
- management_ceo: dueños, CEOs, directores y gerentes de áreas que no son RRHH. El post le habla a quien lidera el negocio o un equipo (liderazgo, resultados, decisiones de negocio sobre personas).
- pymes: dueños o responsables de pequeñas y medianas empresas. Solo si el post se dirige explícita o claramente a empresas chicas (menciona pyme, emprendedor, equipo chico, "si tenés una empresa pequeña", recursos limitados).
- empleados: trabajadores en general, colaboradores sin rol de gestión. El post le habla a la persona en su trabajo (bienestar propio, carrera, derechos, cómo tratar con tu jefe).
- candidatos: personas que buscan trabajo (CV, entrevistas, vacantes, cómo conseguir empleo).
- general: no se dirige a ninguno en particular.`;

const AudienceSchema = z.object({
  principal: z.enum(AUDIENCES),
  secundaria: z.enum(AUDIENCES).nullable(),
  motivo: z.string(),
});

const CountrySchema = z.object({
  country: z.string().describe("código ISO-2 en minúscula | latam | desconocido"),
  confianza: z.enum(["alta", "media", "baja"]),
  evidencia: z.string(),
});

/** Corre `fn` sobre `items` con a lo sumo `n` en paralelo. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export function audiencePrompt(post: { author: string; caption: string | null; visualText: string | null }): string {
  return `Clasificá a quién le habla este post de LinkedIn/Instagram del rubro RRHH.
Elegí la audiencia PRINCIPAL (una sola) y, si la hay, una SECUNDARIA.
Categorías:
${LABELS}
Reglas: decidí por a quién se dirige el texto (a quién interpela, qué rol tiene que tener el lector para que le sirva), no por el tema. Un post sobre liderazgo puede ser para rrhh o para management_ceo: si habla de lo que hace el área de personas, es rrhh; si le habla al jefe o al dueño sobre cómo liderar, es management_ceo.
Autor: @${post.author}
Copy: """${(post.caption ?? "").slice(0, 3000)}"""
Texto sobre la imagen: """${(post.visualText ?? "").slice(0, 600)}"""`;
}

/**
 * Clasifica la audiencia de los posts medidos y relevantes que todavía no la
 * tienen. Son los que muestra Inspiración: relevantes y con línea base.
 */
export async function classifyAudiences(platform: string, limit = 40): Promise<{ classified: number; failed: number }> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_posts")
    .select("id, author_handle, caption, visual_text:visual_analysis->>visual_text")
    .eq("platform", platform)
    .eq("analysis->>is_relevant_to_hr", "true")
    .not("outlier_factor", "is", null)
    .is("audience", null)
    .order("viral_score", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const posts = (data ?? []) as Array<{ id: string; author_handle: string; caption: string | null; visual_text: string | null }>;

  const results = await pool(posts, CONCURRENCY, async (post) => {
    try {
      const { object } = await generateObject({
        model: openai(AUDIENCE_MODEL()),
        schema: AudienceSchema,
        temperature: 0,
        prompt: audiencePrompt({ author: post.author_handle, caption: post.caption, visualText: post.visual_text }),
      });
      const secondary = object.secundaria && object.secundaria !== object.principal ? object.secundaria : null;
      const { error: updateError } = await sb
        .from("content_posts")
        .update({
          audience: object.principal,
          audience_secondary: secondary,
          audience_reason: object.motivo.slice(0, 500),
          audience_model: AUDIENCE_MODEL(),
          audience_classified_at: new Date().toISOString(),
        })
        .eq("id", post.id);
      return !updateError;
    } catch (err) {
      console.warn(`[audience] no pude clasificar ${post.id}:`, (err as Error)?.message ?? err);
      return false;
    }
  });
  const classified = results.filter(Boolean).length;
  return { classified, failed: results.length - classified };
}

export function countryPrompt(a: {
  platform: string;
  handle: string;
  name: string | null;
  website: string | null;
  bio: string | null;
  captions: string[];
}): string {
  return `¿De qué país es esta cuenta de ${a.platform}? Buscá señales concretas: ciudad, país, leyes o instituciones locales (SAT, IMSS, AFIP, ARCA, SUNAT, Código del Trabajo, LFT), moneda, modismos (vos/che = Argentina/Uruguay; "chamba", "padrísimo" = México), dominio del sitio web, emojis de bandera.
Si es una empresa, el país al que apunta esa cuenta (ej. @empresa_chile = cl). Si le habla a toda Latinoamérica sin un país dominante, "latam". Si no hay señales suficientes, "desconocido". No adivines por el nombre de la persona.
Handle: @${a.handle}  Nombre: ${a.name ?? ""}  Web: ${a.website ?? ""}
Bio: ${a.bio ?? ""}
Posts recientes:
${a.captions.join("\n---\n").slice(0, 4000)}`;
}

/** Lo que se guarda a partir de la respuesta del modelo. Null en country = no se sabe. */
export function countryToStore(answer: z.infer<typeof CountrySchema>): { country: string | null; source: string } {
  const code = answer.country.trim().toLowerCase();
  const usable = answer.confianza !== "baja" && (code === "latam" || /^[a-z]{2}$/.test(code));
  return {
    country: usable ? code : null,
    // Se guarda también cuando no se supo: country_source no nulo es lo que
    // evita volver a preguntar por la misma cuenta cada semana.
    source: `${COUNTRY_MODEL()}: ${usable ? answer.evidencia : `desconocido (${answer.confianza})`}`.slice(0, 300),
  };
}

/**
 * Infiere el país de las cuentas de HISPAM que todavía no lo tienen. Solo
 * HISPAM: Brasil y España ya salen de la fuente; es HISPAM la que mezcla
 * países y la que hay que partir en Argentina, México y el resto.
 */
export async function inferCountries(platform: string, limit = 15): Promise<{ inferred: number; unknown: number; failed: number }> {
  const sb = getSupabaseAdmin();

  // Cuentas con posts relevantes llegados por una fuente de HISPAM.
  const handles = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("content_post_sources")
      .select("content_posts!inner(author_handle, platform, analysis->>is_relevant_to_hr)")
      .eq("region", "hispam")
      .eq("content_posts.platform", platform)
      .order("post_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Array<{ content_posts: { author_handle: string; is_relevant_to_hr: string | null } }>) {
      if (row.content_posts?.is_relevant_to_hr === "true") handles.add(row.content_posts.author_handle);
    }
    if (!data || data.length < PAGE) break;
  }
  if (!handles.size) return { inferred: 0, unknown: 0, failed: 0 };

  const pending: Array<{ handle: string; full_name: string | null; biography: string | null; website: string | null }> = [];
  for (let i = 0; i < [...handles].length && pending.length < limit; i += 100) {
    const batch = [...handles].slice(i, i + 100);
    const { data, error } = await sb
      .from("content_authors")
      .select("handle, full_name, biography, website")
      .eq("platform", platform)
      .in("handle", batch)
      .is("country_source", null);
    if (error) throw error;
    pending.push(...((data ?? []) as typeof pending));
  }
  const todo = pending.slice(0, limit);

  const results = await pool(todo, CONCURRENCY, async (author) => {
    try {
      const { data: recent } = await sb
        .from("content_posts")
        .select("caption")
        .eq("platform", platform)
        .eq("author_handle", author.handle)
        .order("posted_at", { ascending: false })
        .limit(6);
      const { object } = await generateObject({
        model: openai(COUNTRY_MODEL()),
        schema: CountrySchema,
        temperature: 0,
        prompt: countryPrompt({
          platform,
          handle: author.handle,
          name: author.full_name,
          website: author.website,
          bio: author.biography,
          captions: (recent ?? []).map((r) => ((r.caption as string) ?? "").slice(0, 700)),
        }),
      });
      const { country, source } = countryToStore(object);
      const { error: updateError } = await sb
        .from("content_authors")
        .update({ country, country_source: source })
        .eq("platform", platform)
        .eq("handle", author.handle);
      if (updateError) return "failed" as const;
      return country ? ("inferred" as const) : ("unknown" as const);
    } catch (err) {
      console.warn(`[country] no pude inferir @${author.handle}:`, (err as Error)?.message ?? err);
      return "failed" as const;
    }
  });
  return {
    inferred: results.filter((r) => r === "inferred").length,
    unknown: results.filter((r) => r === "unknown").length,
    failed: results.filter((r) => r === "failed").length,
  };
}
