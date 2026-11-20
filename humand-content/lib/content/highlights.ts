import { label } from "@/lib/content/labels";
import { loadOwnHandles, loadRankedPosts, loadSyntheses } from "@/lib/content/queries";
import { regionLabel, type ContentPost, type PatternLift, type RegionSynthesis } from "@/lib/content/types";


/** Un hallazgo dicho en una frase, listo para el inicio. */
export type Finding = { region: string; text: string; lift: number };

const AXIS_PHRASES: Record<string, (key: string) => string> = {
  winning_hooks: (k) => `lo que arranca con ${label(k)}`,
  winning_formats: (k) => `el formato ${label(k).toLowerCase()}`,
  winning_themes: (k) => `hablar de ${label(k).toLowerCase()}`,
  evidence_type: (k) => `apoyarse en ${label(k)}`,
  narrative_voice: (k) =>
    ({ yo: "escribir en primera persona", nosotros: "escribir en plural", vos_usted: "hablarle directo al lector" })[k] ??
    `la voz ${k}`,
  emotional_trigger: (k) => `buscar ${label(k)}`,
  specificity: (k) => (k === "muy_concreto" ? "dar nombres, cifras y casos" : `ser ${label(k)}`),
};

/**
 * Los hallazgos más fuertes de cada mercado, en lenguaje llano.
 *
 * Solo entran lifts sostenidos por al menos tres autores y de 1,3× para arriba:
 * por debajo, en un corte de veinte posts, la diferencia es uno o dos posts.
 */
export function findings(syntheses: RegionSynthesis[], perRegion = 2): Finding[] {
  const out: Finding[] = [];
  for (const s of syntheses) {
    const candidates: Array<{ axis: string; row: PatternLift }> = [];
    const push = (axis: string, rows: PatternLift[] | null | undefined) => {
      for (const row of rows ?? []) candidates.push({ axis, row });
    };
    push("winning_hooks", s.winning_hooks);
    push("winning_formats", s.winning_formats);
    push("winning_themes", s.winning_themes);
    for (const axis of ["evidence_type", "narrative_voice", "emotional_trigger", "specificity"] as const) {
      push(axis, s.winning_axes?.[axis]);
    }
    const strong = candidates
      .filter(({ row }) => row.lift >= 1.3 && (row.top_authors ?? 0) >= 3 && row.key !== "otro" && row.key !== "ninguna")
      .sort((a, b) => b.row.lift - a.row.lift)
      .slice(0, perRegion);
    for (const { axis, row } of strong) {
      const phrase = AXIS_PHRASES[axis]?.(row.key) ?? label(row.key);
      out.push({
        region: s.region,
        lift: row.lift,
        text: `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} rinde ${row.lift.toFixed(1).replace(".", ",")}× más que el promedio.`,
      });
    }
  }
  return out;
}

export async function loadHighlights(): Promise<{
  posts: ContentPost[];
  syntheses: RegionSynthesis[];
  findings: Finding[];
}> {
  const [posts, syntheses, own] = await Promise.all([
    loadRankedPosts({ onlyRelevant: true, onlyMeasured: true, audience: "rrhh", limit: 80 }),
    loadSyntheses(),
    loadOwnHandles(),
  ]);
  // Lo nuestro no es inspiración: tiene su propia sección ("Insights propios").
  // El feed ordena por viral_score; para "lo que más rindió" manda el múltiplo.
  const byOutlier = posts
    .filter((p) => !own.has(p.author_handle))
    .sort((a, b) => (b.outlier_factor ?? 0) - (a.outlier_factor ?? 0));
  return { posts: byOutlier, syntheses, findings: findings(syntheses) };
}

/** Preguntas de ejemplo para la caja del chat, armadas con temas y mercados reales. */
export function sampleQuestions(syntheses: RegionSynthesis[]): string[] {
  const out = ["Tengo que hacer un post sobre comunicación interna, ¿qué me sugerís?"];
  for (const s of syntheses.slice(0, 2)) {
    const theme = s.winning_themes?.find((t) => t.lift > 1 && t.key !== "otro")?.key;
    if (theme) out.push(`¿Qué funciona hoy en ${regionLabel(s.region)} sobre ${label(theme).toLowerCase()}?`);
  }
  out.push("¿Qué formato rinde más en LinkedIn para hablarle a CEOs?");
  return out.slice(0, 4);
}
