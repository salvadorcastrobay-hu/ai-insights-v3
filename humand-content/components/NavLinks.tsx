"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Menú lateral.
 *
 * El orden es el que pidió Sofía (feedback del 23/10): Inspiración, Insights
 * claves, Insights propios y Chat, más la sección de ads que pidió aparte. El calendario queda abajo y apagado —ella
 * pidió dejarlo para el final—, y Sistema, que es operación del pipeline y no
 * trabajo de Content, va separado al pie.
 *
 * Es client component porque necesita la ruta actual para marcar dónde estás.
 */
const NAV: Array<{ href: string; label: string; soon?: boolean }> = [
  { href: "/", label: "Inicio" },
  { href: "/discovery", label: "Inspiración" },
  { href: "/insights", label: "Insights claves" },
  { href: "/propios", label: "Insights propios" },
  { href: "/ads", label: "Ads propios" },
  { href: "/chat", label: "Chat" },
];

const LATER = [{ href: "/calendar", label: "Calendario" }];

function useActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
}

function Item({ href, label, soon, muted }: { href: string; label: string; soon?: boolean; muted?: boolean }) {
  const isActive = useActive();
  const active = isActive(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2 rounded-[var(--r-m)] px-3 py-2 text-[14px] leading-[1.4] transition-colors ${
        active
          ? "bg-[var(--brand-soft-2)] font-semibold text-[var(--brand-deep)]"
          : muted
            ? "text-[var(--faint)] hover:bg-[var(--bg)]"
            : "text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
      }`}
    >
      {label}
      {soon ? (
        <span className="rounded-full bg-[var(--surface-sunk)] px-1.5 text-[10px] leading-[1.6] text-[var(--faint)]">
          pronto
        </span>
      ) : null}
    </Link>
  );
}

/** Menú vertical, para la barra lateral de escritorio. */
export function SideNav({ pending }: { pending: number }) {
  return (
    <nav className="flex h-full flex-col gap-1">
      {NAV.map((item) => (
        <Item key={item.href} {...item} />
      ))}
      <p className="mt-4 px-3 text-[10px] font-semibold uppercase leading-[1.4] text-[var(--faint)]">Más adelante</p>
      {LATER.map((item) => (
        <Item key={item.href} {...item} muted />
      ))}
      <div className="mt-auto border-t border-[var(--border)] pt-2">
        <Link
          href="/sistema"
          className="flex items-center gap-2 rounded-[var(--r-m)] px-3 py-2 text-[12px] leading-[1.4] text-[var(--faint)] hover:bg-[var(--bg)]"
        >
          Sistema
          {pending > 0 ? (
            <span className="rounded-full bg-[var(--brand-soft-2)] px-1.5 text-[10px] font-semibold leading-[1.6] text-[var(--brand-deep)]">
              {pending}
            </span>
          ) : null}
        </Link>
      </div>
    </nav>
  );
}

/** El mismo menú en una fila con scroll, para mobile. */
export function TopNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {[...NAV, ...LATER].map((item) => (
        <Item key={item.href} href={item.href} label={item.label} />
      ))}
    </nav>
  );
}
