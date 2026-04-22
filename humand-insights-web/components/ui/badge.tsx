import * as React from "react";

import { cn } from "@/components/ui/utils";

type BadgeVariant = "default" | "secondary" | "outline";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-[var(--color-brand-100)] text-[var(--color-blueprimary-800)]",
  secondary: "bg-[var(--color-brand-50)] text-[var(--color-brand-500)]",
  outline: "border border-[var(--color-neutral-200)] bg-white text-[var(--color-text-secondary)]",
};

function Badge({ className, variant = "default", ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
