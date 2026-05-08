"use client";

import { useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { EMPTY_FILTERS, type Filters } from "@/lib/data/filters";

export type DrillDimension =
  | "pain_theme"
  | "competitor_name"
  | "feature_display"
  | "friction_subtype"
  | "module_display"
  | "insight_subtype_display";

export type DrillScopeType =
  | "pain"
  | "product_gap"
  | "competitive_signal"
  | "deal_friction"
  | "faq";

export type DrillRequest = {
  dimension: DrillDimension;
  value: string;
  label?: string; // Human-readable label for the dimension (e.g. "Pain")
  scopeType?: DrillScopeType;
};

type Ctx = {
  open: (req: DrillRequest) => void;
  close: () => void;
  current: DrillRequest | null;
  isOpen: boolean;
  filters: Filters;
};

const DrillCtx = createContext<Ctx | null>(null);

function parseFiltersFromParams(sp: URLSearchParams): Filters {
  const getArr = (k: string) => {
    const v = sp.get(k);
    if (!v) return [];
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  };
  return {
    ...EMPTY_FILTERS,
    types: getArr("types"),
    regions: getArr("regions"),
    segments: getArr("segments"),
    countries: getArr("countries"),
    industries: getArr("industries"),
    owners: getArr("owners"),
    modules: getArr("modules"),
    categories: getArr("categories"),
    channels: getArr("channels"),
    sources: getArr("sources"),
    date_start: sp.get("date_start"),
    date_end: sp.get("date_end"),
  };
}

export function DrillDownProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const [current, setCurrent] = useState<DrillRequest | null>(null);

  const filters = useMemo(
    () => parseFiltersFromParams(new URLSearchParams(searchParams?.toString() ?? "")),
    [searchParams],
  );

  const open = useCallback((req: DrillRequest) => setCurrent(req), []);
  const close = useCallback(() => setCurrent(null), []);

  const value: Ctx = useMemo(
    () => ({ open, close, current, isOpen: current !== null, filters }),
    [open, close, current, filters],
  );

  return <DrillCtx.Provider value={value}>{children}</DrillCtx.Provider>;
}

export function useDrillDown() {
  const ctx = useContext(DrillCtx);
  if (!ctx) throw new Error("useDrillDown must be used inside DrillDownProvider");
  return ctx;
}
