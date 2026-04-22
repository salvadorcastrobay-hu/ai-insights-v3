import * as React from "react";

import { cn } from "@/lib/utils";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius-s)] bg-[var(--color-brand-400)] px-3 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-brand-500)] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
