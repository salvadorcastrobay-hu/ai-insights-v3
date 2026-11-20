import { type ContentPost } from "@/lib/content/types";
import { postTraits } from "@/lib/content/why";

/**
 * Por qué rindieron (o no) nuestros posts, comparándolos entre sí.
 *
 * Se separa el tercio que más superó el promedio de la cuenta del tercio que
 * menos, y se buscan rasgos que estén mucho más en uno que en otro. Es una
 * pista, no una conclusión. Medido mezclando los resultados al azar: con 75
 * posts de Instagram salían 2 rasgos por casualidad contra 4 reales (p 0,11);
 * con 95, 2 contra 5 (p 0,02). Mejora con más posts, pero ningún rasgo suelto
 * está confirmado, así que la pantalla muestra los conteos y lo dice.
 */

const MIN_POSTS = 6;
const MIN_RATIO = 3;

export type OwnClue = { axis: string; key: string; text: string; inTop: number; inBottom: number };
export type OwnContrast = { tercile: number; works: OwnClue[]; fails: OwnClue[] };

export function ownContrast(posts: ContentPost[]): OwnContrast {
  const ranked = posts
    .filter((p) => p.outlier_factor != null)
    .sort((a, b) => (b.outlier_factor ?? 0) - (a.outlier_factor ?? 0));
  const tercile = Math.floor(ranked.length / 3);
  if (tercile < MIN_POSTS) return { tercile, works: [], fails: [] };

  const count = (group: ContentPost[]) => {
    const byKey = new Map<string, { axis: string; key: string; text: string; n: number }>();
    for (const post of group) {
      for (const t of postTraits(post)) {
        const id = `${t.axis}:${t.key}`;
        const row = byKey.get(id) ?? { ...t, n: 0 };
        row.n += 1;
        byKey.set(id, row);
      }
    }
    return byKey;
  };
  const top = count(ranked.slice(0, tercile));
  const bottom = count(ranked.slice(-tercile));

  const side = (a: typeof top, b: typeof top, flip: boolean): OwnClue[] =>
    [...a.entries()]
      .filter(([id, row]) => row.n >= MIN_POSTS && row.n >= MIN_RATIO * Math.max(b.get(id)?.n ?? 0, 1))
      .map(([id, row]) => {
        const other = b.get(id)?.n ?? 0;
        return {
          axis: row.axis,
          key: row.key,
          text: row.text,
          inTop: flip ? other : row.n,
          inBottom: flip ? row.n : other,
        };
      })
      .sort((x, y) => Math.abs(y.inTop - y.inBottom) - Math.abs(x.inTop - x.inBottom));

  return { tercile, works: side(top, bottom, false), fails: side(bottom, top, true) };
}

/** Las pistas que tiene un post: las de "rinde" si está arriba, las de "no rinde" si está abajo. */
export function cluesFor(post: ContentPost, clues: OwnClue[]): OwnClue[] {
  const mine = new Set(postTraits(post).map((t) => `${t.axis}:${t.key}`));
  return clues.filter((c) => mine.has(`${c.axis}:${c.key}`));
}
