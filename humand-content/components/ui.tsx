import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--r-l)] border border-[var(--border)] bg-[var(--surface)] p-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card>
      <p className="text-[12px] uppercase leading-[1.4] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-[1.4] tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[12px] leading-[1.4] text-[var(--muted)]">{hint}</p> : null}
    </Card>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "brand" | "warn" | "muted" | "solid";
}) {
  const tones: Record<string, string> = {
    default: "bg-[var(--bg)] text-[var(--text)] border-[var(--border)]",
    brand: "bg-[var(--brand-soft-2)] text-[var(--brand-deep)] border-transparent",
    warn: "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]",
    muted: "bg-transparent text-[var(--muted)] border-[var(--border)]",
    solid: "bg-[var(--brand-solid)] text-white border-transparent",
  };
  return (
    <span
      className={`inline-block rounded-[var(--r-s)] border px-2 py-0.5 text-[12px] leading-[1.4] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Barra de proporción. Un lift de 3,2× y uno de 1,1× escritos como texto se ven
 * iguales; el dato es comparativo y necesita una codificación comparativa.
 */
export function Bar({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "muted" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunk)]">
      <div
        className={`h-full rounded-full ${tone === "brand" ? "bg-[var(--brand)]" : "bg-[var(--border-strong)]"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Aviso. Se usa para las advertencias del calendario y la muestra insuficiente. */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--r-m)] border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-[14px] leading-[1.4] text-[var(--warn-text)]">
      {children}
    </p>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card className="py-10 text-center">
      <p className="text-[14px] font-semibold leading-[1.4]">{title}</p>
      {hint ? <p className="mt-1 text-[14px] leading-[1.4] text-[var(--muted)]">{hint}</p> : null}
    </Card>
  );
}

/** Rótulo de sección. Reemplaza los `text-xs uppercase` sueltos repetidos. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[12px] font-semibold uppercase leading-[1.4] text-[var(--muted)]">
      {children}
    </p>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[24px] font-semibold leading-[1.4]">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-[14px] leading-[1.4] text-[var(--muted)]">{subtitle}</p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}
