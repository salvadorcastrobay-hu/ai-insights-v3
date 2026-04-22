import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-white px-3 py-2 text-[14px] outline-none focus:border-[var(--color-brand-400)]",
          className,
        )}
        {...props}
      />
    );
  },
);
