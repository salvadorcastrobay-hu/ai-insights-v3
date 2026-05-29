import type { InsightRow } from "@/lib/supabase/types";
import { canSeeRawQuotes, type AppRole } from "@/lib/auth/roles";

const REDACTED_FIELDS: Array<keyof InsightRow> = ["verbatim_quote", "gap_description"];

/**
 * Si el user no tiene rol admin, drop `verbatim_quote` y `gap_description`
 * de cada row antes de mandar al cliente o al CSV.
 *
 * No muta el array original (returns new rows). El backend / chat AI siguen
 * teniendo acceso al data completo en el server — esto solo aplica al
 * payload que cruza al cliente.
 */
export function redactQuotesForRoles<T extends Partial<InsightRow>>(
  rows: T[],
  userRoles: readonly AppRole[],
): T[] {
  if (canSeeRawQuotes(userRoles)) return rows;
  return rows.map((row) => {
    const copy: T = { ...row };
    for (const field of REDACTED_FIELDS) {
      if (field in copy) {
        (copy as Record<string, unknown>)[field] = null;
      }
    }
    return copy;
  });
}
