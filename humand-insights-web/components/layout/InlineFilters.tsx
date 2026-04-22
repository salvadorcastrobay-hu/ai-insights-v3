"use client";

import { useMemo } from "react";

import {
  EMPTY_FILTERS,
  computeFilterOptions,
  type FilterOptions,
  type Filters,
} from "@/lib/data/filters";
import { useGlobalFilters } from "@/lib/data/filter-state";
import type { InsightRow } from "@/lib/supabase/types";

import { FilterControls } from "./GlobalFilterBar";

export function InlineFilters({
  rows,
  options,
  title = "Filtros",
  defaultOpen = false,
}: {
  rows?: InsightRow[];
  options?: FilterOptions;
  title?: string;
  defaultOpen?: boolean;
}) {
  const [filters, setFilters] = useGlobalFilters();
  const computedOptions = useMemo(() => options ?? computeFilterOptions(rows ?? []), [options, rows]);
  const mergedFilters = { ...EMPTY_FILTERS, ...filters } satisfies Filters;

  return (
    <details
      open={defaultOpen}
      className="rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-4 shadow-[var(--shadow-4dp)]"
    >
      <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--color-text-default)]">
        {title}
      </summary>
      <div className="mt-4">
        <FilterControls compact filters={mergedFilters} setFilters={setFilters} options={computedOptions} />
      </div>
    </details>
  );
}
