import type { ReactNode } from "react";

import { NavLinks } from "@/components/NavLinks";
import { loadStats } from "@/lib/content/queries";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Si Supabase no responde, la nav se muestra igual: un contador caído no
  // puede dejar la app inusable.
  const stats = await loadStats().catch(() => null);

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-4 py-3 sm:px-6">
          <span className="shrink-0 text-[14px] font-semibold">Humand Content</span>
          <NavLinks pending={stats?.suggested ?? 0} />
          {stats ? (
            <span className="ml-auto hidden shrink-0 text-[12px] leading-[1.4] text-[var(--faint)] lg:block">
              {stats.posts.toLocaleString("es")} posts · {stats.analyzed.toLocaleString("es")}{" "}
              analizados
            </span>
          ) : null}
        </div>
      </nav>
      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
