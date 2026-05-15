import type { ReactNode } from "react";

import { AskChartButton } from "@/components/ask-chart/AskChartButton";
import type { AskChartContext } from "@/components/ask-chart/AskChartProvider";
import { DownloadCsvButton } from "@/components/charts/DownloadCsvButton";
import type { InsightRow } from "@/lib/supabase/types";

type Props = {
  children: ReactNode;
  title?: string;
  /** When provided, renders the "Preguntar" button. */
  ask?: AskChartContext;
  /** Underlying insight rows for the CSV export (full detail con verbatims). */
  rawRows?: InsightRow[];
};

export function ChartCard({ children, title, ask, rawRows }: Props) {
  const showActions = !!ask || (rawRows && rawRows.length > 0);
  return (
    <div className="rounded-[var(--radius-m)] bg-[var(--color-bg-card)] p-2 shadow-[var(--shadow-4dp)]">
      {title || showActions ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title ? (
            <h4 className="text-[14px] font-semibold text-[var(--color-text-default)]">{title}</h4>
          ) : (
            <span />
          )}
          {showActions ? (
            <div className="flex items-center gap-1.5">
              {rawRows && rawRows.length > 0 ? (
                <DownloadCsvButton filename={ask?.chartTitle || title || "chart"} rows={rawRows} />
              ) : null}
              {ask ? <AskChartButton context={ask} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
