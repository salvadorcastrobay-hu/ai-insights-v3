import { CompetitorAdsView } from "@/components/pages/CompetitorAdsView";
import { loadStoredAds, lastRefreshedAt, loadAdInsights } from "@/lib/competitor-ads/store";
import { DEMO_ADS, DEMO_INSIGHTS } from "@/lib/competitor-ads/demo-data";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getServerUserRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  // Lee de la DB con timeout corto (2s); si falla o viene vacía, cae al
  // snapshot base. La data viva tiene precedencia cuando está disponible.
  const [stored, dbInsights, refreshedAt, roles] = await Promise.all([
    loadStoredAds(),
    loadAdInsights(),
    lastRefreshedAt(),
    getServerUserRoles(),
  ]);

  const ads = stored.length ? stored : DEMO_ADS;
  const insights = dbInsights.length ? dbInsights : DEMO_INSIGHTS;

  return (
    <CompetitorAdsView
      ads={ads}
      insights={insights}
      refreshedAt={refreshedAt ?? insights[0]?.generated_at ?? null}
      canRefresh={isAdmin(roles as AppRole[])}
    />
  );
}
