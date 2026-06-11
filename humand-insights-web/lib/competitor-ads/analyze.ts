import { generateObject, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import { getPg } from "@/lib/supabase/pg";
import { loadAdsForCompetitor, type StoredAd } from "./store";
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

// Objetivo inferido del CTA + copy (clasificación confiable; reemplaza al funnel,
// que el equipo considera demasiado subjetivo para ads de competidores).
const GOALS = ["lead_gen", "demo", "descarga", "contenido", "trafico", "otro"] as const;
// Qué tipo de pieza es (Laura pidió contar casos de éxito / webinars / eventos).
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
      "Objetivo según CTA + copy: lead_gen (contacto/registro/cotizar), demo (agendar/ver demo), " +
        "descarga (bajar material), contenido (learn/read/watch more → blog/awareness), trafico (ir al sitio), otro",
    ),
  content_type: z.enum(CONTENT_TYPES).describe("Qué tipo de pieza es"),
  related_pains: z
    .array(z.string())
    .describe("Pains de NUESTRA taxonomía a los que apunta este aviso (de la lista provista). Vacío si ninguno."),
});

const SynthesisSchema = z.object({
  summary: z.string().describe("2-3 frases: qué está comunicando este competidor en general"),
  angles: z.array(AngleSchema).describe("4-6 ángulos de mensaje ordenados por peso desc"),
  offer_types: z
    .array(z.string())
    .describe("Tipos de oferta detectados: ej. 'Lead magnet (guías)', 'Webinar/evento', 'Demo/producto', 'Calculadora de precios'"),
  classifications: z
    .array(ClassificationSchema)
    .describe("UNA entrada por CADA aviso de la lista (por su #), clasificándolo individualmente"),
});

type Tally = { key: string; count: number };
type PerAd = {
  ad_archive_id: string;
  collation_id: string | null;
  goal: (typeof GOALS)[number];
  content_type: (typeof CONTENT_TYPES)[number];
  related_pains: string[];
  creative_text: string | null;
};

export type AdSynthesis = Omit<z.infer<typeof SynthesisSchema>, "classifications"> & {
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

/** Una campaña por collation_id (dedupe de variantes del mismo aviso). */
function dedupeCampaigns(ads: StoredAd[]): StoredAd[] {
  const seen = new Set<string>();
  const out: StoredAd[] = [];
  for (const a of ads) {
    const key = a.collation_id ?? a.ad_archive_id;
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

// ─── Visión: leer el texto incrustado en el creativo ─────────────────────────
// En muchos avisos (sobre todo video/DCO) el mensaje está EN la imagen, no en
// el copy. Bajamos los bytes server-side (fbcdn bloquea hotlink, OpenAI no
// podría traerla por URL) y se la pasamos al modelo con visión.

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

async function extractCreativeText(imageUrl: string): Promise<string | null> {
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

/** Texto del creativo por campaña (key = collation_id ?? ad_archive_id). */
async function extractCreativeTexts(campaigns: StoredAd[], limit: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const targets = campaigns.filter((c) => c.media?.images?.[0]);
  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      const c = targets[i++];
      const txt = await extractCreativeText(c.media.images[0]);
      if (txt) out.set(c.collation_id ?? c.ad_archive_id, txt);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
  return out;
}

/**
 * Analiza los avisos guardados de un competidor y devuelve la síntesis
 * (ángulos + pains mapeados + ofertas). No persiste — el caller decide.
 */
export async function analyzeCompetitor(
  competitor: string,
  source: AdSource,
): Promise<AdSynthesis | null> {
  const all = await loadAdsForCompetitor(competitor, source);
  if (!all.length) return null;

  // Analizamos todas las campañas (guarda alta por las dudas con competidores
  // muy grandes; para los actuales = todas).
  const campaigns = dedupeCampaigns(all).slice(0, 80);
  const [painVocab, creatives] = await Promise.all([
    loadPainVocab(),
    extractCreativeTexts(campaigns, 4),
  ]);

  const adsBlock = campaigns
    .map((c, i) => {
      const cr = creatives.get(c.collation_id ?? c.ad_archive_id);
      const parts = [
        `#${i + 1}`,
        c.title ? `título: ${c.title}` : "",
        c.body_text ? `copy: ${c.body_text.replace(/\s+/g, " ").slice(0, 400)}` : "",
        cr ? `texto en creativo: ${cr}` : "",
        c.cta_text ? `cta: ${c.cta_text}` : "",
        c.display_format ? `formato: ${c.display_format}` : "",
        linkDomain(c.link_url) ? `destino: ${linkDomain(c.link_url)}` : "",
      ].filter(Boolean);
      return parts.join(" · ");
    })
    .join("\n");

  const system = [
    "Sos un analista de inteligencia competitiva B2B (software de RRHH).",
    "Te paso los avisos publicitarios ACTIVOS de un competidor (uno por campaña, numerados con #).",
    "Tenés DOS tareas:",
    "(1) SÍNTESIS: agrupá los copies en 4-6 ÁNGULOS de mensaje (no listes anuncio por anuncio).",
    "Para cada ángulo estimá su peso (cuántas campañas lo usan) y mapeá a qué dolores apunta",
    "USANDO EXCLUSIVAMENTE la lista de pains provista (si ninguno aplica, dejá vacío).",
    "(2) CLASIFICACIÓN: clasificá CADA aviso individualmente por su # — su objetivo (goal, inferido del CTA + copy),",
    "su tipo de contenido (content_type) y los pains a los que apunta. Devolvé una entrada por cada #.",
    "El campo 'texto en creativo' es lo que aparece DENTRO de la imagen/video del aviso (suele tener el mensaje real):",
    "usalo junto al copy para los ángulos y la clasificación.",
    "Las citas de ejemplo deben ser textuales de los copies. No inventes nada que no esté en los avisos.",
    "Respondé en español rioplatense.",
  ].join(" ");

  const prompt = [
    `COMPETIDOR: ${competitor}`,
    painVocab.length
      ? `PAINS DE NUESTRA TAXONOMÍA (mapeá related_pains solo a estos):\n${painVocab.join(", ")}`
      : "PAINS DE NUESTRA TAXONOMÍA: (no disponible — dejá related_pains vacío)",
    "",
    `AVISOS (${campaigns.length} campañas):`,
    adsBlock,
  ].join("\n");

  const { object } = await generateObject({
    model: openai(adsModel()),
    schema: SynthesisSchema,
    system,
    prompt,
  });

  // Mapeo defensivo #→clasificación (el modelo podría saltarse alguno).
  const byIndex = new Map<number, z.infer<typeof ClassificationSchema>>();
  for (const c of object.classifications ?? []) byIndex.set(c.ad_index, c);

  const per_ad: PerAd[] = campaigns.map((camp, i) => {
    const cls = byIndex.get(i + 1);
    return {
      ad_archive_id: camp.ad_archive_id,
      collation_id: camp.collation_id,
      goal: cls?.goal ?? "otro",
      content_type: cls?.content_type ?? "generico",
      related_pains: cls?.related_pains ?? [],
      creative_text: creatives.get(camp.collation_id ?? camp.ad_archive_id) ?? null,
    };
  });

  const { classifications: _drop, ...synthesis } = object;
  return {
    ...synthesis,
    ads_analyzed: campaigns.length,
    per_ad,
    by_goal: tally(per_ad.map((p) => p.goal)),
    by_content_type: tally(per_ad.map((p) => p.content_type)),
  };
}
