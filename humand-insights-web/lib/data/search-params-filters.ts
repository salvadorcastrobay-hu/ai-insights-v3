import { EMPTY_FILTERS, type Filters } from "@/lib/data/filters";

// Server-side: turn Next.js searchParams into our Filters shape.
// Matches the client-side nuqs parsers (arrays encoded as comma-separated strings).
export function parseFiltersFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): Filters {
  function getArray(key: string): string[] {
    const value = searchParams[key];
    if (Array.isArray(value)) {
      return value.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }

  function getString(key: string): string | null {
    const value = searchParams[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  return {
    ...EMPTY_FILTERS,
    types: getArray("types"),
    regions: getArray("regions"),
    segments: getArray("segments"),
    countries: getArray("countries"),
    industries: getArray("industries"),
    owners: getArray("owners"),
    modules: getArray("modules"),
    categories: getArray("categories"),
    channels: getArray("channels"),
    sources: getArray("sources"),
    date_start: getString("date_start"),
    date_end: getString("date_end"),
    min_confidence: (() => {
      const raw = getString("min_confidence");
      if (raw == null) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
      return parsed;
    })(),
    // Validadas: default ON en todas las pages. Solo OFF con ?validated=false.
    validated: getString("validated") === "false" ? false : null,
    clients: getString("clients") === "true" ? true : null,
  };
}
