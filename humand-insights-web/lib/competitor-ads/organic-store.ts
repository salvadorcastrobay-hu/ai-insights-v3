/**
 * Store para contenido orgánico de Instagram de competidores.
 * Mismos patrones que store.ts: PostgREST/Supabase, safeRead defensivo.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type OrganicPostAnalysis = {
  content_type: string;  // "caso_exito"|"producto"|"educativo"|"ugc"|"entretenimiento"|"comunidad"|"evento"|"otro"
  objective: string;     // "awareness"|"engagement"|"educacion"|"comunidad"|"venta"|"otro"
  has_cta: boolean;
  cta_type: string | null; // "link_in_bio"|"dm"|"registrate"|"otro"
  creative_text?: string | null;
  related_pains?: string[];
  persona?: string | null;
  modules?: string[];
  funnel_stage?: string;
  hook?: string | null;
  tone?: string | null;
  cta_strength?: string;
  offer_type?: string | null;
};

export type OrganicPost = {
  competitor: string;
  post_id: string;
  post_url: string | null;
  format: string | null;         // "image"|"video"|"sidecar"|"reel"
  caption: string | null;
  caption_length: number | null;
  hashtags: string[];
  mentions: string[];
  posted_at: string | null;      // ISO
  duration_secs: number | null;
  likes_count: number | null;
  comments_count: number | null;
  video_views: number | null;
  is_pinned: boolean;
  is_paid_partnership: boolean;
  display_url: string | null;
  media: { images: string[]; videos: string[] };
  recent_comments: Array<{ text: string; timestamp: string }>;
  raw: unknown;
};

export type StoredPost = OrganicPost & {
  fetched_at: string;
  analysis: OrganicPostAnalysis | null;
};

export type Tally = { key: string; count: number };

export type OrganicSynthesis = {
  summary: string;
  posting_frequency: { posts_per_week: number; posts_per_month: number };
  format_distribution: Record<string, number>;
  top_content_types: Tally[];
  top_objectives: Tally[];
  top_related_pains?: Tally[];
  top_personas?: Tally[];
  top_modules?: Tally[];
  content_pillars: string[];
  best_performing: Array<{ post_id: string; post_url?: string | null; display_url?: string | null; likes: number; comments: number; caption_snippet: string }>;
  best_by_engagement_rate?: Array<{
    post_id: string;
    engagement_rate: number;
    likes: number;
    comments: number;
    caption_snippet: string;
  }>;
  top_momentum_posts?: Array<{
    post_id: string;
    likes_growth: number;
    comments_growth: number;
    views_growth: number;
    caption_snippet: string;
  }>;
  hashtag_strategy: { top_hashtags: string[]; avg_per_post: number };
  posting_patterns: { by_day: Record<string, number>; by_hour: Record<string, number> };
  gaps_vs_humand?: string[];
  recommendations?: string[];
  overlap_with_ads?: {
    pains_in_both: string[];
    organic_only_pains: string[];
    ads_only_pains: string[];
    pretest_candidates: Array<{ post_id: string; pain: string; caption_snippet: string }>;
  };
  posts_analyzed: number;
  i18n?: Record<string, { summary: string; content_pillars: string[] }>;
};

export type OrganicInsight = {
  competitor: string;
  payload: OrganicSynthesis;
  model: string | null;
  generated_at: string;
};

export type OrganicProfile = {
  competitor: string;
  handle: string;
  is_own_brand: boolean;
  profile_url: string | null;
  full_name: string | null;
  biography: string | null;
  website: string | null;
  followers_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  avatar_url: string | null;
  fetched_at: string;
};

export type OrganicMetricSnapshot = {
  competitor: string;
  post_id: string;
  snapshot_at: string;
  likes_count: number | null;
  comments_count: number | null;
  video_views: number | null;
  followers_count: number | null;
  engagement_rate: number | null;
};

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  _sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  });
  return _sb;
}

let lastReadError: string | null = null;
export function consumeOrganicReadError(): string | null {
  const e = lastReadError;
  lastReadError = null;
  return e;
}

async function safeRead<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), 12_000)),
    ]);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    lastReadError = `${label}: ${msg}`;
    console.warn(`[organic-store.${label}] fallback (${msg}):`, err);
    return fallback;
  }
}

function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

const POST_COLS =
  "competitor, post_id, post_url, format, caption, caption_length, hashtags, mentions, " +
  "posted_at, duration_secs, likes_count, comments_count, video_views, is_pinned, " +
  "is_paid_partnership, display_url, media, recent_comments, analysis, fetched_at";

type Row = Record<string, unknown>;

function mapRow(r: Row): StoredPost {
  return {
    competitor: r.competitor as string,
    post_id: r.post_id as string,
    post_url: (r.post_url as string | null) ?? null,
    format: (r.format as string | null) ?? null,
    caption: (r.caption as string | null) ?? null,
    caption_length: (r.caption_length as number | null) ?? null,
    hashtags: asJson<string[]>(r.hashtags, []),
    mentions: asJson<string[]>(r.mentions, []),
    posted_at: r.posted_at ? new Date(r.posted_at as string).toISOString() : null,
    duration_secs: (r.duration_secs as number | null) ?? null,
    likes_count: (r.likes_count as number | null) ?? null,
    comments_count: (r.comments_count as number | null) ?? null,
    video_views: (r.video_views as number | null) ?? null,
    is_pinned: Boolean(r.is_pinned),
    is_paid_partnership: Boolean(r.is_paid_partnership),
    display_url: (r.display_url as string | null) ?? null,
    media: asJson<{ images: string[]; videos: string[] }>(r.media, { images: [], videos: [] }),
    recent_comments: asJson<Array<{ text: string; timestamp: string }>>(r.recent_comments, []),
    raw: null,
    fetched_at: new Date(r.fetched_at as string).toISOString(),
    analysis: asJson<OrganicPostAnalysis | null>(r.analysis, null),
  };
}

export async function upsertPosts(posts: OrganicPost[]): Promise<number> {
  if (!posts.length) return 0;
  const sb = getSupabase();
  const now = new Date().toISOString();
  const rows = posts.map((p) => ({
    competitor: p.competitor,
    post_id: p.post_id,
    post_url: p.post_url,
    format: p.format,
    caption: p.caption,
    caption_length: p.caption_length,
    hashtags: p.hashtags,
    mentions: p.mentions,
    posted_at: p.posted_at,
    duration_secs: p.duration_secs,
    likes_count: p.likes_count,
    comments_count: p.comments_count,
    video_views: p.video_views,
    is_pinned: p.is_pinned,
    is_paid_partnership: p.is_paid_partnership,
    display_url: p.display_url,
    media: p.media,
    recent_comments: p.recent_comments,
    raw: p.raw ?? null,
    fetched_at: now,
  }));
  const { error } = await sb
    .from("competitor_organic_posts")
    .upsert(rows, { onConflict: "competitor,post_id" });
  if (error) throw new Error(error.message);
  return rows.length;
}

export async function upsertOrganicProfile(profile: Omit<OrganicProfile, "fetched_at"> & { raw?: unknown }): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("competitor_organic_profiles").upsert(
    {
      competitor: profile.competitor,
      handle: profile.handle,
      is_own_brand: profile.is_own_brand,
      profile_url: profile.profile_url,
      full_name: profile.full_name,
      biography: profile.biography,
      website: profile.website,
      followers_count: profile.followers_count,
      following_count: profile.following_count,
      posts_count: profile.posts_count,
      avatar_url: profile.avatar_url,
      raw: profile.raw ?? null,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "competitor" },
  );
  if (error) throw new Error(error.message);
}

export async function loadOrganicProfiles(): Promise<OrganicProfile[]> {
  return safeRead("loadOrganicProfiles", [], async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_organic_profiles")
      .select("competitor, handle, is_own_brand, profile_url, full_name, biography, website, followers_count, following_count, posts_count, avatar_url, fetched_at")
      .order("is_own_brand", { ascending: false })
      .order("competitor", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      competitor: r.competitor as string,
      handle: r.handle as string,
      is_own_brand: Boolean(r.is_own_brand),
      profile_url: (r.profile_url as string | null) ?? null,
      full_name: (r.full_name as string | null) ?? null,
      biography: (r.biography as string | null) ?? null,
      website: (r.website as string | null) ?? null,
      followers_count: (r.followers_count as number | null) ?? null,
      following_count: (r.following_count as number | null) ?? null,
      posts_count: (r.posts_count as number | null) ?? null,
      avatar_url: (r.avatar_url as string | null) ?? null,
      fetched_at: new Date(r.fetched_at as string).toISOString(),
    }));
  });
}

export async function loadOrganicProfile(competitor: string): Promise<OrganicProfile | null> {
  const profiles = await loadOrganicProfiles();
  return profiles.find((p) => p.competitor === competitor) ?? null;
}

export async function insertMetricSnapshots(
  posts: OrganicPost[],
  followersCount: number | null,
): Promise<void> {
  if (!posts.length) return;
  const sb = getSupabase();
  const snapshotAt = new Date().toISOString();
  const rows = posts.map((p) => {
    const likes = p.likes_count ?? 0;
    const comments = p.comments_count ?? 0;
    const engagementRate = followersCount && followersCount > 0 ? (likes + comments) / followersCount : null;
    return {
      competitor: p.competitor,
      post_id: p.post_id,
      snapshot_at: snapshotAt,
      likes_count: p.likes_count,
      comments_count: p.comments_count,
      video_views: p.video_views,
      followers_count: followersCount,
      engagement_rate: engagementRate,
      raw: null,
    };
  });
  const { error } = await sb.from("competitor_organic_metric_snapshots").insert(rows);
  if (error) throw new Error(error.message);
}

export async function loadMetricSnapshotsForCompetitor(competitor: string): Promise<OrganicMetricSnapshot[]> {
  return safeRead("loadMetricSnapshotsForCompetitor", [], async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_organic_metric_snapshots")
      .select("competitor, post_id, snapshot_at, likes_count, comments_count, video_views, followers_count, engagement_rate")
      .eq("competitor", competitor)
      .order("snapshot_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      competitor: r.competitor as string,
      post_id: r.post_id as string,
      snapshot_at: new Date(r.snapshot_at as string).toISOString(),
      likes_count: (r.likes_count as number | null) ?? null,
      comments_count: (r.comments_count as number | null) ?? null,
      video_views: (r.video_views as number | null) ?? null,
      followers_count: (r.followers_count as number | null) ?? null,
      engagement_rate: typeof r.engagement_rate === "number" ? r.engagement_rate : Number(r.engagement_rate ?? 0) || null,
    }));
  });
}

export async function loadPostsForCompetitor(competitor: string): Promise<StoredPost[]> {
  return safeRead("loadPostsForCompetitor", [], async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_organic_posts")
      .select(POST_COLS)
      .eq("competitor", competitor)
      .order("posted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as Row[]).map(mapRow);
  });
}

export async function loadAllOrganicPosts(): Promise<StoredPost[]> {
  return safeRead("loadAllOrganicPosts", [], async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_organic_posts")
      .select(POST_COLS)
      .order("competitor", { ascending: true })
      .order("posted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as Row[]).map(mapRow);
  });
}

export async function savePostAnalysis(
  competitor: string,
  postId: string,
  analysis: OrganicPostAnalysis,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("competitor_organic_posts")
    .update({ analysis })
    .eq("competitor", competitor)
    .eq("post_id", postId);
  if (error) throw new Error(error.message);
}

export async function saveOrganicInsight(
  competitor: string,
  payload: OrganicSynthesis,
  model: string,
): Promise<void> {
  const sb = getSupabase();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("competitor_organic_insights")
    .upsert({ competitor, payload, model, generated_at: now }, { onConflict: "competitor" });
  if (error) throw new Error(error.message);
}

export async function loadOrganicInsights(): Promise<OrganicInsight[]> {
  return safeRead("loadOrganicInsights", [], async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_organic_insights")
      .select("competitor, payload, model, generated_at");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      competitor: r.competitor as string,
      payload: asJson<OrganicSynthesis>(r.payload, {} as OrganicSynthesis),
      model: (r.model as string | null) ?? null,
      generated_at: new Date(r.generated_at as string).toISOString(),
    }));
  });
}
