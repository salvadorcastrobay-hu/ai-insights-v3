/**
 * Temas que vienen creciendo, medidos en lo que juntamos.
 *
 * Se compara la PARTICIPACIÓN de cada tema en los últimos 30 días contra los
 * 60 anteriores, no la cantidad: el volumen de lo scrapeado sube y baja con
 * las corridas (septiembre tiene el triple de posts por un backfill) y contar
 * posts mostraría como tendencia lo que es una corrida más grande.
 *
 * La ventana se ancla en el post más reciente del corpus y no en hoy: si la
 * ingesta se corta (Apify sin cupo), los "últimos 30 días" quedarían vacíos y
 * todo parecería estar cayendo.
 */

export type TrendRow = { theme: string; author: string; postedAt: string; region: string | null };
export type ThemeTrend = { theme: string; recent: number; authors: number; recentShare: number; prevShare: number; ratio: number };

const DAY = 86_400_000;
const RECENT_DAYS = 30;
const PREVIOUS_DAYS = 60;
/** Por debajo de esto, con ~100 posts por mes y mercado, es ruido. */
const MIN_RECENT_POSTS = 4;
const MIN_RECENT_AUTHORS = 3;
const MIN_RATIO = 1.5;
/** Una cuenta que publica en ráfaga no es el mercado hablando de un tema. */
const MAX_AUTHOR_SHARE = 1 / 3;

export function themeTrends(rows: TrendRow[], region: string): { trends: ThemeTrend[]; windowEnd: string | null } {
  const mine = rows.filter((r) => r.region === region && r.theme && r.theme !== "otro");
  if (!mine.length) return { trends: [], windowEnd: null };
  const end = Math.max(...mine.map((r) => Date.parse(r.postedAt)));
  const recentFrom = end - RECENT_DAYS * DAY;
  const prevFrom = recentFrom - PREVIOUS_DAYS * DAY;

  const recent = mine.filter((r) => Date.parse(r.postedAt) > recentFrom);
  const prev = mine.filter((r) => {
    const t = Date.parse(r.postedAt);
    return t > prevFrom && t <= recentFrom;
  });
  if (!recent.length || !prev.length) return { trends: [], windowEnd: new Date(end).toISOString() };

  const byTheme = new Map<string, { recent: number; authors: Map<string, number>; prev: number }>();
  const slot = (theme: string) => {
    const s = byTheme.get(theme) ?? { recent: 0, authors: new Map<string, number>(), prev: 0 };
    byTheme.set(theme, s);
    return s;
  };
  for (const r of recent) {
    const s = slot(r.theme);
    s.recent += 1;
    s.authors.set(r.author, (s.authors.get(r.author) ?? 0) + 1);
  }
  for (const r of prev) slot(r.theme).prev += 1;

  const trends: ThemeTrend[] = [];
  for (const [theme, s] of byTheme) {
    if (s.recent < MIN_RECENT_POSTS || s.authors.size < MIN_RECENT_AUTHORS) continue;
    if (Math.max(...s.authors.values()) > s.recent * MAX_AUTHOR_SHARE) continue;
    const recentShare = s.recent / recent.length;
    // Un tema ausente antes se compara contra medio post, no contra cero: si
    // no, cualquier aparición nueva sería "infinitamente" en alza.
    const prevShare = Math.max(s.prev, 0.5) / prev.length;
    const ratio = recentShare / prevShare;
    if (ratio >= MIN_RATIO) {
      trends.push({ theme, recent: s.recent, authors: s.authors.size, recentShare, prevShare, ratio });
    }
  }
  return { trends: trends.sort((a, b) => b.ratio - a.ratio), windowEnd: new Date(end).toISOString() };
}
