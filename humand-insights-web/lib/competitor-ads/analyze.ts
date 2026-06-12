import { generateObject, generateText, experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import { getPg } from "@/lib/supabase/pg";
import { loadAdsForCompetitor, loadAdInsight, saveAdAnalysis, type StoredAd } from "./store";
import type { AdSource } from "./types";

const AngleSchema = z.object({
  label: z.string().describe("Nombre corto del ángulo/mensaje (3-5 palabras)"),
  description: z.string().describe("Una frase explicando el ángulo"),
  weight: z.number().describe("Cuántas campañas usan este ángulo (de las analizadas)"),
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
};

export type AdSynthesis = z.infer<typeof SynthesisSchema> & {
  ads_analyzed: number;
  per_ad: PerAd[];
  by_goal: Tally[];
  by_content_type: Tally[];
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

/**
 * Texto/voz del creativo por campaña (key = collation_id ?? ad_archive_id).
 * Video → transcripción del audio (fallback OCR del poster). Estático → OCR.
 */
async function extractCreativeTexts(campaigns: StoredAd[], limit: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const targets = campaigns.filter((c) => c.media?.videos?.[0] || c.media?.images?.[0]);
  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      const c = targets[i++];
      let txt: string | null = null;
      const video = c.media?.videos?.[0];
      if (video) txt = await transcribeVideo(video);
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
async function classifyAds(
  pending: StoredAd[],
  painVocab: string[],
  creativeOf: (c: StoredAd) => string | null,
): Promise<Map<string, { goal: string; content_type: string; related_pains: string[] }>> {
  const out = new Map<string, { goal: string; content_type: string; related_pains: string[] }>();
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
      out.set(campaignKey(camp), {
        goal: c.goal,
        content_type: c.content_type,
        related_pains: c.related_pains ?? [],
      });
    }
  }
  return out;
}

/** Síntesis agregada (ángulos / resumen / ofertas) sobre TODAS las campañas. */
async function synthesize(
  competitor: string,
  campaigns: StoredAd[],
  painVocab: string[],
  creativeOf: (c: StoredAd) => string | null,
): Promise<z.infer<typeof SynthesisSchema>> {
  const system = [
    "Sos un analista de inteligencia competitiva B2B (software de RRHH).",
    "Agrupá los avisos en 4-6 ÁNGULOS de mensaje (no listes anuncio por anuncio).",
    "Para cada ángulo estimá su peso (cuántas campañas lo usan) y mapeá a qué dolores apunta",
    "USANDO EXCLUSIVAMENTE la lista de pains provista (si ninguno aplica, dejá vacío).",
    CREATIVE_NOTE,
    "Las citas de ejemplo deben ser textuales. No inventes nada. Respondé en español rioplatense.",
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

/**
 * Analiza los avisos de un competidor reusando el cache por aviso:
 *  - solo procesa (transcripción/OCR + clasificación) los avisos NUEVOS,
 *  - reusa la síntesis guardada si no cambió el set de avisos.
 */
export async function analyzeCompetitor(
  competitor: string,
  source: AdSource,
): Promise<AdSynthesis | null> {
  const all = await loadAdsForCompetitor(competitor, source);
  if (!all.length) return null;

  const campaigns = dedupeCampaigns(all).slice(0, 80);
  const painVocab = await loadPainVocab();

  // Nuevos = sin análisis cacheado.
  const pending = campaigns.filter((c) => !c.analysis);

  if (pending.length) {
    const fresh = await extractCreativeTexts(pending, 4);
    const creativeOf = (c: StoredAd) => fresh.get(campaignKey(c)) ?? null;
    const cls = await classifyAds(pending, painVocab, creativeOf);
    // Persistir y aplicar en memoria.
    await Promise.all(
      pending.map(async (c) => {
        const k = campaignKey(c);
        const analysis = {
          creative_text: fresh.get(k) ?? null,
          goal: cls.get(k)?.goal ?? "otro",
          content_type: cls.get(k)?.content_type ?? "generico",
          related_pains: cls.get(k)?.related_pains ?? [],
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
  }));

  // Síntesis: regenerar solo si hubo avisos nuevos o cambió la cantidad; si no,
  // reusar la guardada (refresh repetido sin cambios = 0 llamadas al LLM).
  const stored = (await loadAdInsight(competitor, source)) as AdSynthesis | null;
  const validStored = stored && Array.isArray(stored.angles);
  const changed = pending.length > 0 || !validStored || stored.ads_analyzed !== campaigns.length;

  const synth = changed
    ? await synthesize(competitor, campaigns, painVocab, (c) => c.analysis?.creative_text ?? null)
    : { summary: stored.summary, angles: stored.angles, offer_types: stored.offer_types };

  return {
    ...synth,
    ads_analyzed: campaigns.length,
    per_ad,
    by_goal: tally(per_ad.map((p) => p.goal)),
    by_content_type: tally(per_ad.map((p) => p.content_type)),
  };
}
