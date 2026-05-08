import type { ReactNode } from "react";

import { AskChartButton } from "@/components/ask-chart/AskChartButton";
import type { AskChartContext } from "@/components/ask-chart/AskChartProvider";

type Props = {
  children: ReactNode;
  title?: string;
  /** When provided, renders a small "Preguntar" button in the header. */
  ask?: AskChartContext;
};

export function ChartCard({ children, title, ask }: Props) {
  return (
    <div className="rounded-[var(--radius-m)] bg-[var(--color-bg-card)] p-2 shadow-[var(--shadow-4dp)]">
      {title || ask ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title ? (
            <h4 className="text-[14px] font-semibold text-[var(--color-text-default)]">{title}</h4>
          ) : (
            <span />
          )}
          {ask ? <AskChartButton context={ask} /> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
