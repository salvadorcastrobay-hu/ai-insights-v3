import { Info } from "lucide-react";

import type { SampleStats } from "@/lib/data/sample-stats";

/**
 * Banner siempre visible al pie de cada page del dashboard. Cubre el ask de
 * Pedro (meeting Jun 1): "show the results where are they coming from… be
 * careful on how do you use this information."
 *
 * Muestra: #calls analizadas (del set filtrado), cobertura sobre el total
 * de transcripts, período cubierto y confianza promedio. Es un Server
 * Component — el contenido es estático per-request.
 */
type Props = {
  stats: SampleStats;
  /** Label opcional para identificar la page (ej: "Executive Summary"). */
  pageLabel?: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  // Esperamos YYYY-MM-DD; mostramos tal cual (es format-friendly).
  return iso;
}

function formatGeneratedAt(iso: string): string {
  // Formato compacto local: 2026-06-03 14:32
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

export function DataQualityFooter({ stats, pageLabel }: Props) {
  const {
    uniqueCalls,
    uniqueDeals,
    insightsCount,
    totalCalls,
    coveragePct,
    periodStart,
    periodEnd,
    avgConfidence,
    highConfidencePct,
    generatedAt,
  } = stats;

  const items: Array<{ label: string; value: string }> = [
    {
      label: "Calls analizadas",
      value:
        totalCalls > 0
          ? `${uniqueCalls.toLocaleString("es-AR")} / ${totalCalls.toLocaleString("es-AR")} (${coveragePct.toFixed(1)}%)`
          : uniqueCalls.toLocaleString("es-AR"),
    },
    { label: "Deals", value: uniqueDeals.toLocaleString("es-AR") },
    { label: "Insights", value: insightsCount.toLocaleString("es-AR") },
    {
      label: "Período",
      value: `${formatDate(periodStart)} → ${formatDate(periodEnd)}`,
    },
  ];

  if (avgConfidence != null) {
    items.push({
      label: "Confianza promedio",
      value: `${avgConfidence.toFixed(2)}${
        highConfidencePct != null ? ` · ${highConfidencePct.toFixed(0)}% alta` : ""
      }`,
    });
  }

  return (
    <footer
      className="mt-8 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)] shadow-[var(--shadow-2dp)]"
      aria-label="Calidad de los datos"
    >
      <div className="mb-2 flex items-center gap-2 font-semibold text-[var(--color-text-default)]">
        <Info size={14} aria-hidden="true" />
        <span>
          Calidad de los datos{pageLabel ? ` · ${pageLabel}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wide opacity-70">
              {item.label}
            </span>
            <span className="font-mono text-[12px] text-[var(--color-text-default)]">
              {item.value}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] opacity-70">
        Aplicá filtros para acotar el set. Si la cobertura es baja, las
        agregaciones pueden no ser representativas. Last update:{" "}
        {formatGeneratedAt(generatedAt)}.
      </p>
    </footer>
  );
}
