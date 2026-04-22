import * as React from "react";

import { cn } from "@/components/ui/utils";

function Separator({ className, orientation = "horizontal", ...props }: React.HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 bg-[var(--color-neutral-100)]",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
