/**
 * Análisis IA del contenido orgánico de Instagram.
 * Patrón incremental igual que analyze.ts: solo procesa posts sin cache;
 * reutiliza la síntesis si no hay cambios.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { generateObject, generateText, experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import { getPg } from "@/lib/supabase/pg";
import {
  loadMetricSnapshotsForCompetitor,
  loadOrganicProfile,
  loadPostsForCompetitor,
  savePostAnalysis,
  type StoredPost,
  type OrganicSynthesis,
  type OrganicPostAnalysis,
  type OrganicMetricSnapshot,
  type Tally,
} from "./organic-store";
import { loadAdInsight } from "./store";

const execFileAsync = promisify(execFile);

function organicModel(): string {
  return process.env.COMPETITOR_ADS_MODEL ?? process.env.ASK_CHART_MODEL ?? "gpt-4o-mini";
}

function transcribeModel(): string {
  return process.env.COMPETITOR_ADS_TRANSCRIBE_MODEL ?? "whisper-1";
}

async function loadPainVocab(): Promise<string[]> {
  const sql = getPg();
  try {
    const rows = await sql<{ pain: string }[]>`
      SELECT DISTINCT insight_subtype_display AS pain
      FROM mv_insights_norm
      WHERE insight_type = 'pain' AND prompt_version = 'v3.0'
        AND insight_subtype_display IS NOT NULL
      LIMIT 80
    `;
    return rows.map((r) => r.pain).filter(Boolean);
  } catch {
    return [];
  }
}

async function loadModuleVocab(): Promise<string[]> {
  const sql = getPg();
  try {
    const rows = await sql<{ module: string }[]>`
      SELECT DISTINCT module_display AS module
      FROM mv_insights_norm
      WHERE module_display IS NOT NULL
      LIMIT 80
    `;
    return rows.map((r) => r.module).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchBytes(url: string, accept: string, maxBytes = 24 * 1024 * 1024): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept, referer: "https://www.instagram.com/" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len > maxBytes) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function extractImageText(imageUrl: string): Promise<string | null> {
  const bytes = await fetchBytes(imageUrl, "image/*,*/*");
  if (!bytes) return null;
  try {
    const { text } = await generateText({
      model: openai(organicModel()),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Este es un post orgánico de Instagram. Transcribí TEXTUALMENTE el texto visible " +
                "en la imagen/carrusel (headline, claims, CTA). Si no hay texto legible, respondé exactamente '—'. " +
                "Máximo 360 caracteres, sin comentarios.",
            },
            { type: "image", image: bytes },
          ],
        },
      ],
    });
    const t = text.replace(/\s+/g, " ").trim();
    return t && t !== "—" ? t.slice(0, 360) : null;
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

async function extractVideoFrames(videoUrl: string, maxFrames = 5): Promise<Uint8Array[]> {
  const bytes = await fetchBytes(videoUrl, "video/*,*/*");
  if (!bytes) return [];
  const dir = await mkdtemp(path.join(tmpdir(), "organic-video-"));
  try {
    const input = path.join(dir, "input.mp4");
    await writeFile(input, bytes);
    const duration = await probeVideoDuration(input);
    const ratios = duration && duration < 10 ? [0.08, 0.22, 0.42, 0.68, 0.9] : [0.08, 0.25, 0.45, 0.68, 0.88];
    const times = ratios.slice(0, maxFrames).map((r) => Math.max(0.1, (duration ?? 20) * r));
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
        /* seguir con otros frames */
      }
    }
    return frames;
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function transcribeVideo(videoUrl: string): Promise<string | null> {
  const bytes = await fetchBytes(videoUrl, "video/*,*/*");
  if (!bytes) return null;
  try {
    const { text } = await transcribe({ model: openai.transcription(transcribeModel()), audio: bytes });
    const t = text.replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 700) : null;
  } catch {
    return null;
  }
}

async function extractVideoFrameText(videoUrl: string, posterUrl?: string | null): Promise<string | null> {
  const frames = await extractVideoFrames(videoUrl);
  if (!frames.length) return posterUrl ? extractImageText(posterUrl) : null;
  try {
    const { text } = await generateText({
      model: openai(organicModel()),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Estos frames pertenecen a un reel/post orgánico. Transcribí y consolidá el texto visible " +
                "en orden lógico. Conservá hooks, claims, beneficios y CTAs. Si no hay texto legible, respondé '—'. " +
                "Máximo 600 caracteres, sin comentarios.",
            },
            ...frames.map((frame) => ({ type: "image" as const, image: frame })),
          ],
        },
      ],
    });
    const t = text.replace(/\s+/g, " ").trim();
    return t && t !== "—" ? t.slice(0, 600) : null;
  } catch {
    return posterUrl ? extractImageText(posterUrl) : null;
  }
}

type CreativeExtraction = {
  creative_text: string | null;
  audio_transcript: string | null;
  visual_text: string | null;
  images_analyzed: number;
  videos_analyzed: number;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

async function extractCreativeText(post: StoredPost): Promise<CreativeExtraction | null> {
  const videos = uniqueStrings(post.media?.videos ?? []);
  const poster = post.media?.images?.[0] ?? post.display_url;
  const audioTexts: string[] = [];
  const visualTexts: string[] = [];

  for (const video of videos) {
    const audioText = await transcribeVideo(video);
    if (audioText && !audioTexts.includes(audioText)) audioTexts.push(audioText);
    const visualText = await extractVideoFrameText(video, poster);
    if (visualText && !visualTexts.includes(visualText)) visualTexts.push(visualText);
  }

  const imageTexts: string[] = [];
  const images = uniqueStrings(post.media?.images?.length ? post.media.images : [post.display_url]);
  for (const image of images) {
    const text = await extractImageText(image);
    if (text && !imageTexts.includes(text)) imageTexts.push(text);
  }

  const audioTranscript = audioTexts.join(" · ").slice(0, 1600) || null;
  const visualText = [...visualTexts, ...imageTexts].join(" · ").slice(0, 2600) || null;
  const creativeText = [audioTranscript, visualText].filter(Boolean).join(" · ").slice(0, 3000) || null;

  if (!creativeText) return null;
  return {
    creative_text: creativeText,
    audio_transcript: audioTranscript,
    visual_text: visualText,
    images_analyzed: images.length,
    videos_analyzed: videos.length,
  };
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

const FUNNEL_STAGES = ["awareness", "consideracion", "decision", "retencion", "otro"] as const;
const CTA_STRENGTHS = ["none", "soft", "strong"] as const;

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
  related_pains: z.array(z.string()).describe("Pains de la taxonomía provista a los que apunta el post. Vacío si no aplica."),
  persona: z.string().nullable().describe("Persona objetivo, concisa. Null si no se puede inferir."),
  modules: z.array(z.string()).describe("Módulos/categorías de producto mencionadas, usando la lista provista si aplica."),
  funnel_stage: z.enum(FUNNEL_STAGES),
  hook: z.string().nullable().describe("Hook principal del post/reel en 3-8 palabras."),
  tone: z.string().nullable().describe("Tono del post: educativo, aspiracional, urgente, humorístico, corporativo, etc."),
  cta_strength: z.enum(CTA_STRENGTHS),
  offer_type: z.string().nullable().describe("Oferta concreta si existe: demo, guía, evento, checklist, webinar, producto, etc."),
});

const ClassifyListSchema = z.object({ posts: z.array(ClassifyPostSchema) });

async function classifyPosts(
  posts: StoredPost[],
  creativeText: Map<string, CreativeExtraction>,
  painVocab: string[],
  moduleVocab: string[],
): Promise<Map<string, OrganicPostAnalysis>> {
  if (!posts.length) return new Map();

  const lines = posts.map((p, i) => {
    const cap = (p.caption ?? "").slice(0, 300);
    const creative = creativeText.get(p.post_id);
    const hashtags = p.hashtags.slice(0, 10).join(" ");
    const fmt = p.format ?? "unknown";
    return [
      `POST ${i + 1} [${fmt}]`,
      cap ? `caption: ${cap}` : "",
      creative?.creative_text ? `texto visual/audio: ${creative.creative_text.slice(0, 1200)}` : "",
      hashtags ? `hashtags: ${hashtags}` : "",
    ].filter(Boolean).join(" · ");
  });

  const system =
    "Sos un analista de contenido de redes sociales B2B. " +
    "Clasificá cada post de Instagram según su tipo de contenido, objetivo, CTA, persona, módulo, funnel, hook, tono y pains. " +
    "Usá caption + texto visual/audio. No inventes: si no hay evidencia, dejá vacío/null. " +
    "Los related_pains deben salir exclusivamente de la lista provista.";

  const { object } = await generateObject({
    model: openai(organicModel()),
    schema: ClassifyListSchema,
    system,
    prompt: [
      painVocab.length ? `PAINS PERMITIDOS:\n${painVocab.join(", ")}` : "PAINS PERMITIDOS: ninguno disponible",
      moduleVocab.length ? `MÓDULOS PERMITIDOS:\n${moduleVocab.join(", ")}` : "MÓDULOS PERMITIDOS: ninguno disponible",
      "",
      lines.join("\n"),
    ].join("\n"),
  });

  const result = new Map<string, OrganicPostAnalysis>();
  for (const item of object.posts) {
    const post = posts[item.post_index - 1];
    if (!post) continue;
    const extracted = creativeText.get(post.post_id);
    result.set(post.post_id, {
      content_type: item.content_type,
      objective: item.objective,
      has_cta: item.has_cta,
      cta_type: item.cta_type,
      creative_text: extracted?.creative_text ?? null,
      audio_transcript: extracted?.audio_transcript ?? null,
      visual_text: extracted?.visual_text ?? null,
      images_analyzed: extracted?.images_analyzed ?? 0,
      videos_analyzed: extracted?.videos_analyzed ?? 0,
      related_pains: item.related_pains ?? [],
      persona: item.persona,
      modules: item.modules ?? [],
      funnel_stage: item.funnel_stage,
      hook: item.hook,
      tone: item.tone,
      cta_strength: item.cta_strength,
      offer_type: item.offer_type,
    });
  }
  return result;
}

// ─── Aggregated synthesis ─────────────────────────────────────────────────────

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const POSTING_PATTERN_TZ_OFFSET_HOURS = -3;

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
    const rawDate = new Date(p.posted_at!);
    const d = new Date(rawDate.getTime() + POSTING_PATTERN_TZ_OFFSET_HOURS * 60 * 60 * 1000);
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

function computeEngagementRatePosts(
  posts: StoredPost[],
  followersCount: number | null,
): OrganicSynthesis["best_by_engagement_rate"] {
  if (!followersCount || followersCount <= 0) return [];
  return [...posts]
    .map((p) => ({
      post_id: p.post_id,
      engagement_rate: ((p.likes_count ?? 0) + (p.comments_count ?? 0)) / followersCount,
      likes: p.likes_count ?? 0,
      comments: p.comments_count ?? 0,
      caption_snippet: (p.caption ?? "").slice(0, 120),
    }))
    .filter((p) => p.engagement_rate > 0)
    .sort((a, b) => b.engagement_rate - a.engagement_rate)
    .slice(0, 5);
}

function computeMomentumPosts(
  posts: StoredPost[],
  snapshots: OrganicMetricSnapshot[],
): OrganicSynthesis["top_momentum_posts"] {
  const byPost = new Map<string, OrganicMetricSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = byPost.get(snapshot.post_id) ?? [];
    list.push(snapshot);
    byPost.set(snapshot.post_id, list);
  }
  return [...byPost.entries()]
    .map(([postId, list]) => {
      const ordered = [...list].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const post = posts.find((p) => p.post_id === postId);
      return {
        post_id: postId,
        likes_growth: Math.max(0, (last?.likes_count ?? 0) - (first?.likes_count ?? 0)),
        comments_growth: Math.max(0, (last?.comments_count ?? 0) - (first?.comments_count ?? 0)),
        views_growth: Math.max(0, (last?.video_views ?? 0) - (first?.video_views ?? 0)),
        caption_snippet: (post?.caption ?? "").slice(0, 120),
      };
    })
    .filter((item) => item.likes_growth + item.comments_growth + item.views_growth > 0)
    .sort((a, b) => (b.likes_growth + b.comments_growth + b.views_growth) - (a.likes_growth + a.comments_growth + a.views_growth))
    .slice(0, 5);
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
  recommendations: z.array(z.string()).describe("3-5 recomendaciones accionables para Humand basadas en esta estrategia orgánica."),
});

async function synthesizePillars(
  competitor: string,
  posts: StoredPost[],
  language = "es-AR",
): Promise<{ summary: string; content_pillars: string[]; recommendations: string[] }> {
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
    "Generá recomendaciones concretas para Humand: qué podría responder, ocupar o evitar.",
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

function topStrings(items: string[], limit = 8): string[] {
  return tally(items).slice(0, limit).map((item) => item.key);
}

async function computeGapsVsHumand(competitor: string, posts: StoredPost[]): Promise<string[]> {
  if (competitor === "Humand") return [];
  const humand = await loadPostsForCompetitor("Humand");
  if (!humand.length) return [];
  const competitorPains = topStrings(posts.flatMap((p) => p.analysis?.related_pains ?? []), 10);
  const humandPains = new Set(humand.flatMap((p) => p.analysis?.related_pains ?? []));
  const painGaps = competitorPains.filter((pain) => !humandPains.has(pain)).slice(0, 4);

  const competitorTypes = topStrings(posts.map((p) => p.analysis?.content_type).filter((x): x is string => Boolean(x)), 4);
  const humandTypes = new Set(humand.map((p) => p.analysis?.content_type).filter((x): x is string => Boolean(x)));
  const typeGaps = competitorTypes.filter((type) => !humandTypes.has(type)).slice(0, 2);

  return [
    ...painGaps.map((pain) => `Humand casi no cubre el pain "${pain}" en orgánico, pero ${competitor} sí lo está trabajando.`),
    ...typeGaps.map((type) => `Formato/tipo de contenido menos usado por Humand frente a ${competitor}: ${type}.`),
  ].slice(0, 5);
}

function extractAdPains(payload: unknown): string[] {
  const p = payload as { angles?: Array<{ related_pains?: string[] }> } | null;
  return [...new Set((p?.angles ?? []).flatMap((angle) => angle.related_pains ?? []))];
}

async function computeOverlapWithAds(
  competitor: string,
  posts: StoredPost[],
): Promise<OrganicSynthesis["overlap_with_ads"]> {
  const organicPains = [...new Set(posts.flatMap((p) => p.analysis?.related_pains ?? []))];
  const adInsight = await loadAdInsight(competitor, "meta_ads").catch(() => null);
  const adsPains = extractAdPains(adInsight);
  const adsSet = new Set(adsPains);
  const organicSet = new Set(organicPains);
  const painsInBoth = organicPains.filter((pain) => adsSet.has(pain));
  const organicOnly = organicPains.filter((pain) => !adsSet.has(pain));
  const adsOnly = adsPains.filter((pain) => !organicSet.has(pain));
  const pretestCandidates = posts
    .filter((p) => (p.analysis?.related_pains ?? []).some((pain) => adsSet.has(pain)))
    .sort((a, b) => (b.likes_count ?? 0) + (b.comments_count ?? 0) - ((a.likes_count ?? 0) + (a.comments_count ?? 0)))
    .slice(0, 5)
    .map((p) => ({
      post_id: p.post_id,
      pain: (p.analysis?.related_pains ?? []).find((pain) => adsSet.has(pain)) ?? "",
      caption_snippet: (p.caption ?? "").slice(0, 120),
    }));
  return {
    pains_in_both: painsInBoth,
    organic_only_pains: organicOnly,
    ads_only_pains: adsOnly,
    pretest_candidates: pretestCandidates,
  };
}

const TranslationSchema = z.object({
  summary: z.string(),
  content_pillars: z.array(z.string()),
  recommendations: z.array(z.string()),
});

const TRANSLATE_INSTRUCTION: Record<string, string> = {
  "pt-BR": "Translate into Brazilian Portuguese (pt-BR). Keep brand names as-is.",
  "en-US": "Translate into English (en-US). Keep brand names as-is.",
  "es-AR": "Translate into Rioplatense Spanish (es-AR). Keep brand names as-is.",
};

async function translateOrganic(
  data: { summary: string; content_pillars: string[]; recommendations: string[] },
  targetLocale: string,
): Promise<{ summary: string; content_pillars: string[]; recommendations: string[] } | null> {
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
  const painVocab = await loadPainVocab();
  const moduleVocab = await loadModuleVocab();

  if (pending.length) {
    const creativeText = new Map<string, CreativeExtraction>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const post = pending[cursor++];
        const text = await extractCreativeText(post).catch(() => null);
        if (text) creativeText.set(post.post_id, text);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker));

    // Batch classify in chunks of 30 to stay within context
    const CHUNK = 30;
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK);
      const classifications = await classifyPosts(chunk, creativeText, painVocab, moduleVocab);
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
  const profile = await loadOrganicProfile(competitor);
  const snapshots = await loadMetricSnapshotsForCompetitor(competitor);

  const computed = computeStats(all);
  const llm = await synthesizePillars(competitor, all, primaryLang);
  const top_related_pains = tally(all.flatMap((p) => p.analysis?.related_pains ?? []));
  const top_personas = tally(all.map((p) => p.analysis?.persona).filter((p): p is string => Boolean(p)));
  const top_modules = tally(all.flatMap((p) => p.analysis?.modules ?? []));
  const gaps_vs_humand = await computeGapsVsHumand(competitor, all);
  const overlap_with_ads = await computeOverlapWithAds(competitor, all);

  // Translate to the other two locales in parallel
  const otherLocales = (["es-AR", "pt-BR", "en-US"] as const).filter((l) => l !== primaryLang);
  const translations = await Promise.all(otherLocales.map((l) => translateOrganic(llm, l)));
  const i18n: OrganicSynthesis["i18n"] = {
    [primaryLang]: {
      summary: llm.summary,
      content_pillars: llm.content_pillars,
      recommendations: llm.recommendations,
    },
    ...Object.fromEntries(
      otherLocales.map((l, idx) => [l, translations[idx]]).filter(([, v]) => v !== null),
    ),
  };

  const top_content_types = tally(all.map((p) => p.analysis?.content_type).filter((t): t is string => Boolean(t)));
  const top_objectives = tally(all.map((p) => p.analysis?.objective).filter((o): o is string => Boolean(o)));

  return {
    summary: llm.summary,
    content_pillars: llm.content_pillars,
    recommendations: llm.recommendations,
    posting_frequency: computed.posting_frequency,
    format_distribution: computed.format_distribution,
    top_content_types,
    top_objectives,
    top_related_pains,
    top_personas,
    top_modules,
    best_performing: computed.best_performing,
    best_by_engagement_rate: computeEngagementRatePosts(all, profile?.followers_count ?? null),
    top_momentum_posts: computeMomentumPosts(all, snapshots),
    hashtag_strategy: computed.hashtag_strategy,
    posting_patterns: computed.posting_patterns,
    gaps_vs_humand,
    overlap_with_ads,
    posts_analyzed: all.length,
    i18n,
  };
}
