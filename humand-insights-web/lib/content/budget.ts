/**
 * Presupuesto de Apify para la ingesta de contenido.
 *
 * Antes cada corrida diaria pedía TODAS las fuentes completas (results_limit
 * de cada una): ~2.400 posts, ~USD 5,40, que es el plan gratuito entero. Tres
 * ciclos seguidos el cupo se fue el primer día y el resto del mes no entró
 * nada. Ahora:
 *
 *   - Tope mensual de posts cobrados (CONTENT_MONTHLY_ITEM_BUDGET, 500 por
 *     defecto, ~USD 1,40). Se cuenta lo que Apify cobra —los items crudos que
 *     devuelve, antes de filtrar—, no lo que guardamos.
 *   - Cada fuente pide pocos posts y solo de una ventana reciente. La ventana
 *     es más larga que la cadencia a propósito: vuelve a traer los posts de la
 *     semana pasada, que al traerlos por primera vez tenían horas y todavía no
 *     habían juntado su engagement.
 *   - Orden de prioridad: lo nuestro, después cuentas (las únicas que se
 *     pueden medir contra su promedio), al final hashtags y búsquedas, que
 *     traen posts sueltos de cuentas sin línea base.
 *
 * Todo lo de acá es puro y se testea sin red; el gasto del mes lo lee
 * discovery-job desde content_refresh_jobs.
 */

export const DEFAULT_MONTHLY_ITEM_BUDGET = 500;

/** Posts por fuente y por corrida. Lo nuestro pide más: es lo que más se mira. */
export const PER_SOURCE_ITEMS: Record<string, number> = {
  own_brand: 15,
  competitor_profile: 5,
  profile: 5,
  hashtag: 10,
  keyword: 10,
};

/** Ventana de fechas por corrida (la cadencia es semanal). */
export const WINDOW_DAYS = 21;

const KIND_ORDER: Record<string, number> = {
  own_brand: 0,
  competitor_profile: 1,
  profile: 1,
  hashtag: 2,
  keyword: 2,
};

export type BudgetedSource = {
  id: string;
  kind: string;
  priority: number;
  results_limit: number;
  last_run_at?: string | null;
};

export type SourcePlan<S> = { source: S; maxItems: number };

export function monthlyBudget(env: string | undefined = process.env.CONTENT_MONTHLY_ITEM_BUDGET): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MONTHLY_ITEM_BUDGET;
}

/**
 * Orden y tope de cada fuente para esta corrida.
 *
 * El tope del mes NO se reparte acá de antemano: lo aplica el caller fuente
 * por fuente con lo que efectivamente se cobró (`allowance`). Repartirlo antes
 * reserva cupo que la ventana de fechas después no usa — una cuenta que no
 * publicó en tres semanas devuelve 0 aunque tuviera 5 reservados.
 *
 * `perSourceOverride` es para cargas puntuales a mano (por ejemplo, la
 * historia de una cuenta nueva): pisa el tope por fuente pero nunca el del mes.
 */
export function planSources<S extends BudgetedSource>(
  sources: S[],
  perSourceOverride?: number,
): Array<SourcePlan<S>> {
  return [...sources]
    // Dentro de cada tipo, primero la que hace más que no corre: con ~100
    // posts por corrida no entran todas, y las salteadas no actualizan
    // last_run_at, así que la semana siguiente quedan adelante. Rota sola.
    .sort(
      (a, b) =>
        (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3) ||
        (a.last_run_at ?? "").localeCompare(b.last_run_at ?? "") ||
        a.priority - b.priority,
    )
    .map((source) => ({
      source,
      maxItems: Math.max(0, perSourceOverride ?? Math.min(source.results_limit, PER_SOURCE_ITEMS[source.kind] ?? 5)),
    }));
}

/**
 * Cuánto se le puede pedir a una fuente con lo que queda del mes.
 *
 * `cost` es cuántos items cobra Apify por cada post pedido: la búsqueda de
 * LinkedIn pide de más y filtra, así que cobra más de lo que guarda.
 */
export function allowance(planned: number, budget: number, billed: number, cost = 1): number {
  const left = Math.max(0, budget - billed);
  return Math.max(0, Math.min(planned, Math.floor(left / cost)));
}

/**
 * Cuánto puede gastar ESTA corrida: lo que queda del mes repartido entre las
 * corridas semanales que faltan (contando esta). Sin esto la primera corrida
 * del mes se lleva el tope entero y las otras tres no traen nada.
 */
export function runShare(budget: number, spent: number, now: Date): number {
  const left = Math.max(0, budget - spent);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const runsLeft = Math.max(1, Math.ceil((daysInMonth - now.getUTCDate() + 1) / 7));
  return Math.ceil(left / runsLeft);
}

/** Desde cuándo pedir posts, como YYYY-MM-DD. Null = sin ventana (cargas de historia). */
export function windowStart(now: Date, days: number | null = WINDOW_DAYS): string | null {
  if (days == null) return null;
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Inicio del mes calendario en UTC: los ciclos de Apify no son mensuales calendario, pero el tope es nuestro. */
export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
