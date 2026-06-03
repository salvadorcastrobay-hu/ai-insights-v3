"use client";

import { Loader2 } from "lucide-react";
import { createContext, useContext, useTransition, type ReactNode, type TransitionStartFunction } from "react";

/**
 * Comparte una única React transition entre la filter bar (que dispara el
 * cambio de URL con shallow:false) y el área de contenido (que muestra el
 * overlay de "Actualizando"). Así el feedback de pending es consistente:
 * apenas tocás un filtro, el contenido se atenúa hasta que el Server
 * Component termina de recomputar.
 *
 * useGlobalFilters() consume `startTransition` de este context si está
 * presente; si no (ej. una page sin provider), cae a su propia useTransition.
 */
type Ctx = {
  isPending: boolean;
  startTransition: TransitionStartFunction;
};

const FilterTransitionContext = createContext<Ctx | null>(null);

export function FilterTransitionProvider({ children }: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();
  return (
    <FilterTransitionContext.Provider value={{ isPending, startTransition }}>
      {children}
    </FilterTransitionContext.Provider>
  );
}

export function useFilterTransition(): Ctx | null {
  return useContext(FilterTransitionContext);
}

/**
 * Overlay que atenúa su contenedor mientras hay un refetch de filtros en
 * curso. Se monta como hijo de un contenedor `relative`. Cuando no hay
 * pending no renderiza nada (no intercepta clicks).
 */
export function FilterPendingOverlay() {
  const ctx = useFilterTransition();
  if (!ctx?.isPending) return null;
  return (
    <div
      aria-hidden="true"
      style={{ backgroundColor: "rgba(255,255,255,0.55)" }}
      className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center backdrop-blur-[1px] transition-opacity"
    >
      <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--color-bg-card)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-brand-500)] shadow-[var(--shadow-4dp)]">
        <Loader2 size={14} className="animate-spin" />
        Actualizando datos…
      </div>
    </div>
  );
}
