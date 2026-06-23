import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { generateObject, generateText, experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import { getPg } from "@/lib/supabase/pg";
import { loadAdsForCompetitor, loadAdInsight, saveAdAnalysis, type StoredAd } from "./store";
import type { AdSource } from "./types";

const execFileAsync = promisify(execFile);

const AngleSchema = z.object({
  label: z.string().describe("Nombre corto del ángulo/mensaje (3-5 palabras)"),
  description: z.string().describe("Una frase explicando el ángulo"),
  weight: z.number().describe("Cuántas campañas usan este ángulo (de las analizadas)"),
  ad_indices: z
    .array(z.number().int())
    .describe("Los # (de la lista de avisos) que usan este ángulo. Imprescindible para ubicar las campañas."),
  related_pains: z
    .array(z.string())
    .describe("Pains de NUESTRA taxonomía a los que apunta (de la lista provista). Vacío si ninguno aplica."),
  example_copies: z.array(z.string()).describe("1-2 citas textuales de copies que ejemplifican el ángulo"),
});

// Objetivo inferido del CTA + copy + creativo (reemplaza al funnel).
const GOALS = ["lead_gen", "demo", "descarga", "contenido", "trafico", "otro"] as const;
const CONTENT_TYPES = [
  "caso_exito",
  "webinar",
  "evento",
  "demo_producto",
  "guia_descargable",
  "calculadora",
  "blog_articulo",
  "lanzamiento_feature",
  "generico",
] as const;

const ClassificationSchema = z.object({
  ad_index: z.number().int().describe("El número # del aviso en la lista (empieza en 1)"),
  goal: z
    .enum(GOALS)
    .describe(
      "Objetivo según CTA + copy + creativo: lead_gen (contacto/registro/cotizar), demo (agendar/ver demo), " +
        "descarga (bajar material), contenido (learn/read/watch more → blog/awareness), trafico (ir al sitio), otro",
    ),
  content_type: z.enum(CONTENT_TYPES).describe("Qué tipo de pieza es"),
  related_pains: z
    .array(z.string())
    .describe("Pains de NUESTRA taxonomía a los que apunta este aviso (de la lista provista). Vacío si ninguno."),
  persona: z
    .string()
    .describe(
      "A quién le habla el aviso, conciso (ej. 'Gerente de RRHH', 'Finanzas', 'Dueño de pyme', " +
        "'Consultora RRHH', 'Equipo de payroll'). '—' si no se puede inferir.",
    ),
  modules: z
    .array(z.string())
    .describe(
      "Módulos de producto que menciona (ej. remuneraciones, control de asistencia, firma digital, " +
        "finanzas, gestión del desempeño, reclutamiento, capacitación, beneficios). Vacío si ninguno.",
    ),
});

const ClassifyListSchema = z.object({
  classifications: z.array(ClassificationSchema).describe("UNA entrada por CADA aviso de la lista (por su #)"),
});

const SynthesisSchema = z.object({
  summary: z.string().describe("2-3 frases: qué está comunicando este competidor en general"),
  angles: z.array(AngleSchema).describe("4-6 ángulos de mensaje ordenados por peso desc"),
  offer_types: z
    .array(z.string())
    .describe("Tipos de oferta detectados: ej. 'Lead magnet (guías)', 'Webinar/evento', 'Demo/producto', 'Calculadora de precios'"),
});

type Tally = { key: string; count: number };
type PerAd = {
  ad_archive_id: string;
  collation_id: string | null;
  goal: string;
  content_type: string;
  related_pains: string[];
  creative_text: string | null;
  persona: string | null;
  modules: string[];
};

// El ángulo guardado: sin ad_indices (interno) + la fecha del más antiguo.
type AngleOut = Omit<z.infer<typeof AngleSchema>, "ad_indices"> & { oldest_start: string | null };

export type SynthesisTranslation = {
  summary: string;
  angles: { label: string; description: string; example_copies: string[] }[];
  offer_types: string[];
};

export type AdSynthesis = {
  summary: string;
  angles: AngleOut[];
  offer_types: string[];
  ads_analyzed: number;
  per_ad: PerAd[];
  by_goal: Tally[];
  by_content_type: Tally[];
  by_module: Tally[];
  by_persona: Tally[];
  /** Traducciones de los campos textuales (summary, angle labels/descriptions/copies). */
  i18n?: Record<string, SynthesisTranslation>;
};

function tally(items: string[]): Tally[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

function linkDomain(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const campaignKey = (c: StoredAd) => c.collation_id ?? c.ad_archive_id;

/** Una campaña por collation_id (dedupe de variantes del mismo aviso). */
function dedupeCampaigns(ads: StoredAd[]): StoredAd[] {
  const seen = new Set<string>();
  const out: StoredAd[] = [];
  for (const a of ads) {
    const key = campaignKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Vocabulario de pains nuestro, para que el modelo mapee a la taxonomía real. */
async function loadPainVocab(): Promise<string[]> {
  const sql = getPg();
  try {
    const rows = await sql<{ pain: string }[]>`
      SELECT DISTINCT insight_subtype_display AS pain
      FROM mv_insights_norm
      WHERE insight_type = 'pain' AND prompt_version = 'v3.0'
        AND insight_subtype_display IS NOT NULL
      LIMIT 60
    `;
    return rows.map((r) => r.pain).filter(Boolean);
  } catch {
    return [];
  }
}

export function adsModel(): string {
  return process.env.COMPETITOR_ADS_MODEL ?? process.env.ASK_CHART_MODEL ?? "gpt-4o-mini";
}

// ─── Visión / transcripción: leer el texto/voz del creativo ──────────────────
// En muchos avisos el mensaje está EN el creativo, no en el copy. Bajamos los
// bytes server-side (fbcdn bloquea hotlink) y se los damos al modelo.

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "image/*,*/*" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function extractImageText(imageUrl: string): Promise<string | null> {
  const bytes = await fetchImageBytes(imageUrl);
  if (!bytes) return null;
  try {
    const { text } = await generateText({
      model: openai(adsModel()),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Este es el creativo de un anuncio. Transcribí TEXTUALMENTE el texto incrustado " +
                "en la imagen (headline, claims, oferta, CTA visible). Si no hay texto legible, " +
                "respondé exactamente '—'. Máximo 240 caracteres, sin comentarios tuyos.",
            },
            { type: "image", image: bytes },
          ],
        },
      ],
    });
    const t = text.trim();
    return t && t !== "—" ? t.slice(0, 240) : null;
  } catch {
    return null;
  }
}

function transcribeModel(): string {
  // whisper-1 acepta el contenedor video/mp4 (extrae el audio); los modelos
  // gpt-4o-*-transcribe rechazan mp4 ("model does not support the format").
  return process.env.COMPETITOR_ADS_TRANSCRIBE_MODEL ?? "whisper-1";
}

// Límite de la API de transcripción de OpenAI: 25MB.
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

async function fetchVideoBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "video/*,*/*" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len > MAX_VIDEO_BYTES) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_VIDEO_BYTES) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function transcribeVideo(url: string): Promise<string | null> {
  const bytes = await fetchVideoBytes(url);
  if (!bytes) return null;
  try {
    const { text } = await transcribe({ model: openai.transcription(transcribeModel()), audio: bytes });
    const t = text.replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 600) : null;
  } catch {
    return null;
  }
}

async function probeVideoDuration(input: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      input,
    ]);
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

async function extractVideoFrames(url: string, maxFrames = 5): Promise<Uint8Array[]> {
  const bytes = await fetchVideoBytes(url);
  if (!bytes) return [];

  const dir = await mkdtemp(path.join(tmpdir(), "competitor-ad-video-"));
  try {
    const input = path.join(dir, "input.mp4");
    await writeFile(input, bytes);

    const duration = await probeVideoDuration(input);
    let times: number[];
    if (!duration) {
      // Duración desconocida: muestreo denso al inicio donde suelen estar los claims principales.
      times = [0.3, 1, 2, 4, 6, 9].slice(0, maxFrames);
    } else if (duration < 10) {
      // Ads cortos: más agresivo al inicio (headline en primeros 2s).
      times = [0.05, 0.2, 0.4, 0.65, 0.9].slice(0, maxFrames).map((r) => Math.max(0.1, duration * r));
    } else if (duration <= 30) {
      // Rango estándar: distribución uniforme funciona bien.
      times = [0.12, 0.3, 0.5, 0.7, 0.88].slice(0, maxFrames).map((r) => Math.max(0.1, duration * r));
    } else {
      // Ads largos (>30s): primer tercio más denso + frame extra.
      const cap = Math.max(maxFrames, 6);
      times = [0.05, 0.15, 0.35, 0.6, 0.85].slice(0, cap).map((r) => Math.max(0.1, duration * r));
    }
    const frames: Uint8Array[] = [];

    for (let index = 0; index < times.length; index++) {
      const out = path.join(dir, `frame-${index}.jpg`);
      try {
        await execFileAsync("ffmpeg", [
          "-y",
          "-ss",
          times[index].toFixed(2),
          "-i",
          input,
          "-frames:v",
          "1",
          "-vf",
          "scale=960:-2:force_original_aspect_ratio=decrease",
          "-q:v",
          "3",
          out,
        ]);
        frames.push(new Uint8Array(await readFile(out)));
      } catch {
        // Si un timestamp cae fuera del video o ffmpeg falla, seguimos con el resto.
      }
    }

    return frames;
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractVideoFrameText(videoUrl: string, posterUrl?: string | null): Promise<string | null> {
  const frames = await extractVideoFrames(videoUrl);
  if (!frames.length) return posterUrl ? extractImageText(posterUrl) : null;

  try {
    const { text } = await generateText({
      model: openai(adsModel()),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Estos frames pertenecen a un video publicitario sin narración clara. " +
                "Transcribí y consolidá el texto visible que aparece en pantalla, en orden lógico. " +
                "Deducí repeticiones entre frames y conservá claims, beneficios y CTA. " +
                "Si no hay texto legible, respondé exactamente '—'. Máximo 500 caracteres, sin comentarios.",
            },
            ...frames.map((frame) => ({ type: "image" as const, image: frame })),
          ],
        },
      ],
    });
    const t = text.replace(/\s+/g, " ").trim();
    return t && t !== "—" ? t.slice(0, 500) : null;
  } catch {
    return posterUrl ? extractImageText(posterUrl) : null;
  }
}

/**
 * Valida la transcripción: whisper ALUCINA con audio sin habla (música/silencio)
 * → inventa frases ("Subtítulos de Amara.org", repeticiones, etc.). Si el texto
 * no es contenido publicitario real, devolvemos null para caer al OCR del frame.
 */
async function validateTranscript(raw: string, competitor: string): Promise<string | null> {
  const t = raw.trim();
  if (t.length < 12) return null; // muy corto → no aporta
  try {
    const { text } = await generateText({
      model: openai(adsModel()),
      system:
        "Recibís la transcripción del audio de un anuncio. Si es contenido publicitario con sentido " +
        "(habla del producto, oferta, beneficios, CTA), devolvelo TAL CUAL. Si es música, ruido, silencio, " +
        "repeticiones sin sentido o frases sin relación con un anuncio (alucinaciones típicas de transcripción), " +
        "devolvé EXACTAMENTE '—'. Sin comentarios ni explicaciones. " +
        `IMPORTANTE: corregí cualquier variante fonética del nombre de la marca "${competitor}" ` +
        `(la transcripción suele escribirlo mal, ej. Book/Booth/Buck/Bug por Buk) y escribilo siempre como "${competitor}".`,
      prompt: t.slice(0, 800),
    });
    const out = text.trim();
    return out && out !== "—" ? out.slice(0, 600) : null;
  } catch {
    return t.slice(0, 600); // si el juez falla, conservamos el crudo
  }
}

/**
 * Texto/voz del creativo por campaña (key = collation_id ?? ad_archive_id).
 * Video → transcripción del audio (fallback OCR del poster). Estático → OCR.
 */
async function extractCreativeTexts(
  competitor: string,
  campaigns: StoredAd[],
  limit: number,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const targets = campaigns.filter((c) => c.media?.videos?.[0] || c.media?.images?.[0]);
  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      const c = targets[i++];
      let txt: string | null = null;
      const video = c.media?.videos?.[0];
      if (video) {
        const raw = await transcribeVideo(video);
        // Filtra música/silencio/alucinaciones; si no dice nada relevante → null.
        txt = raw ? await validateTranscript(raw, competitor) : null;
      }
      // Video sin habla relevante → OCR multi-frame; estático → OCR de imagen.
      if (!txt && video) txt = await extractVideoFrameText(video, c.media?.images?.[0] ?? null);
      if (!txt && c.media?.images?.[0]) txt = await extractImageText(c.media.images[0]);
      if (txt) out.set(campaignKey(c), txt);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
  return out;
}

// ─── Bloques de prompt ───────────────────────────────────────────────────────

function buildBlock(campaigns: StoredAd[], creativeOf: (c: StoredAd) => string | null): string {
  return campaigns
    .map((c, i) => {
      const cr = creativeOf(c);
      const parts = [
        `#${i + 1}`,
        c.title ? `título: ${c.title}` : "",
        c.body_text ? `copy: ${c.body_text.replace(/\s+/g, " ").slice(0, 400)}` : "",
        cr ? `texto/voz del creativo: ${cr}` : "",
        c.cta_text ? `cta: ${c.cta_text}` : "",
        c.display_format ? `formato: ${c.display_format}` : "",
        linkDomain(c.link_url) ? `destino: ${linkDomain(c.link_url)}` : "",
      ].filter(Boolean);
      return parts.join(" · ");
    })
    .join("\n");
}

function painsLine(painVocab: string[]): string {
  return painVocab.length
    ? `PAINS DE NUESTRA TAXONOMÍA (mapeá related_pains solo a estos):\n${painVocab.join(", ")}`
    : "PAINS DE NUESTRA TAXONOMÍA: (no disponible — dejá related_pains vacío)";
}

const CREATIVE_NOTE =
  "El campo 'texto/voz del creativo' es lo que aparece DENTRO de la imagen o lo que se DICE en el video " +
  "(suele tener el mensaje real): usalo junto al copy.";

/** Clasifica SOLO los avisos nuevos (incremental). key → clasificación. */
type Classification = {
  goal: string;
  content_type: string;
  related_pains: string[];
  persona: string | null;
  modules: string[];
};

async function classifyAds(
  pending: StoredAd[],
  painVocab: string[],
  creativeOf: (c: StoredAd) => string | null,
): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  if (!pending.length) return out;

  const system = [
    "Sos un analista de inteligencia competitiva B2B (software de RRHH).",
    "Clasificá CADA aviso por su # — objetivo (goal, inferido de CTA + copy + creativo),",
    "tipo de contenido (content_type) y los pains a los que apunta (solo de la lista).",
    CREATIVE_NOTE,
    "Devolvé una entrada por cada #. No inventes nada que no esté en los avisos.",
  ].join(" ");
  const prompt = [painsLine(painVocab), "", `AVISOS (${pending.length}):`, buildBlock(pending, creativeOf)].join("\n");

  const { object } = await generateObject({ model: openai(adsModel()), schema: ClassifyListSchema, system, prompt });
  for (const c of object.classifications ?? []) {
    const camp = pending[c.ad_index - 1];
    if (camp) {
      const persona = (c.persona ?? "").trim();
      out.set(campaignKey(camp), {
        goal: c.goal,
        content_type: c.content_type,
        related_pains: c.related_pains ?? [],
        persona: persona && persona !== "—" ? persona : null,
        modules: c.modules ?? [],
      });
    }
  }
  return out;
}

/** Síntesis agregada (ángulos / resumen / ofertas) sobre TODAS las campañas. */
const LANGUAGE_INSTRUCTION: Record<string, string> = {
  "es-AR": "Respondé en español rioplatense.",
  "es-LATAM": "Respondé en español latinoamericano.",
  "pt-BR": "Responda em português do Brasil.",
  "en-US": "Respond in English.",
};

async function synthesize(
  competitor: string,
  campaigns: StoredAd[],
  painVocab: string[],
  creativeOf: (c: StoredAd) => string | null,
  language = "es-AR",
): Promise<z.infer<typeof SynthesisSchema>> {
  const langInstruction = LANGUAGE_INSTRUCTION[language] ?? LANGUAGE_INSTRUCTION["es-AR"];
  const system = [
    "Sos un analista de inteligencia competitiva B2B (software de RRHH).",
    "Agrupá los avisos en 4-6 ÁNGULOS de mensaje (no listes anuncio por anuncio).",
    "Para cada ángulo: estimá su peso (cuántas campañas lo usan), listá en ad_indices los # de los avisos",
    "que lo usan, y mapeá a qué dolores apunta USANDO EXCLUSIVAMENTE la lista de pains provista (vacío si ninguno).",
    CREATIVE_NOTE,
    `Las citas de ejemplo deben ser textuales. No inventes nada. ${langInstruction}`,
  ].join(" ");
  const prompt = [
    `COMPETIDOR: ${competitor}`,
    painsLine(painVocab),
    "",
    `AVISOS (${campaigns.length} campañas):`,
    buildBlock(campaigns, creativeOf),
  ].join("\n");

  const { object } = await generateObject({ model: openai(adsModel()), schema: SynthesisSchema, system, prompt });
  return object;
}

const TranslationSchema = z.object({
  summary: z.string(),
  angles: z.array(z.object({
    label: z.string(),
    description: z.string(),
    example_copies: z.array(z.string()),
  })),
  offer_types: z.array(z.string()),
});

const TRANSLATE_INSTRUCTION: Record<string, string> = {
  "pt-BR": "Translate the following competitive analysis into Brazilian Portuguese (pt-BR). Keep brand names, pain labels, and product module names as-is.",
  "en-US": "Translate the following competitive analysis into English (en-US). Keep brand names, pain labels, and product module names as-is.",
  "es-AR": "Translate the following competitive analysis into Rioplatense Spanish (es-AR). Keep brand names, pain labels, and product module names as-is.",
};

async function translateSynthesis(
  synth: z.infer<typeof SynthesisSchema>,
  targetLocale: string,
): Promise<SynthesisTranslation | null> {
  const instruction = TRANSLATE_INSTRUCTION[targetLocale];
  if (!instruction) return null;
  try {
    const input = JSON.stringify({
      summary: synth.summary,
      angles: synth.angles.map((a) => ({ label: a.label, description: a.description, example_copies: a.example_copies })),
      offer_types: synth.offer_types,
    });
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: TranslationSchema,
      system: instruction,
      prompt: input,
    });
    return object;
  } catch {
    return null;
  }
}

/**
 * Analiza los avisos de un competidor reusando el cache por aviso:
 *  - solo procesa (transcripción/OCR + clasificación) los avisos NUEVOS,
 *  - reusa la síntesis guardada si no cambió el set de avisos.
 */
export async function analyzeCompetitor(
  competitor: string,
  source: AdSource,
  opts: { force?: boolean; language?: string } = {},
): Promise<AdSynthesis | null> {
  const all = await loadAdsForCompetitor(competitor, source);
  if (!all.length) return null;

  const campaigns = dedupeCampaigns(all).slice(0, 80);
  const painVocab = await loadPainVocab();

  // Nuevos = sin análisis cacheado. force = re-analizar TODO (ignora el cache).
  const pending = opts.force ? campaigns : campaigns.filter((c) => !c.analysis);

  if (pending.length) {
    const fresh = await extractCreativeTexts(competitor, pending, 4);
    const creativeOf = (c: StoredAd) => fresh.get(campaignKey(c)) ?? null;
    const cls = await classifyAds(pending, painVocab, creativeOf);
    // Persistir y aplicar en memoria.
    await Promise.all(
      pending.map(async (c) => {
        const k = campaignKey(c);
        const cl = cls.get(k);
        const analysis = {
          creative_text: fresh.get(k) ?? null,
          goal: cl?.goal ?? "otro",
          content_type: cl?.content_type ?? "generico",
          related_pains: cl?.related_pains ?? [],
          persona: cl?.persona ?? null,
          modules: cl?.modules ?? [],
        };
        c.analysis = analysis;
        await saveAdAnalysis(c.ad_archive_id, source, analysis);
      }),
    );
  }

  // per_ad + agregados salen del cache (cero LLM).
  const per_ad: PerAd[] = campaigns.map((c) => ({
    ad_archive_id: c.ad_archive_id,
    collation_id: c.collation_id,
    goal: c.analysis?.goal ?? "otro",
    content_type: c.analysis?.content_type ?? "generico",
    related_pains: c.analysis?.related_pains ?? [],
    creative_text: c.analysis?.creative_text ?? null,
    persona: c.analysis?.persona ?? null,
    modules: c.analysis?.modules ?? [],
  }));

  // Síntesis: regenerar solo si hubo avisos nuevos o cambió la cantidad; si no,
  // reusar la guardada (refresh repetido sin cambios = 0 llamadas al LLM).
  const stored = (await loadAdInsight(competitor, source)) as AdSynthesis | null;
  const validStored = stored && Array.isArray(stored.angles);
  const changed = opts.force || pending.length > 0 || !validStored || stored.ads_analyzed !== campaigns.length;

  let summary: string;
  let offer_types: string[];
  let angles: AngleOut[];
  let i18n: AdSynthesis["i18n"] | undefined;
  if (changed) {
    const primaryLang = opts.language ?? "es-AR";
    const synth = await synthesize(competitor, campaigns, painVocab, (c) => c.analysis?.creative_text ?? null, primaryLang);
    summary = synth.summary;
    offer_types = synth.offer_types;
    // Fecha del aviso más antiguo de cada ángulo (a partir de sus ad_indices).
    angles = synth.angles.map((a) => {
      const { ad_indices, ...rest } = a;
      const dates = (ad_indices ?? [])
        .map((i) => campaigns[i - 1]?.ad_start_date)
        .filter((d): d is string => Boolean(d));
      const oldest_start = dates.length ? dates.reduce((m, d) => (d < m ? d : m)) : null;
      return { ...rest, oldest_start };
    });
    // Traducir a los otros dos idiomas en paralelo.
    const otherLocales = (["es-AR", "pt-BR", "en-US"] as const).filter((l) => l !== primaryLang);
    const translations = await Promise.all(otherLocales.map((l) => translateSynthesis(synth, l)));
    i18n = Object.fromEntries(
      otherLocales.map((l, idx) => [l, translations[idx]]).filter(([, v]) => v !== null),
    ) as AdSynthesis["i18n"];
    // Guardar también el idioma principal en i18n para que el frontend pueda
    // picar sin necesidad de conocer el idioma original.
    i18n = {
      ...i18n,
      [primaryLang]: { summary, angles: angles.map((a) => ({ label: a.label, description: a.description, example_copies: a.example_copies })), offer_types },
    };
  } else {
    summary = stored.summary;
    offer_types = stored.offer_types;
    angles = stored.angles;
    i18n = stored.i18n;
  }

  return {
    summary,
    angles,
    offer_types,
    ads_analyzed: campaigns.length,
    per_ad,
    by_goal: tally(per_ad.map((p) => p.goal)),
    by_content_type: tally(per_ad.map((p) => p.content_type)),
    by_module: tally(per_ad.flatMap((p) => p.modules)),
    by_persona: tally(per_ad.map((p) => p.persona).filter((p): p is string => Boolean(p))),
    i18n,
  };
}
