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

/**
 * Self-describing data passed from a chart to the Ask panel so the LLM can
 * answer grounded questions about that specific visualization.
 */
export type AskChartContext = {
  chartTitle: string;
  chartKind?: "horizontal-bar" | "stacked-bar" | "line" | "pie" | "heatmap" | "table" | string;
  description?: string;
  /** Already-rendered rows the user can see. Keep small (<= 50 entries). */
  rows: Array<{
    label: string;
    value: number | null;
    /** Optional extra per-row fields (e.g., pct, segment, region). */
    extra?: Record<string, string | number | null | undefined>;
  }>;
  /**
   * If set, the server will enrich each row with real verbatim quotes and
   * sub-breakdowns so the LLM can answer "what do they mean by X?" questions.
   * Matches the dimensions supported by /api/drill-down.
   */
  dimension?:
    | "pain_theme"
    | "competitor_name"
    | "feature_display"
    | "friction_subtype"
    | "module_display"
    | "insight_subtype_display";
  scopeType?: "pain" | "product_gap" | "competitive_signal" | "deal_friction" | "faq";
  /** Optional extra plain-text metadata (e.g., total demos, date range). */
  notes?: string;
};

type CtxValue = {
  isOpen: boolean;
  openGeneric: () => void;
  openForChart: (ctx: AskChartContext) => void;
  close: () => void;
  /** Currently scoped chart (if any). null = whole dashboard. */
  chart: AskChartContext | null;
  /** Filter snapshot from the URL. */
  filters: Filters;
};

const AskCtx = createContext<CtxValue | null>(null);

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
    modules: [],
    categories: getArr("categories"),
    channels: getArr("channels"),
    sources: getArr("sources"),
    date_start: sp.get("date_start"),
    date_end: sp.get("date_end"),
  };
}

export function AskChartProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [chart, setChart] = useState<AskChartContext | null>(null);

  const filters = useMemo(
    () => parseFiltersFromParams(new URLSearchParams(searchParams?.toString() ?? "")),
    [searchParams],
  );

  const openGeneric = useCallback(() => {
    setChart(null);
    setIsOpen(true);
  }, []);

  const openForChart = useCallback((ctx: AskChartContext) => {
    setChart(ctx);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const value: CtxValue = useMemo(
    () => ({ isOpen, openGeneric, openForChart, close, chart, filters }),
    [isOpen, openGeneric, openForChart, close, chart, filters],
  );

  return <AskCtx.Provider value={value}>{children}</AskCtx.Provider>;
}

export function useAskChart() {
  const ctx = useContext(AskCtx);
  if (!ctx) throw new Error("useAskChart must be used inside AskChartProvider");
  return ctx;
}
