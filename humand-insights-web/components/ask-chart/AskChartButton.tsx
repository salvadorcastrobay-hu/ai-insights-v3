"use client";

import { Sparkles } from "lucide-react";

import { useAskChart, type AskChartContext } from "./AskChartProvider";

type Props = {
  context: AskChartContext;
  className?: string;
  compact?: boolean;
};

/**
 * Small inline button to open the Ask panel scoped to a single chart.
 * Drop this in a chart card header next to the title.
 */
export function AskChartButton({ context, className, compact = false }: Props) {
  const { openForChart } = useAskChart();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openForChart(context);
      }}
      className={`group inline-flex items-center gap-1 rounded-full border border-transparent bg-gradient-to-r from-[var(--color-brand-50)] to-[#efeaff] px-2 py-[3px] text-[11px] font-medium text-[var(--color-brand-500)] transition-all hover:border-[var(--color-brand-400)] hover:shadow-[0_4px_12px_-4px_rgba(73,107,227,0.35)] ${
        className ?? ""
      }`}
      aria-label={`Preguntar sobre ${context.chartTitle}`}
      title={`Preguntar sobre "${context.chartTitle}"`}
    >
      <Sparkles className="h-3 w-3 transition-transform group-hover:rotate-12" />
      {compact ? null : <span>Preguntar</span>}
    </button>
  );
}
