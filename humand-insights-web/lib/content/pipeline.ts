/**
 * Pasos del pipeline posteriores al scraping: síntesis de patrones y
 * generación de calendario.
 *
 * Viven acá y no en un script suelto porque la sección 8 del brief pide que
 * corran solos —análisis y síntesis semanales— y un cron necesita algo a qué
 * llamar. Antes esto existía como scripts locales, o sea que no era reproducible.
 */
import { generateCalendar } from "./calendar";
import { embedTexts } from "./embeddings";
import { buildPositions, normalizeObject } from "./propositions";
import type { PostAnalysis } from "./classify";
import { suggestionKey, takeCoverageSnapshot } from "./metrics";
import {
  loadAnalyzedPosts,
  loadOwnBrandHandles,
  saveCalendar,
  saveOwnBrandComparison,
  saveRegionInsight,
  loadDecidedEntries,
  pruneStaleSuggestions,
  seedSuggestionFeedback,
  type StoredContentPost,
} from "./store";
import { compareOwnBrand, synthesizeAll, type AnalyzedPost } from "./synthesize";

/** Regiones que no representan un mercado y no se sintetizan por separado. */
const NON_MARKET_REGIONS = new Set(["global", "sin_region", "unknown"]);

function toAnalyzable(post: StoredContentPost): AnalyzedPost {
  const raw = post as unknown as {
    viral_score: number | null;
    outlier_factor: number | null;
    debate_factor: number | null;
  };
  return {
    post_id: post.post_id,
    post_url: post.post_url,
    author_handle: post.author_handle,
    region: post.region ?? null,
    viral_score: raw.viral_score,
    outlier_factor: raw.outlier_factor,
    debate_factor: raw.debate_factor ?? null,
    likes_count: post.likes_count,
    comments_count: post.comments_count,
    shares_count: post.shares_count ?? null,
    analysis: post.analysis as PostAnalysis,
  };
}

export type SynthesisResult = {
  regions: Array<{
    region: string;
    posts_considered: number;
    calendar_entries: number;
    warnings: string[];
  }>;
  posts_analyzed: number;
  coverage: Awaited<ReturnType<typeof takeCoverageSnapshot>> | null;
};

/**
 * Recalcula los patrones de cada mercado y, si se pide, regenera el calendario.
 *
 * El calendario es opcional porque cuesta tokens: la síntesis sola es
 * determinística y gratis, así que puede correr más seguido.
 */
export async function runSynthesis(
  options: { withCalendar?: boolean; month?: Date } = {},
): Promise<SynthesisResult> {
  const stored = await loadAnalyzedPosts();
  const posts = stored.map(toAnalyzable);

  const month = options.month ?? nextMonthStart();
  const regions: SynthesisResult["regions"] = [];

  // Las cuentas propias se separan del resto: comparar a Humand contra un
  // conjunto que la incluye diluiría justamente la diferencia que se quiere ver.
  const ownHandles = new Set(await loadOwnBrandHandles());
  const own = posts.filter((p) => ownHandles.has(p.author_handle));
  const reference = posts.filter((p) => !ownHandles.has(p.author_handle));

  for (const synthesis of synthesizeAll(posts)) {
    if (NON_MARKET_REGIONS.has(synthesis.region)) continue;

    /*
     * Posiciones y tensiones del mercado.
     *
     * Es el paso que faltaba: hasta acá se contaban categorías, que es un hecho
     * sobre nuestras propias etiquetas. Agrupar las AFIRMACIONES por el objeto
     * del que hablan, y separarlas por postura, convierte "nueve posts sobre
     * clima" en "nueve posts que discuten si la encuesta de clima sirve, y el
     * lado que dice que no rinde el triple".
     *
     * Se corre sobre los posts relevantes del mercado, no solo el corte
     * superior: el denominador es parte del dato.
     */
    const claims = posts
      .filter(
        (p) =>
          p.region === synthesis.region &&
          p.analysis?.is_relevant_to_hr &&
          p.analysis.claim &&
          p.analysis.claim_object &&
          p.analysis.claim_stance,
      )
      .map((p) => ({
        post_id: p.post_id,
        post_url: p.post_url,
        author_handle: p.author_handle,
        claim: p.analysis.claim as string,
        counterclaim: p.analysis.counterclaim ?? null,
        claim_object: p.analysis.claim_object as string,
        claim_stance: p.analysis.claim_stance as string,
        outlier_factor: p.outlier_factor,
        debate_factor: p.debate_factor ?? null,
      }));

    const embeddings = await embedTexts(
      claims.map((c) => normalizeObject(c.claim_object)),
    ).catch((err: unknown) => {
      console.warn("[pipeline] sin embeddings, agrupo por texto exacto:", err);
      return new Map<string, number[]>();
    });

    const positions = buildPositions(claims, embeddings);
    const withPositions = { ...synthesis, positions };
    if (positions.length) {
      const tensiones = positions.filter((p) => p.is_tension).length;
      console.log(
        `[pipeline] ${synthesis.region}: ${positions.length} posiciones, ${tensiones} tensiones`,
      );
    }

    await saveRegionInsight(
      synthesis.region,
      withPositions,
      synthesis.posts_considered,
      "deterministic-v1",
    );

    let entries = 0;
    let warnings: string[] = [];
    if (options.withCalendar) {
      /*
       * Las piezas que alguien ya decidió no se regeneran. El entry_key es el
       * sha1 del título, y el título lo escribe el modelo sin seed: regenerar
       * el mes entero le cambiaba la clave a todo, así que una pieza aprobada
       * desaparecía de la pantalla —ya no estaba en cal.entries— y su fila
       * seguía contando en el "% aprobado sin cambios".
       *
       * Con cero decisiones tomadas nadie lo había notado, pero la primera
       * semana de uso real se perdía el trabajo de Sofía entero.
       */
      const monthKey = month.toISOString().slice(0, 7);
      const keep = await loadDecidedEntries(synthesis.region, monthKey).catch((err) => {
        console.warn("[pipeline] no pude leer las piezas decididas:", err);
        return [];
      });
      if (keep.length) {
        console.log(`[pipeline] ${synthesis.region}: conservo ${keep.length} piezas ya decididas`);
      }

      const calendar = await generateCalendar(synthesis, month, 3, keep);
      await saveCalendar(calendar.region, calendar.month, calendar, calendar.model);
      entries = calendar.entries.length;
      warnings = calendar.warnings;

      // Cada pieza nace como 'pending'. Es lo que después permite calcular el
      // "% aprobado sin cambios" que pide la sección 10 del brief — y no se
      // puede reconstruir a posteriori.
      const seeded = calendar.entries.map((entry) => ({
        entry_key: suggestionKey(calendar.region, calendar.month, entry.date, entry.title),
        region: calendar.region,
        month: calendar.month,
        publish_date: entry.date,
        entry,
      }));

      await seedSuggestionFeedback(seeded).catch((err) =>
        console.warn("[pipeline] no pude sembrar el feedback:", err),
      );

      // Y se limpia lo que quedó colgado de la versión anterior del calendario.
      await pruneStaleSuggestions(
        calendar.region,
        calendar.month,
        seeded.map((s) => s.entry_key),
      ).catch((err) => console.warn("[pipeline] no pude limpiar el feedback viejo:", err));
    }

    // "Comparás el desempeño propio de Humand contra los patrones detectados"
    // (prompt maestro del brief). Se guarda por mercado, con los patrones de
    // ese mercado como vara.
    if (own.length) {
      const comparison = compareOwnBrand(own, synthesis, reference);
      await saveOwnBrandComparison(synthesis.region, comparison);
    }

    regions.push({
      region: synthesis.region,
      posts_considered: synthesis.posts_considered,
      calendar_entries: entries,
      warnings,
    });
  }

  // Foto de cobertura de la semana: el brief la pide para saber si el research
  // fue completo o parcial, y sin tomarla en el momento no se reconstruye.
  const coverage = await takeCoverageSnapshot().catch((err) => {
    console.warn("[pipeline] no pude tomar la foto de cobertura:", err);
    return null;
  });

  return { regions, posts_analyzed: posts.length, coverage };
}

/** El calendario se arma para el mes que viene, no para el que está corriendo. */
function nextMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
