import Link from "next/link";
import type { ReactNode } from "react";

import { loadStats } from "@/lib/content/queries";

const NAV = [
  { href: "/discovery", label: "Qué funciona" },
  { href: "/calendar", label: "Calendario" },
  { href: "/insights", label: "Patrones" },
  { href: "/sources", label: "Fuentes" },
  { href: "/metrics", label: "Métricas" },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Si Supabase no responde, la nav se muestra igual: un contador caído no
  // puede dejar la app inusable.
  const stats = await loadStats().catch(() => null);

  return (
    <div className="min-h-screen">
      <nav className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <span className="text-sm font-semibold">Humand Content</span>
          <div className="flex gap-4 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              >
                {item.label}
              </Link>
            ))}
          </div>
          {stats ? (
            <span className="ml-auto text-xs text-[var(--muted)]">
              {stats.posts.toLocaleString("es")} posts · {stats.analyzed.toLocaleString("es")}{" "}
              analizados
              {stats.suggested > 0 ? ` · ${stats.suggested} fuentes por revisar` : ""}
            </span>
          ) : null}
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
