import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  description?: string;
  className?: string;
};

export function SectionHeader({ title, subtitle, description, className }: Props) {
  return (
    <header className={cn("space-y-1", className)}>
      <h2 className="ds-section-header">{title}</h2>
      {subtitle || description ? (
        <p className="text-[14px] text-[var(--color-text-secondary)]">{description ?? subtitle}</p>
      ) : null}
    </header>
  );
}
