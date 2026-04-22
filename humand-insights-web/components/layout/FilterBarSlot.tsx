"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const HIDDEN_PATHS = ["/sql-chat", "/campaign-advisor", "/glossary"];

export function FilterBarSlot({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  if (HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null;
  }
  return <>{children}</>;
}
