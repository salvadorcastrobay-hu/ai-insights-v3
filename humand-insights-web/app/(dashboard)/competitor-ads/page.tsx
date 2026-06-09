import { CompetitorAdsView } from "@/components/pages/CompetitorAdsView";
import { loadStoredAds, lastRefreshedAt } from "@/lib/competitor-ads/store";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getServerUserRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  // Solo lee de la tabla (carga instantánea). El fetch externo es on-demand,
  // vía el botón "Actualizar" → /api/competitor-ads/refresh.
  const [ads, refreshedAt, roles] = await Promise.all([
    loadStoredAds(),
    lastRefreshedAt(),
    getServerUserRoles(),
  ]);

  return (
    <CompetitorAdsView
      ads={ads}
      refreshedAt={refreshedAt}
      canRefresh={isAdmin(roles as AppRole[])}
    />
  );
}
