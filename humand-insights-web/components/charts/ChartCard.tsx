import type { ReactNode } from "react";

export function ChartCard({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-[var(--radius-m)] bg-[var(--color-bg-card)] p-2 shadow-[var(--shadow-4dp)]">
      {title ? (
        <h4 className="mb-2 text-[14px] font-semibold text-[var(--color-text-default)]">{title}</h4>
      ) : null}
      {children}
    </div>
  );
}
