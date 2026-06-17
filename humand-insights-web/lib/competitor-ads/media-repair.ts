import { createClient } from "@supabase/supabase-js";

import { archiveCompetitorAdMedia } from "./media-archive";
import { fetchAdMedia } from "./scrapecreators";
import type { CompetitorAd } from "./types";

type AdMedia = { images: string[]; videos: string[] };

export async function refreshStoredAdMedia(adArchiveId: string): Promise<AdMedia | null> {
  if (!process.env.SCRAPECREATORS_API_KEY) return null;

  const media = await fetchAdMedia(adArchiveId);
  if (!media || (!media.images.length && !media.videos.length)) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) return media;

  const sb = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data } = await sb
    .from("competitor_ads")
    .select("source, competitor, ad_archive_id")
    .eq("ad_archive_id", adArchiveId)
    .limit(1);
  const row = data?.[0] as Pick<CompetitorAd, "source" | "competitor" | "ad_archive_id"> | undefined;
  const archived = row
    ? await archiveCompetitorAdMedia({ ...row, media } as CompetitorAd, media).catch(() => media)
    : media;

  await sb.from("competitor_ads").update({ media: archived }).eq("ad_archive_id", adArchiveId);

  return archived;
}
