import { createHash, randomUUID } from "crypto";

import { fetchInstagramFeed, type RawInstagramPost } from "@/lib/competitor-ads/apify";
import { MONITORED_COMPETITORS } from "@/lib/competitor-ads/config";
import { archiveOrganicPostMedia } from "@/lib/competitor-ads/organic-media-archive";
import { analyzeOrganic } from "@/lib/competitor-ads/organic-analyze";
import {
  insertMetricSnapshots,
  saveOrganicInsight,
  type OrganicPost,
  upsertOrganicProfile,
  upsertPosts,
} from "@/lib/competitor-ads/organic-store";

export type OrganicRefreshResult = {
  competitor: string;
  handle: string;
  fetched: number;
  skipped: number;
  archived: number;
  upserted: number;
  analyzed: boolean;
  maxAnalyze: number;
  error?: string;
  analyzeError?: string;
};

export type OrganicRefreshJob = {
  id: string;
  state: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  current: string | null;
  totalUpserted: number;
  results: OrganicRefreshResult[];
  error?: string;
};

export type OrganicRefreshJobOptions = {
  maxItems: number;
  maxAnalyze: number;
  maxArchivePosts: number;
  archiveVideos: boolean;
};

const DEFAULT_JOB_OPTIONS: OrganicRefreshJobOptions = {
  maxItems: 50,
  maxAnalyze: 200,
  maxArchivePosts: 25,
  archiveVideos: false,
};

type OrganicRefreshJobStore = {
  jobs: Map<string, OrganicRefreshJob>;
  activeJobId: string | null;
  latestJobId: string | null;
};

const GLOBAL_KEY = "__humandOrganicRefreshJobs";

function store(): OrganicRefreshJobStore {
  const globalRef = globalThis as typeof globalThis & { [GLOBAL_KEY]?: OrganicRefreshJobStore };
  if (!globalRef[GLOBAL_KEY]) {
    globalRef[GLOBAL_KEY] = { jobs: new Map(), activeJobId: null, latestJobId: null };
  }
  return globalRef[GLOBAL_KEY];
}

function touch(job: OrganicRefreshJob): void {
  job.updatedAt = new Date().toISOString();
}

function normalizeFormat(type: string | undefined | null): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes("reel")) return "reel";
  if (t.includes("video")) return "video";
  if (t.includes("sidecar") || t.includes("carousel") || t.includes("album")) return "sidecar";
  if (t.includes("image") || t.includes("photo")) return "image";
  return t;
}

function collectMedia(raw: RawInstagramPost): { images: string[]; videos: string[] } {
  const images: string[] = [];
  const videos: string[] = [];
  const add = (list: string[], value: string | null | undefined) => {
    if (value && !list.includes(value)) list.push(value);
  };
  add(images, raw.displayUrl);
  add(videos, raw.videoUrl);
  for (const image of raw.images ?? []) add(images, image);
  for (const child of raw.childPosts ?? []) {
    add(images, child.displayUrl);
    add(videos, child.videoUrl);
  }
  return { images, videos };
}

function idFromInstagramUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const markerIndex = parts.findIndex((part) => ["p", "reel", "tv"].includes(part));
    if (markerIndex >= 0 && parts[markerIndex + 1]) return parts[markerIndex + 1];
  } catch {
    return null;
  }
  return null;
}

function fallbackPostId(raw: RawInstagramPost, competitor: string): string | null {
  const direct = raw.shortCode ?? raw.id ?? idFromInstagramUrl(raw.url);
  if (direct && String(direct).trim()) return String(direct).trim();
  const media = collectMedia(raw);
  const fingerprint = [
    competitor,
    raw.url,
    raw.timestamp,
    raw.displayUrl,
    raw.videoUrl,
    media.images[0],
    media.videos[0],
    raw.caption?.slice(0, 200),
  ]
    .filter(Boolean)
    .join("|");
  if (!fingerprint) return null;
  return `generated_${createHash("sha1").update(fingerprint).digest("hex").slice(0, 16)}`;
}

function mapPost(raw: RawInstagramPost, competitor: string): OrganicPost | null {
  const caption = raw.caption ?? null;
  const media = collectMedia(raw);
  const postId = fallbackPostId(raw, competitor);
  if (!postId) return null;
  return {
    competitor,
    post_id: postId,
    post_url: raw.url ?? null,
    format: normalizeFormat(raw.type),
    caption,
    caption_length: caption ? caption.length : null,
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : [],
    mentions: Array.isArray(raw.mentions) ? raw.mentions : [],
    posted_at: raw.timestamp ? new Date(raw.timestamp).toISOString() : null,
    duration_secs: raw.videoDuration ?? null,
    likes_count: raw.likesCount ?? null,
    comments_count: raw.commentsCount ?? null,
    video_views: raw.videoViewCount ?? null,
    is_pinned: Boolean(raw.isPinned),
    is_paid_partnership: Boolean(raw.isPaidPartnership),
    display_url: media.images[0] ?? raw.displayUrl ?? null,
    media,
    recent_comments: (raw.latestComments ?? [])
      .slice(0, 5)
      .map((c) => ({ text: c.text, timestamp: c.timestamp })),
    raw,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function normalizeOptions(opts: Partial<OrganicRefreshJobOptions>): OrganicRefreshJobOptions {
  return {
    maxItems: Math.min(100, Math.max(10, Number(opts.maxItems ?? DEFAULT_JOB_OPTIONS.maxItems))),
    maxAnalyze: Math.min(500, Math.max(0, Number(opts.maxAnalyze ?? DEFAULT_JOB_OPTIONS.maxAnalyze))),
    maxArchivePosts: Math.min(100, Math.max(0, Number(opts.maxArchivePosts ?? DEFAULT_JOB_OPTIONS.maxArchivePosts))),
    archiveVideos: Boolean(opts.archiveVideos),
  };
}

async function processCompetitor(
  competitor: (typeof MONITORED_COMPETITORS)[number],
  opts: OrganicRefreshJobOptions,
): Promise<OrganicRefreshResult> {
  const handle = competitor.instagramHandle!;
  const result: OrganicRefreshResult = {
    competitor: competitor.name,
    handle,
    fetched: 0,
    skipped: 0,
    archived: 0,
    upserted: 0,
    analyzed: false,
    maxAnalyze: opts.maxAnalyze,
  };

  let profileFollowers: number | null = null;
  try {
    const feed = await fetchInstagramFeed(handle, { maxItems: opts.maxItems });
    result.fetched = feed.posts.length;
    profileFollowers = feed.profile.followers_count;
    await upsertOrganicProfile({
      competitor: competitor.name,
      handle: feed.profile.handle,
      is_own_brand: Boolean(competitor.ownBrand),
      profile_url: feed.profile.profile_url,
      full_name: feed.profile.full_name,
      biography: feed.profile.biography,
      website: feed.profile.website,
      followers_count: feed.profile.followers_count,
      following_count: feed.profile.following_count,
      posts_count: feed.profile.posts_count,
      avatar_url: feed.profile.avatar_url,
      raw: feed.profile.raw,
    });

    const mappedPosts = feed.posts
      .map((p) => mapPost(p, competitor.name))
      .filter((p): p is OrganicPost => Boolean(p));
    result.skipped = feed.posts.length - mappedPosts.length;

    const postsToArchive = mappedPosts.slice(0, opts.maxArchivePosts);
    const archivedPosts = await mapWithConcurrency(postsToArchive, 2, (p) =>
      archiveOrganicPostMedia(p, { archiveVideos: opts.archiveVideos, maxImages: 3 }).catch(() => p),
    );
    result.archived = archivedPosts.length;

    const posts = [...archivedPosts, ...mappedPosts.slice(opts.maxArchivePosts)];
    result.upserted = await upsertPosts(posts);
    await insertMetricSnapshots(posts, profileFollowers).catch((e) =>
      console.warn(`[organic-refresh-job] snapshots ${competitor.name} fallaron:`, e),
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }

  try {
    const synthesis = await analyzeOrganic(competitor.name, {
      language: competitor.language,
      maxPending: opts.maxAnalyze,
    });
    if (synthesis) {
      await saveOrganicInsight(competitor.name, synthesis, "gpt-4o-mini");
      result.analyzed = true;
    } else {
      result.analyzeError = "analyzeOrganic devolvió null";
    }
  } catch (err) {
    result.analyzeError = err instanceof Error ? err.message : String(err);
    console.error(`[organic-refresh-job] analyze ${competitor.name} falló:`, err);
  }

  return result;
}

async function runJob(job: OrganicRefreshJob, opts: OrganicRefreshJobOptions): Promise<void> {
  const jobStore = store();
  job.state = "running";
  touch(job);
  try {
    const targets = MONITORED_COMPETITORS.filter((c) => c.instagramHandle);
    for (const target of targets) {
      job.current = target.name;
      touch(job);
      const result = await processCompetitor(target, opts);
      job.results.push(result);
      job.totalUpserted = job.results.reduce((sum, item) => sum + item.upserted, 0);
      touch(job);
    }
    job.current = null;
    job.state = "completed";
    job.finishedAt = new Date().toISOString();
    touch(job);
  } catch (err) {
    job.current = null;
    job.state = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
    touch(job);
  } finally {
    if (jobStore.activeJobId === job.id) jobStore.activeJobId = null;
  }
}

export function startOrganicRefreshJob(opts: Partial<OrganicRefreshJobOptions>): OrganicRefreshJob {
  const jobStore = store();
  if (jobStore.activeJobId) {
    const active = jobStore.jobs.get(jobStore.activeJobId);
    if (active && (active.state === "queued" || active.state === "running")) return active;
  }

  const now = new Date().toISOString();
  const job: OrganicRefreshJob = {
    id: randomUUID(),
    state: "queued",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    current: null,
    totalUpserted: 0,
    results: [],
  };
  jobStore.jobs.set(job.id, job);
  jobStore.activeJobId = job.id;
  jobStore.latestJobId = job.id;

  const normalized = normalizeOptions(opts);
  setTimeout(() => {
    void runJob(job, normalized);
  }, 0);

  return job;
}

export function getOrganicRefreshJob(jobId?: string | null): OrganicRefreshJob | null {
  const jobStore = store();
  if (jobId) return jobStore.jobs.get(jobId) ?? null;
  if (jobStore.latestJobId) return jobStore.jobs.get(jobStore.latestJobId) ?? null;
  return null;
}
