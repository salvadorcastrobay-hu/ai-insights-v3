import { CompetitorAdsView } from "@/components/pages/CompetitorAdsView";
import { DEMO_ADS, DEMO_INSIGHTS } from "@/lib/competitor-ads/demo-data";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getServerUserRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  // Por ahora la página sirve el snapshot base directamente (sin pegar a la DB,
  // cuya conexión getPg está en revisión). Carga instantánea.
  const roles = await getServerUserRoles();

  return (
    <CompetitorAdsView
      ads={DEMO_ADS}
      insights={DEMO_INSIGHTS}
      refreshedAt={DEMO_INSIGHTS[0]?.generated_at ?? null}
      canRefresh={isAdmin(roles as AppRole[])}
    />
  );
}
