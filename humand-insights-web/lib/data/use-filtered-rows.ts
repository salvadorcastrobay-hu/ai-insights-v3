"use client";

import { useMemo } from "react";

import { useGlobalFilters } from "@/lib/data/filter-state";
import { applyFilters, type Filters } from "@/lib/data/filters";
import type { InsightRow } from "@/lib/supabase/types";

export function useFilteredRows(rows: InsightRow[]) {
  const [filters, setFilters] = useGlobalFilters();
  const filteredRows = useMemo(
    () => applyFilters(rows, filters as Filters),
    [rows, filters],
  );

  return {
    filters,
    setFilters,
    filteredRows,
  };
}
