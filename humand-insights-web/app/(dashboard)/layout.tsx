import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AskChartLauncher, AskChartSheet } from "@/components/ask-chart/AskChart";
import { AskChartProvider } from "@/components/ask-chart/AskChartProvider";
import { DrillDownProvider } from "@/components/drill-down/DrillDownProvider";
import { DrillDownSheet } from "@/components/drill-down/DrillDownSheet";
import { AsyncFilterBar } from "@/components/layout/AsyncFilterBar";
import { FilterBarSlot } from "@/components/layout/FilterBarSlot";
import { GlobalFilterBar } from "@/components/layout/GlobalFilterBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Cold warmup of v_insights_dashboard scan takes ~95s; thereafter unstable_cache
// serves in <100ms. Fluid compute Pro plan allows up to 800s.
export const maxDuration = 300;

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const roles: string[] = user.app_metadata?.roles ?? [];
  const userEmail = user.email ?? null;

  return (
    <Suspense fallback={null}>
      <AskChartProvider>
        <DrillDownProvider>
        <div className="flex h-screen overflow-hidden bg-[var(--color-bg-page)]">
          <Sidebar roles={roles} userEmail={userEmail} />
          <div className="flex h-screen flex-1 flex-col overflow-hidden">
            <FilterBarSlot>
              <header className="shrink-0 bg-[var(--color-bg-page)] px-4 pt-4 md:px-6">
                <Suspense fallback={<GlobalFilterBar />}>
                  <AsyncFilterBar />
                </Suspense>
              </header>
            </FilterBarSlot>
            <main className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-4">
              {children}
            </main>
          </div>
          <AskChartLauncher />
          <AskChartSheet />
          <DrillDownSheet />
        </div>
        </DrillDownProvider>
      </AskChartProvider>
    </Suspense>
  );
}
