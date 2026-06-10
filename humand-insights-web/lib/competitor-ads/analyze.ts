import { generateObject } from "ai";
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

const SynthesisSchema = z.object({
  summary: z.string().describe("2-3 frases: qué está comunicando este competidor en general"),
  angles: z.array(AngleSchema).describe("4-6 ángulos de mensaje ordenados por peso desc"),
  offer_types: z
    .array(z.string())
    .describe("Tipos de oferta detectados: ej. 'Lead magnet (guías)', 'Webinar/evento', 'Demo/producto', 'Calculadora de precios'"),
});

export type AdSynthesis = z.infer<typeof SynthesisSchema> & { ads_analyzed: number };

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

  const campaigns = dedupeCampaigns(all).slice(0, 40);
  const painVocab = await loadPainVocab();

  const adsBlock = campaigns
    .map((c, i) => {
      const parts = [
        `#${i + 1}`,
        c.title ? `título: ${c.title}` : "",
        c.body_text ? `copy: ${c.body_text.replace(/\s+/g, " ").slice(0, 400)}` : "",
        c.cta_text ? `cta: ${c.cta_text}` : "",
        c.display_format ? `formato: ${c.display_format}` : "",
        linkDomain(c.link_url) ? `destino: ${linkDomain(c.link_url)}` : "",
      ].filter(Boolean);
      return parts.join(" · ");
    })
    .join("\n");

  const system = [
    "Sos un analista de inteligencia competitiva B2B (software de RRHH).",
    "Te paso los avisos publicitarios ACTIVOS de un competidor (uno por campaña).",
    "Tu trabajo: sintetizar qué está comunicando — agrupá los copies en 4-6 ÁNGULOS de mensaje,",
    "no listes anuncio por anuncio. Para cada ángulo estimá su peso (cuántas campañas lo usan)",
    "y mapeá a qué dolores apunta USANDO EXCLUSIVAMENTE la lista de pains provista (si ninguno aplica, dejá vacío).",
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

  return { ...object, ads_analyzed: campaigns.length };
}
