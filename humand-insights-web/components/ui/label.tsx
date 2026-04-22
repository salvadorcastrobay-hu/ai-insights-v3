import * as React from "react";

import { cn } from "@/components/ui/utils";

const Label = React.forwardRef<HTMLLabelElement, React.ComponentProps<"label">>(function Label(
  { className, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn("text-[12px] font-medium tracking-[0.2px] text-[var(--color-text-secondary)]", className)}
      {...props}
    />
  );
});

export { Label };
