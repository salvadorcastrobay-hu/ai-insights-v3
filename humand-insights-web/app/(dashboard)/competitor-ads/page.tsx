import { CompetitorAdsView } from "@/components/pages/CompetitorAdsView";
import { loadStoredAds, lastRefreshedAt, loadAdInsights } from "@/lib/competitor-ads/store";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getServerUserRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  // Solo lee de la DB (carga instantánea). El fetch externo + análisis IA es
  // on-demand, vía el botón "Actualizar" → /api/competitor-ads/refresh.
  const [ads, insights, refreshedAt, roles] = await Promise.all([
    loadStoredAds(),
    loadAdInsights(),
    lastRefreshedAt(),
    getServerUserRoles(),
  ]);

  return (
    <CompetitorAdsView
      ads={ads}
      insights={insights}
      refreshedAt={refreshedAt}
      canRefresh={isAdmin(roles as AppRole[])}
    />
  );
}
