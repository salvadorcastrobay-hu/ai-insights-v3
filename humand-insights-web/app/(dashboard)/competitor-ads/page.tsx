import { CompetitorAdsView } from "@/components/pages/CompetitorAdsView";
import { loadStoredAds, lastRefreshedAt, loadAdInsights } from "@/lib/competitor-ads/store";
import { loadAllOrganicPosts, loadOrganicInsights, loadOrganicProfiles } from "@/lib/competitor-ads/organic-store";
import { DEMO_ADS, DEMO_INSIGHTS } from "@/lib/competitor-ads/demo-data";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getServerUserRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  const roles = await getServerUserRoles();
  const admin = isAdmin(roles as AppRole[]);

  const [stored, dbInsights, refreshedAt, organicPosts, organicInsights, organicProfiles] = await Promise.all([
    loadStoredAds(),
    loadAdInsights(),
    lastRefreshedAt(),
    admin ? loadAllOrganicPosts() : Promise.resolve([]),
    admin ? loadOrganicInsights() : Promise.resolve([]),
    admin ? loadOrganicProfiles() : Promise.resolve([]),
  ]);

  const ads = stored.length ? stored : DEMO_ADS;
  const insights = dbInsights.length ? dbInsights : DEMO_INSIGHTS;

  return (
    <CompetitorAdsView
      ads={ads}
      insights={insights}
      refreshedAt={refreshedAt ?? insights[0]?.generated_at ?? null}
      canRefresh={admin}
      organicPosts={organicPosts}
      organicInsights={organicInsights}
      organicProfiles={organicProfiles}
    />
  );
}
