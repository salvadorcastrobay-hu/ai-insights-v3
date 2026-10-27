// Paginación server-side de las tablas de detalle (pains, FAQs, gaps).
// Cada tabla renderiza una fila por insight con resumen + cita; con ~100K
// insights mandarlas todas al cliente tumba el navegador (OOM). Arranca en
// TABLE_PAGE filas y "Cargar más" suma de a una página, hasta TABLE_MAX
// (más allá de eso, el CSV).
export const TABLE_PAGE = 200;
export const TABLE_MAX = 5000;

export type TablePage<R> = {
  /** Hasta `limit` filas que matchean (no todo el universo). */
  rows: R[];
  /** Cuántas filas matchean en total, antes del corte. */
  total: number;
};

export function clampTableLimit(limit: number | null | undefined): number {
  return Math.min(Math.max(limit || TABLE_PAGE, TABLE_PAGE), TABLE_MAX);
}

/**
 * Una pasada: cuenta todas las filas que matchean y mapea solo las primeras
 * `limit` (el map es lo caro: arma el objeto que cruza el RSC boundary).
 */
export function paginateRows<T, R>(
  rows: readonly T[],
  matches: (row: T) => boolean,
  toRow: (row: T) => R,
  limit?: number | null,
): TablePage<R> {
  const max = clampTableLimit(limit);
  const out: R[] = [];
  let total = 0;
  for (const row of rows) {
    if (!matches(row)) continue;
    total++;
    if (out.length < max) out.push(toRow(row));
  }
  return { rows: out, total };
}

/** Búsqueda libre: normaliza el needle una vez y matchea contra un blob. */
export function textMatcher(search: string | null | undefined): ((blob: string) => boolean) | null {
  const needle = search?.trim().toLowerCase();
  if (!needle) return null;
  return (blob) => blob.toLowerCase().includes(needle);
}

/** Primer valor string no vacío de un searchParam. */
export function firstParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : null;
}
