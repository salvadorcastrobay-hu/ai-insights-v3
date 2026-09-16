import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </Card>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "brand" | "warn" | "muted";
}) {
  const tones: Record<string, string> = {
    default: "bg-[var(--bg)] text-[var(--text)] border-[var(--border)]",
    brand: "bg-[var(--brand-soft)] text-[#2f4fa3] border-[#d4defa]",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    muted: "bg-transparent text-[var(--muted)] border-[var(--border)]",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card className="text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm text-[var(--muted)]">{hint}</p> : null}
    </Card>
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
    <header className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}
