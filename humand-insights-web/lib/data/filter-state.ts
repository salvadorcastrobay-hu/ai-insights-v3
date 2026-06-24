import { useTransition } from "react";
import { parseAsArrayOf, parseAsBoolean, parseAsFloat, parseAsString, useQueryStates } from "nuqs";

import { useFilterTransition } from "@/components/layout/FilterTransition";

export const FILTER_PARSERS = {
  types: parseAsArrayOf(parseAsString).withDefault([]),
  regions: parseAsArrayOf(parseAsString).withDefault([]),
  segments: parseAsArrayOf(parseAsString).withDefault([]),
  countries: parseAsArrayOf(parseAsString).withDefault([]),
  industries: parseAsArrayOf(parseAsString).withDefault([]),
  owners: parseAsArrayOf(parseAsString).withDefault([]),
  categories: parseAsArrayOf(parseAsString).withDefault([]),
  channels: parseAsArrayOf(parseAsString).withDefault([]),
  sources: parseAsArrayOf(parseAsString).withDefault([]),
  date_start: parseAsString,
  date_end: parseAsString,
  // null = sin filtro de confianza. 0.7 = solo filas con confidence >= 0.7
  // (las filas sin confidence se mantienen).
  min_confidence: parseAsFloat,
  // Solo clientes (deals Closed Won). Filtro global (anda en RPC + JS).
  clients: parseAsBoolean,
  // Solo demos validadas. Default ON: null/true = ON, false = OFF.
  // Solo filtra en pages RPC (MV); el path JS lo ignora (no trae first_meeting_status).
  validated: parseAsBoolean,
};

/**
 * Estado global de filtros sincronizado a la URL.
 *
 * `shallow: false` es CRÍTICO: las pages del dashboard son Server Components
 * que leen searchParams y re-agregan la data. Sin esto, cambiar un filtro
 * solo actualiza la URL en el cliente y los charts NO se refrescan (parece
 * que el filtro no hace nada). Con shallow:false, Next refetchea el RSC con
 * los nuevos searchParams.
 *
 * `startTransition` expone `isPending` mientras Next recomputa del lado del
 * server → lo usamos para mostrar feedback ("Actualizando…") y que el usuario
 * sepa que algo está pasando.
 *
 * Devuelve [filters, setFilters, isPending]. Los dos primeros son
 * backward-compatible con los consumers que destructuran [filters, setFilters].
 */
export function useGlobalFilters() {
  // Si hay un FilterTransitionProvider arriba (dashboard layout), compartimos
  // su transition para que la barra y el overlay de contenido reflejen el
  // mismo pending. Si no, usamos una transition local (fallback robusto).
  const shared = useFilterTransition();
  const [localPending, localStart] = useTransition();
  const isPending = shared?.isPending ?? localPending;
  const startTransition = shared?.startTransition ?? localStart;
  const [filters, setFilters] = useQueryStates(FILTER_PARSERS, {
    shallow: false,
    startTransition,
    clearOnDefault: true,
  });
  return [filters, setFilters, isPending] as const;
}
