import * as React from "react";

import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-[var(--radius-m)] bg-[var(--color-bg-card)] p-4 shadow-[var(--shadow-4dp)]",
        className,
      )}
      {...props}
    />
  );
});

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />;
  },
);

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...props }, ref) {
    return (
      <h3
        ref={ref}
        className={cn("text-[16px] font-semibold tracking-[0.2px] text-[var(--color-text-default)]", className)}
        {...props}
      />
    );
  },
);

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        className={cn("text-[14px] leading-6 text-[var(--color-text-secondary)]", className)}
        {...props}
      />
    );
  },
);

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />;
  },
);

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn("flex items-center p-5 pt-0", className)} {...props} />;
  },
);

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
