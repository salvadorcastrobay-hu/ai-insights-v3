import { CompetitorAdsView } from "@/components/pages/CompetitorAdsView";
import { loadStoredAds, lastRefreshedAt, loadAdInsights } from "@/lib/competitor-ads/store";
import { loadAllOrganicPosts, loadOrganicInsights, loadOrganicProfiles } from "@/lib/competitor-ads/organic-store";
import { DEMO_ADS, DEMO_INSIGHTS } from "@/lib/competitor-ads/demo-data";
import { isAdSourceWipEnabled } from "@/lib/competitor-ads/config";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getServerUserRoles, getServerUserEmail } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  const [roles, email] = await Promise.all([getServerUserRoles(), getServerUserEmail()]);
  const admin = isAdmin(roles as AppRole[]);
  const canRefreshWipSources = admin && isAdSourceWipEnabled(email);

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
      canRefreshWipSources={canRefreshWipSources}
      organicPosts={organicPosts}
      organicInsights={organicInsights}
      organicProfiles={organicProfiles}
    />
  );
}
