import type { ReactNode } from "react";

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-4 space-y-1">
      <h1>{title}</h1>
      {subtitle ? <p className="text-[14px] text-[var(--color-text-secondary)]">{subtitle}</p> : null}
    </header>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-m)] border border-dashed border-[var(--color-neutral-200)] bg-white p-6 text-[14px] text-[var(--color-text-secondary)]">
      {children}
    </div>
  );
}
