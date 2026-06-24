import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: string | number;
  delta?: string;
  trend?: "positive" | "negative" | "neutral";
  caption?: string;
  className?: string;
  valueClassName?: string;
};

export function MetricCard({ label, value, delta, caption, className, valueClassName }: MetricCardProps) {
  return (
    <article
      className={cn(
        "flex min-h-[110px] flex-col justify-between rounded-[var(--radius-m)] bg-[var(--color-bg-card)] px-5 py-4 shadow-[var(--shadow-4dp)]",
        className,
      )}
    >
      <p className="text-[12px] text-[var(--color-text-secondary)]">{label}</p>
      <p
        className={cn(
          "text-[32px] font-semibold leading-tight text-[var(--color-text-default)]",
          valueClassName,
        )}
      >
        {value}
      </p>
      <div className="space-y-1">
        {delta ? <p className="text-[12px] font-semibold text-[var(--color-brand-500)]">{delta}</p> : null}
        {caption ? <p className="text-[12px] text-[var(--color-text-secondary)]">{caption}</p> : null}
      </div>
    </article>
  );
}
