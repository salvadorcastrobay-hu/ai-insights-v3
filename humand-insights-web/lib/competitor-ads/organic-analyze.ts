/**
 * Análisis IA del contenido orgánico de Instagram.
 * Patrón incremental igual que analyze.ts: solo procesa posts sin cache;
 * reutiliza la síntesis si no hay cambios.
 */
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import {
  loadPostsForCompetitor,
  savePostAnalysis,
  type StoredPost,
  type OrganicSynthesis,
  type OrganicPostAnalysis,
  type Tally,
} from "./organic-store";

function organicModel(): string {
  return process.env.COMPETITOR_ADS_MODEL ?? process.env.ASK_CHART_MODEL ?? "gpt-4o-mini";
}

// ─── Per-post classification ──────────────────────────────────────────────────

const ORGANIC_CONTENT_TYPES = [
  "caso_exito",
  "producto",
  "educativo",
  "ugc",
  "entretenimiento",
  "comunidad",
  "evento",
  "otro",
] as const;

const ORGANIC_OBJECTIVES = [
  "awareness",
  "engagement",
  "educacion",
  "comunidad",
  "venta",
  "otro",
] as const;

const ClassifyPostSchema = z.object({
  post_index: z.number().int(),
  content_type: z.enum(ORGANIC_CONTENT_TYPES).describe(
    "caso_exito: testimonios/resultados de clientes. producto: demo/features. educativo: tips/guías. " +
    "ugc: contenido de usuarios. entretenimiento: humor/memes/cultura. comunidad: cultura interna/equipo. " +
    "evento: webinars/ferias/lanzamientos. otro: no encaja en ninguna.",
  ),
  objective: z.enum(ORGANIC_OBJECTIVES).describe(
    "awareness: visibilidad de marca. engagement: likes/comments/shares. " +
    "educacion: enseñar algo. comunidad: construir relación. venta: call to action directo. otro.",
  ),
  has_cta: z.boolean().describe("¿Tiene llamada a la acción en el caption?"),
  cta_type: z.string().nullable().describe(
    "Tipo de CTA: 'link_in_bio' | 'dm' | 'registrate' | 'otro'. Null si has_cta es false.",
  ),
});

const ClassifyListSchema = z.object({ posts: z.array(ClassifyPostSchema) });

async function classifyPosts(
  posts: StoredPost[],
): Promise<Map<string, OrganicPostAnalysis>> {
  if (!posts.length) return new Map();

  const lines = posts.map((p, i) => {
    const cap = (p.caption ?? "").slice(0, 300);
    const hashtags = p.hashtags.slice(0, 10).join(" ");
    const fmt = p.format ?? "unknown";
    return `POST ${i + 1} [${fmt}]: ${cap}${hashtags ? ` | hashtags: ${hashtags}` : ""}`;
  });

  const system =
    "Sos un analista de contenido de redes sociales B2B. " +
    "Clasificá cada post de Instagram según su tipo de contenido, objetivo, y si tiene CTA. " +
    "Devolvé un objeto por post, en el mismo orden.";

  const { object } = await generateObject({
    model: openai(organicModel()),
    schema: ClassifyListSchema,
    system,
    prompt: lines.join("\n"),
  });

  const result = new Map<string, OrganicPostAnalysis>();
  for (const item of object.posts) {
    const post = posts[item.post_index - 1];
    if (!post) continue;
    result.set(post.post_id, {
      content_type: item.content_type,
      objective: item.objective,
      has_cta: item.has_cta,
      cta_type: item.cta_type,
    });
  }
  return result;
}

// ─── Aggregated synthesis ─────────────────────────────────────────────────────

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function computeStats(posts: StoredPost[]): {
  posting_frequency: OrganicSynthesis["posting_frequency"];
  format_distribution: OrganicSynthesis["format_distribution"];
  posting_patterns: OrganicSynthesis["posting_patterns"];
  hashtag_strategy: OrganicSynthesis["hashtag_strategy"];
  best_performing: OrganicSynthesis["best_performing"];
} {
  const dated = posts.filter((p) => p.posted_at);

  // Frequency: window between oldest and newest post
  let posts_per_week = 0;
  let posts_per_month = 0;
  if (dated.length >= 2) {
    const dates = dated.map((p) => new Date(p.posted_at!).getTime()).sort((a, b) => a - b);
    const spanMs = dates[dates.length - 1] - dates[0];
    const spanDays = spanMs / 86_400_000;
    if (spanDays > 0) {
      posts_per_week = Math.round((dated.length / spanDays) * 7 * 10) / 10;
      posts_per_month = Math.round((dated.length / spanDays) * 30 * 10) / 10;
    }
  }

  // Format distribution
  const fmtCount: Record<string, number> = {};
  for (const p of posts) {
    const fmt = p.format ?? "otro";
    fmtCount[fmt] = (fmtCount[fmt] ?? 0) + 1;
  }

  // Posting patterns
  const by_day: Record<string, number> = {};
  const by_hour: Record<string, number> = {};
  for (const p of dated) {
    const d = new Date(p.posted_at!);
    const dayLabel = DAYS[d.getUTCDay()] ?? "?";
    by_day[dayLabel] = (by_day[dayLabel] ?? 0) + 1;
    const hour = String(d.getUTCHours()).padStart(2, "0") + ":00";
    by_hour[hour] = (by_hour[hour] ?? 0) + 1;
  }

  // Hashtag strategy
  const hashCount = new Map<string, number>();
  let totalHashtags = 0;
  for (const p of posts) {
    for (const h of p.hashtags) {
      hashCount.set(h, (hashCount.get(h) ?? 0) + 1);
    }
    totalHashtags += p.hashtags.length;
  }
  const top_hashtags = [...hashCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([h]) => h);
  const avg_per_post = posts.length ? Math.round((totalHashtags / posts.length) * 10) / 10 : 0;

  // Best performing by engagement (likes + comments)
  const best_performing = [...posts]
    .filter((p) => (p.likes_count ?? 0) + (p.comments_count ?? 0) > 0)
    .sort((a, b) => {
      const ea = (a.likes_count ?? 0) + (a.comments_count ?? 0);
      const eb = (b.likes_count ?? 0) + (b.comments_count ?? 0);
      return eb - ea;
    })
    .slice(0, 4)
    .map((p) => ({
      post_id: p.post_id,
      post_url: p.post_url,
      display_url: p.display_url,
      likes: p.likes_count ?? 0,
      comments: p.comments_count ?? 0,
      caption_snippet: (p.caption ?? "").slice(0, 120),
    }));

  return {
    posting_frequency: { posts_per_week, posts_per_month },
    format_distribution: fmtCount,
    posting_patterns: { by_day, by_hour },
    hashtag_strategy: { top_hashtags, avg_per_post },
    best_performing,
  };
}

function tally(items: string[]): Tally[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

const LANGUAGE_INSTRUCTION: Record<string, string> = {
  "es-AR": "Respondé en español rioplatense.",
  "pt-BR": "Responda em português do Brasil.",
  "en-US": "Respond in English.",
};

const OrganicSynthesisLLMSchema = z.object({
  summary: z.string().describe("2-3 oraciones describiendo la estrategia de contenido orgánico del competidor."),
  content_pillars: z.array(z.string()).describe(
    "3-5 pilares de contenido recurrentes (temas principales que el competidor prioriza orgánicamente).",
  ),
});

async function synthesizePillars(
  competitor: string,
  posts: StoredPost[],
  language = "es-AR",
): Promise<{ summary: string; content_pillars: string[] }> {
  const langInstruction = LANGUAGE_INSTRUCTION[language] ?? LANGUAGE_INSTRUCTION["es-AR"];
  const lines = posts
    .filter((p) => p.caption)
    .slice(0, 40)
    .map((p, i) => {
      const cap = (p.caption ?? "").slice(0, 200);
      const fmt = p.format ?? "?";
      const cls = p.analysis;
      const type = cls?.content_type ?? "?";
      return `POST ${i + 1} [${fmt}/${type}]: ${cap}`;
    });

  const system = [
    "Sos un analista de estrategia de contenidos B2B (software de RRHH).",
    "Analizá los posts orgánicos de Instagram del competidor y describí su estrategia.",
    "Identificá los pilares de contenido principales (temas que repiten constantemente).",
    langInstruction,
  ].join(" ");

  const { object } = await generateObject({
    model: openai(organicModel()),
    schema: OrganicSynthesisLLMSchema,
    system,
    prompt: `COMPETIDOR: ${competitor}\n\n${lines.join("\n")}`,
  });
  return object;
}

const TranslationSchema = z.object({
  summary: z.string(),
  content_pillars: z.array(z.string()),
});

const TRANSLATE_INSTRUCTION: Record<string, string> = {
  "pt-BR": "Translate into Brazilian Portuguese (pt-BR). Keep brand names as-is.",
  "en-US": "Translate into English (en-US). Keep brand names as-is.",
  "es-AR": "Translate into Rioplatense Spanish (es-AR). Keep brand names as-is.",
};

async function translateOrganic(
  data: { summary: string; content_pillars: string[] },
  targetLocale: string,
): Promise<{ summary: string; content_pillars: string[] } | null> {
  const instruction = TRANSLATE_INSTRUCTION[targetLocale];
  if (!instruction) return null;
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: TranslationSchema,
      system: instruction,
      prompt: JSON.stringify(data),
    });
    return object;
  } catch {
    return null;
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function analyzeOrganic(
  competitor: string,
  opts: { force?: boolean; language?: string } = {},
): Promise<OrganicSynthesis | null> {
  const all = await loadPostsForCompetitor(competitor);
  if (!all.length) return null;

  const pending = opts.force ? all : all.filter((p) => !p.analysis);

  if (pending.length) {
    // Batch classify in chunks of 30 to stay within context
    const CHUNK = 30;
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK);
      const classifications = await classifyPosts(chunk);
      for (const [postId, analysis] of classifications) {
        await savePostAnalysis(competitor, postId, analysis).catch((e) =>
          console.warn(`[organic-analyze] savePostAnalysis failed: ${e}`),
        );
        const post = all.find((p) => p.post_id === postId);
        if (post) post.analysis = analysis;
      }
    }
  }

  // Decide if synthesis should regenerate
  const primaryLang = opts.language ?? "es-AR";

  const computed = computeStats(all);
  const llm = await synthesizePillars(competitor, all, primaryLang);

  // Translate to the other two locales in parallel
  const otherLocales = (["es-AR", "pt-BR", "en-US"] as const).filter((l) => l !== primaryLang);
  const translations = await Promise.all(otherLocales.map((l) => translateOrganic(llm, l)));
  const i18n: OrganicSynthesis["i18n"] = {
    [primaryLang]: { summary: llm.summary, content_pillars: llm.content_pillars },
    ...Object.fromEntries(
      otherLocales.map((l, idx) => [l, translations[idx]]).filter(([, v]) => v !== null),
    ),
  };

  const top_content_types = tally(all.map((p) => p.analysis?.content_type).filter((t): t is string => Boolean(t)));
  const top_objectives = tally(all.map((p) => p.analysis?.objective).filter((o): o is string => Boolean(o)));

  return {
    summary: llm.summary,
    content_pillars: llm.content_pillars,
    posting_frequency: computed.posting_frequency,
    format_distribution: computed.format_distribution,
    top_content_types,
    top_objectives,
    best_performing: computed.best_performing,
    hashtag_strategy: computed.hashtag_strategy,
    posting_patterns: computed.posting_patterns,
    posts_analyzed: all.length,
    i18n,
  };
}
