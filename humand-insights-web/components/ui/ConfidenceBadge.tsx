/**
 * Badge color-coded para el campo `confidence` (0-1) que el LLM asigna a cada
 * insight extraído. Tres niveles:
 *   - ≥0.8: alta (verde)
 *   - 0.5-0.8: media (amarillo)
 *   - <0.5: baja (rojo)
 *   - null/undefined: gris ("—")
 *
 * Usado en detail tables (pains-detail, product-gaps-detail, etc.) para que
 * el end user pueda juzgar qué tan confiable es cada fila.
 */
type Props = {
  value: number | null | undefined;
  /** Mostrar el número numérico además del color. Default true. */
  showValue?: boolean;
  className?: string;
};

function tierFor(value: number): {
  bg: string;
  text: string;
  label: string;
} {
  if (value >= 0.8) {
    return {
      bg: "bg-emerald-50 dark:bg-emerald-900/30",
      text: "text-emerald-700 dark:text-emerald-300",
      label: "alta",
    };
  }
  if (value >= 0.5) {
    return {
      bg: "bg-amber-50 dark:bg-amber-900/30",
      text: "text-amber-700 dark:text-amber-300",
      label: "media",
    };
  }
  return {
    bg: "bg-rose-50 dark:bg-rose-900/30",
    text: "text-rose-700 dark:text-rose-300",
    label: "baja",
  };
}

export function ConfidenceBadge({ value, showValue = true, className }: Props) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span
        className={`inline-flex items-center rounded-full bg-[var(--color-neutral-100)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)] ${className ?? ""}`}
        title="Sin valor de confianza"
      >
        —
      </span>
    );
  }
  const { bg, text, label } = tierFor(value);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${bg} ${text} px-1.5 py-0.5 text-[11px] font-medium ${className ?? ""}`}
      title={`Confianza ${label} (${value.toFixed(2)}) · 0=inferido, 1=certeza`}
    >
      {showValue ? value.toFixed(2) : label}
    </span>
  );
}
