export default function DashboardLoading() {
  return (
    <div className="space-y-6">
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
        Cargando insights (primera carga puede tardar hasta dos minutos)…
      </p>
    </div>
  );
}
