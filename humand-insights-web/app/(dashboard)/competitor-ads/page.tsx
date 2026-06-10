import { CompetitorAdsView } from "@/components/pages/CompetitorAdsView";
import { loadStoredAds, lastRefreshedAt, loadAdInsights } from "@/lib/competitor-ads/store";
import { DEMO_ADS, DEMO_INSIGHTS } from "@/lib/competitor-ads/demo-data";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getServerUserRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  const [stored, dbInsights, refreshedAt, roles] = await Promise.all([
    loadStoredAds(),
    loadAdInsights(),
    lastRefreshedAt(),
    getServerUserRoles(),
  ]);
  const admin = isAdmin(roles as AppRole[]);

  // La data de DB tiene precedencia; si viene vacía usamos el snapshot base.
  const ads = stored.length ? stored : DEMO_ADS;
  const insights = dbInsights.length ? dbInsights : DEMO_INSIGHTS;

  return (
    <CompetitorAdsView
      ads={ads}
      insights={insights}
      refreshedAt={refreshedAt}
      canRefresh={admin}
    />
  );
}
