import { parseAsArrayOf, parseAsFloat, parseAsString, useQueryStates } from "nuqs";

export const FILTER_PARSERS = {
  types: parseAsArrayOf(parseAsString).withDefault([]),
  regions: parseAsArrayOf(parseAsString).withDefault([]),
  segments: parseAsArrayOf(parseAsString).withDefault([]),
  countries: parseAsArrayOf(parseAsString).withDefault([]),
  industries: parseAsArrayOf(parseAsString).withDefault([]),
  owners: parseAsArrayOf(parseAsString).withDefault([]),
  modules: parseAsArrayOf(parseAsString).withDefault([]),
  categories: parseAsArrayOf(parseAsString).withDefault([]),
  channels: parseAsArrayOf(parseAsString).withDefault([]),
  sources: parseAsArrayOf(parseAsString).withDefault([]),
  date_start: parseAsString,
  date_end: parseAsString,
  // null = sin filtro de confianza. 0.7 = solo filas con confidence >= 0.7
  // (las filas sin confidence se mantienen).
  min_confidence: parseAsFloat,
};

export function useGlobalFilters() {
  return useQueryStates(FILTER_PARSERS);
}
