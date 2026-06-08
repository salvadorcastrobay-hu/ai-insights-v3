import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Loader explícito — que se lea "cargando", no "vacío". */}
      <div className="flex items-center gap-2.5 text-[14px] font-medium text-[var(--color-brand-500)]">
        <Loader2 size={18} className="animate-spin" />
        Cargando datos…
      </div>

      <div className="h-8 w-64 animate-pulse rounded-[var(--radius-s)] bg-[var(--color-neutral-100)]" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-[110px] animate-pulse rounded-[var(--radius-m)] bg-[var(--color-neutral-100)]"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-[360px] animate-pulse rounded-[var(--radius-m)] bg-[var(--color-neutral-100)]" />
        <div className="h-[360px] animate-pulse rounded-[var(--radius-m)] bg-[var(--color-neutral-100)]" />
      </div>
      <p className="text-center text-xs text-[var(--color-text-secondary)]">
        La primera carga puede tardar unos segundos.
      </p>
    </div>
  );
}
