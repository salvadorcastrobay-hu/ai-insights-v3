import { createClient } from "@supabase/supabase-js";

import { archiveCompetitorAdMedia } from "./media-archive";
import { fetchAdMedia } from "./scrapecreators";
import type { CompetitorAd } from "./types";

type AdMedia = { images: string[]; videos: string[] };
type MinimalAd = Pick<CompetitorAd, "source" | "competitor" | "ad_archive_id" | "media">;
export type MediaRepairResult = {
  media: AdMedia | null;
  source: "existing_archive" | "scrapecreators_detail" | "none";
};

function hasMedia(media: AdMedia | null): media is AdMedia {
  return Boolean(media && (media.images.length || media.videos.length));
}

function isVolatileMediaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".fbcdn.net") || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

function hasVolatileMedia(media: AdMedia): boolean {
  return [...media.images, ...media.videos].some(isVolatileMediaUrl);
}

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) return null;

  return createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function updateStoredMedia(adArchiveId: string, media: AdMedia): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("competitor_ads").update({ media }).eq("ad_archive_id", adArchiveId);
}

export async function repairStoredAdMedia(ad: MinimalAd): Promise<MediaRepairResult> {
  if (hasMedia(ad.media)) {
    const archived = await archiveCompetitorAdMedia(ad as CompetitorAd, ad.media).catch(() => ad.media);
    if (hasMedia(archived) && !hasVolatileMedia(archived)) {
      await updateStoredMedia(ad.ad_archive_id, archived);
      return { media: archived, source: "existing_archive" };
    }
  }

  if (!process.env.SCRAPECREATORS_API_KEY) return { media: null, source: "none" };

  const media = await fetchAdMedia(ad.ad_archive_id);
  if (!hasMedia(media)) return { media: null, source: "none" };

  const archived = await archiveCompetitorAdMedia({ ...ad, media } as CompetitorAd, media).catch(() => media);
  await updateStoredMedia(ad.ad_archive_id, archived);

  return { media: archived, source: "scrapecreators_detail" };
}

export async function refreshStoredAdMedia(adArchiveId: string): Promise<AdMedia | null> {
  if (!process.env.SCRAPECREATORS_API_KEY) return null;

  const media = await fetchAdMedia(adArchiveId);
  if (!media || (!media.images.length && !media.videos.length)) return null;

  const sb = getSupabase();
  if (!sb) return media;

  const { data } = await sb
    .from("competitor_ads")
    .select("source, competitor, ad_archive_id")
    .eq("ad_archive_id", adArchiveId)
    .limit(1);
  const row = data?.[0] as Pick<CompetitorAd, "source" | "competitor" | "ad_archive_id"> | undefined;
  const archived = row
    ? await archiveCompetitorAdMedia({ ...row, media } as CompetitorAd, media).catch(() => media)
    : media;

  await updateStoredMedia(adArchiveId, archived);

  return archived;
}
