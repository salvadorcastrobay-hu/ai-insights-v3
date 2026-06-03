import type { ReactNode } from "react";

import { AskChartButton } from "@/components/ask-chart/AskChartButton";
import type { AskChartContext } from "@/components/ask-chart/AskChartProvider";
import { DownloadCsvButton } from "@/components/charts/DownloadCsvButton";
import type { InsightRow } from "@/lib/supabase/types";

type ChartMeta = {
  /** Insights únicos en los que se basa el chart. */
  n?: number;
  /** Demos/calls únicas. */
  uniqueCalls?: number;
  /** Override del label cuando "n=X" no es lo correcto (ej: "n=X deals"). */
  label?: string;
};

type Props = {
  children: ReactNode;
  title?: string;
  /** When provided, renders the "Preguntar" button. */
  ask?: AskChartContext;
  /** Underlying insight rows for the CSV export (full detail con verbatims). */
  rawRows?: InsightRow[];
  /**
   * Sample size del chart. Si no se pasa pero hay `rawRows`, se infiere
   * `n=rawRows.length`. Para suprimir el footer, pasar `meta={null}`.
   */
  meta?: ChartMeta | null;
};

function metaCaption(meta: ChartMeta): string {
  if (meta.label) return meta.label;
  const parts: string[] = [];
  if (typeof meta.n === "number") parts.push(`n=${meta.n.toLocaleString("es-AR")}`);
  if (typeof meta.uniqueCalls === "number")
    parts.push(`${meta.uniqueCalls.toLocaleString("es-AR")} demos`);
  return parts.join(" · ");
}

export function ChartCard({ children, title, ask, rawRows, meta }: Props) {
  const showActions = !!ask || (rawRows && rawRows.length > 0);
  // Inferir meta automáticamente si no se pasó explícitamente. meta={null}
  // suprime el footer (algunos charts tienen su propio sample size visible).
  const resolvedMeta: ChartMeta | null =
    meta === null
      ? null
      : meta ?? (rawRows && rawRows.length > 0 ? { n: rawRows.length } : null);
  const caption = resolvedMeta ? metaCaption(resolvedMeta) : "";
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
      {caption ? (
        <p className="mt-2 px-2 pb-1 text-right font-mono text-[10px] text-[var(--color-text-secondary)] opacity-70">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
