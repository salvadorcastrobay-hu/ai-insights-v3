import { randomUUID } from "crypto";

import { MONITORED_COMPETITORS } from "@/lib/competitor-ads/config";
import { fetchCompanyAds } from "@/lib/competitor-ads/scrapecreators";
import { fetchLinkedInAds } from "@/lib/competitor-ads/linkedin";
import { fetchGoogleAds } from "@/lib/competitor-ads/googleads";
import { upsertAds, markInactiveAds, saveAdInsight } from "@/lib/competitor-ads/store";
import { analyzeCompetitor, adsModel } from "@/lib/competitor-ads/analyze";
import type { AdSource } from "@/lib/competitor-ads/types";

// Refresh de ads pagos como job en background con polling — mismo patrón que
// organic-refresh-job.ts. Antes esto corría síncrono en una sola request HTTP
// sobre ~46 competidores × análisis LLM, superaba el timeout de Railway y
// devolvía "upstream error" (solo alcanzaba a procesar los primeros). Ahora la
// request arranca el job y devuelve al toque; el cliente pollea el estado.

export type PaidRefreshResult = {
  competitor: string;
  source: string;
  fetched: number;
  upserted: number;
  deactivated: number;
  analyzed: boolean;
  error?: string;
  analyzeError?: string;
};

export type PaidRefreshJob = {
  id: string;
  state: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  current: string | null;
  totalUpserted: number;
  results: PaidRefreshResult[];
  error?: string;
};

export type PaidRefreshJobOptions = {
  sources: AdSource[];
  competitorFilter: Set<string> | null;
};

type PaidRefreshJobStore = {
  jobs: Map<string, PaidRefreshJob>;
  activeJobId: string | null;
  latestJobId: string | null;
};

const GLOBAL_KEY = "__humandPaidRefreshJobs";

function store(): PaidRefreshJobStore {
  const globalRef = globalThis as typeof globalThis & { [GLOBAL_KEY]?: PaidRefreshJobStore };
  if (!globalRef[GLOBAL_KEY]) {
    globalRef[GLOBAL_KEY] = { jobs: new Map(), activeJobId: null, latestJobId: null };
  }
  return globalRef[GLOBAL_KEY];
}

function touch(job: PaidRefreshJob): void {
  job.updatedAt = new Date().toISOString();
}

// Corre tasks con un cap de concurrencia (gentil con la API externa).
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function processCompetitor(
  c: (typeof MONITORED_COMPETITORS)[number],
): Promise<PaidRefreshResult> {
  const r: PaidRefreshResult = {
    competitor: c.name,
    source: c.source,
    fetched: 0,
    upserted: 0,
    deactivated: 0,
    analyzed: false,
  };
  try {
    if (c.source === "meta_ads") {
      const ads = await fetchCompanyAds(c.name, {
        companyName: c.query,
        pageId: c.pageId,
        country: "ALL",
        status: "ACTIVE",
        sortBy: "relevancy_monthly_grouped",
        maxPages: c.maxPages ?? 1,
        // DCO/multi-version vienen sin creativo en el listado → completar
        // vía detalle por aviso (1 crédito extra c/u, solo los vacíos).
        enrichMissingMedia: true,
      });
      r.fetched = ads.length;
      r.upserted = await upsertAds(ads);
      r.deactivated = await markInactiveAds(c.name, c.source, new Set(ads.map((a) => a.ad_archive_id)));
    } else if (c.source === "linkedin_ads") {
      const ads = await fetchLinkedInAds(c.name, {
        company: c.query,
        maxPages: c.maxPages ?? 2,
        matchName: c.linkedinAdvertiserName,
      });
      r.fetched = ads.length;
      r.upserted = await upsertAds(ads);
      r.deactivated = await markInactiveAds(c.name, c.source, new Set(ads.map((a) => a.ad_archive_id)));
    } else if (c.source === "google_ads") {
      if (!c.googleDomain) throw new Error("Falta googleDomain en la config del competidor");
      const ads = await fetchGoogleAds(c.name, { domain: c.googleDomain });
      r.fetched = ads.length;
      r.upserted = await upsertAds(ads);
      r.deactivated = await markInactiveAds(c.name, c.source, new Set(ads.map((a) => a.ad_archive_id)));
    }
    // Análisis IA (no rompe el refresh si falla, pero el error se reporta).
    try {
      const synthesis = await analyzeCompetitor(c.name, c.source, { language: c.language });
      if (synthesis) {
        await saveAdInsight(c.name, c.source, synthesis, adsModel());
        r.analyzed = true;
      } else {
        r.analyzeError = "analyzeCompetitor devolvió null (sin avisos)";
      }
    } catch (e) {
      r.analyzeError = e instanceof Error ? e.message : String(e);
      console.error(`[paid-refresh-job] analyze ${c.name} falló:`, e);
    }
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
  return r;
}

async function runJob(job: PaidRefreshJob, opts: PaidRefreshJobOptions): Promise<void> {
  const jobStore = store();
  job.state = "running";
  touch(job);
  try {
    for (const source of opts.sources) {
      const targets = MONITORED_COMPETITORS.filter(
        (c) =>
          !c.ownBrand &&
          c.source === source &&
          (!opts.competitorFilter || opts.competitorFilter.has(c.name.toLowerCase())),
      );
      let done = 0;
      await pooled(targets, 3, async (c) => {
        const result = await processCompetitor(c);
        job.results.push(result);
        done += 1;
        job.current = `${source} (${done}/${targets.length})`;
        job.totalUpserted = job.results.reduce((sum, item) => sum + item.upserted, 0);
        touch(job);
      });
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

export function startPaidRefreshJob(opts: PaidRefreshJobOptions): PaidRefreshJob {
  const jobStore = store();
  if (jobStore.activeJobId) {
    const active = jobStore.jobs.get(jobStore.activeJobId);
    if (active && (active.state === "queued" || active.state === "running")) return active;
  }

  const now = new Date().toISOString();
  const job: PaidRefreshJob = {
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

  setTimeout(() => {
    void runJob(job, opts);
  }, 0);

  return job;
}

export function getPaidRefreshJob(jobId?: string | null): PaidRefreshJob | null {
  const jobStore = store();
  if (jobId) return jobStore.jobs.get(jobId) ?? null;
  if (jobStore.latestJobId) return jobStore.jobs.get(jobStore.latestJobId) ?? null;
  return null;
}
