"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Nav con estado activo.
 *
 * Es client component porque necesita la ruta actual, que es la única forma de
 * marcar dónde estás parado — antes los cinco links se veían idénticos en todas
 * las pantallas.
 *
 * Tres items de producto y "Sistema" separado a la derecha: Fuentes y Métricas
 * eran operación del pipeline compitiendo de igual a igual con el trabajo diario
 * de Content.
 */
const NAV = [
  { href: "/discovery", label: "Qué funciona" },
  { href: "/calendar", label: "Calendario" },
  { href: "/insights", label: "Patrones" },
];

export function NavLinks({ pending }: { pending: number }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const className = (href: string) =>
    `shrink-0 border-b-2 pb-0.5 text-[14px] transition-colors ${
      isActive(href)
        ? "border-[var(--brand)] font-semibold text-[var(--text)]"
        : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
    }`;

  return (
    <div className="flex items-center gap-4 overflow-x-auto">
      {NAV.map((item) => (
        <Link key={item.href} href={item.href} className={className(item.href)}>
          {item.label}
        </Link>
      ))}
      <Link href="/sistema" className={`${className("/sistema")} flex items-center gap-1.5`}>
        Sistema
        {pending > 0 ? (
          <span className="rounded-full bg-[var(--brand-soft-2)] px-1.5 text-[10px] font-semibold leading-[1.6] text-[var(--brand-deep)]">
            {pending}
          </span>
        ) : null}
      </Link>
    </div>
  );
}
