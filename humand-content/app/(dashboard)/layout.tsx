import type { ReactNode } from "react";

import { SideNav, TopNav } from "@/components/NavLinks";
import { APP_NAME } from "@/lib/content/brand";
import { loadStats } from "@/lib/content/queries";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Si Supabase no responde, el menú se muestra igual: un contador caído no
  // puede dejar la app inusable.
  const stats = await loadStats().catch(() => null);

  return (
    <div className="flex min-h-screen">
      {/* Menú fijo a la izquierda: siempre se sabe qué hay y dónde estás. */}
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-4 md:flex">
        <span className="mb-6 px-3 text-[18px] font-semibold leading-[1.4]">{APP_NAME}</span>
        <div className="min-h-0 flex-1">
          <SideNav pending={stats?.suggested ?? 0} />
        </div>
        {stats ? (
          <p className="mt-2 px-3 text-[10px] leading-[1.4] text-[var(--faint)]">
            {stats.posts.toLocaleString("es-AR")} posts · {stats.analyzed.toLocaleString("es-AR")} analizados
          </p>
        ) : null}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 md:hidden">
          <span className="mb-1 block text-[16px] font-semibold leading-[1.4]">{APP_NAME}</span>
          <TopNav />
        </header>
        <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
