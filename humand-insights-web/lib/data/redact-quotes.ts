import type { InsightRow } from "@/lib/supabase/types";
import { canSeeRawQuotes, type AppRole } from "@/lib/auth/roles";

const REDACTED_FIELDS: Array<keyof InsightRow> = ["verbatim_quote", "gap_description"];

/**
 * Campos del InsightRow que el cliente realmente usa:
 *  - 23 fields para CSV export (DownloadCsvButton)
 *  - is_own_brand_competitor para filtros de views (Exec, Competitive)
 *
 * El resto (feature_is_seed, hr_category_display, pain_scope, módulo crudo,
 * etc.) NUNCA se lee en client. Lo dropeamos antes del RSC boundary y bajamos
 * el payload ~30% (de 34 a 24 fields por row).
 */
const CLIENT_FIELDS: ReadonlyArray<keyof InsightRow> = [
  "id",
  "transcript_id",
  "call_date",
  "company_name",
  "segment",
  "industry",
  "region",
  "country",
  "deal_id",
  "deal_name",
  "deal_stage",
  "deal_owner",
  "amount",
  "acquisition_channel",
  "insight_type",
  "insight_type_display",
  "insight_subtype_display",
  "module_display",
  "feature_display",
  "gap_priority",
  "competitor_name",
  "competitor_relationship_display",
  "summary",
  "verbatim_quote",
  "confidence",
  "pain_theme",
  "gap_description",
  "is_own_brand_competitor",
];

/**
 * Prepara filteredRows para cruzar el RSC boundary. Hace dos cosas en una
 * sola pasada:
 *   1. SLIM: solo mantiene los campos que el cliente realmente usa (~70%
 *      del payload original). Cualquier otro field se omite.
 *   2. REDACT: si el user no es admin, dropea verbatim_quote y
 *      gap_description (data sensible).
 *
 * Devuelve un NUEVO array de objetos slim. No muta el array original
 * (importante porque rows típicamente viene del cache de loadInsights).
 */
export function prepareRowsForClient<T extends Partial<InsightRow>>(
  rows: T[],
  userRoles: readonly AppRole[],
): InsightRow[] {
  const isAdmin = canSeeRawQuotes(userRoles);
  const out: InsightRow[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Record<string, unknown>;
    const slim: Record<string, unknown> = {};
    for (const field of CLIENT_FIELDS) {
      if (!isAdmin && REDACTED_FIELDS.includes(field)) continue;
      slim[field] = row[field];
    }
    // Cast: el slim NO tiene todos los fields, pero los views solo leen
    // los que están en CLIENT_FIELDS. Acceder a un field non-slim devuelve
    // undefined (TypeScript no se da cuenta), pero no se usan en runtime.
    out[i] = slim as unknown as InsightRow;
  }
  return out;
}

/**
 * @deprecated Usá `prepareRowsForClient` que combina slim + redact en
 * una sola pasada. Esta función queda solo por compatibilidad temporal.
 */
export function redactQuotesForRoles<T extends Partial<InsightRow>>(
  rows: T[],
  userRoles: readonly AppRole[],
): T[] {
  if (canSeeRawQuotes(userRoles)) return rows;
  for (const row of rows) {
    for (const field of REDACTED_FIELDS) {
      if (field in row) {
        (row as Record<string, unknown>)[field] = null;
      }
    }
  }
  return rows;
}
