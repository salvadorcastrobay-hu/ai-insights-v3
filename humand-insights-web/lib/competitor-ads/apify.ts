/**
 * Conector para Apify instagram-scraper.
 * Trae posts orgánicos del perfil público de un competidor.
 *
 * Requisito: variable APIFY_API_KEY en el entorno.
 */

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_ID = "apify~instagram-scraper";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 180_000; // 3 min — runs lentos en cold start

export type RawInstagramPost = {
  id: string;
  shortCode: string;
  url: string;
  type: string;          // "Image" | "Video" | "Sidecar" | "Reel"
  caption: string | null;
  timestamp: string;     // ISO
  likesCount: number | null;
  commentsCount: number | null;
  videoViewCount: number | null;
  videoDuration: number | null;        // segundos
  isPinned: boolean | null;
  isPaidPartnership: boolean | null;
  hashtags: string[];
  mentions: string[];
  displayUrl: string | null;
  latestComments: Array<{ text: string; timestamp: string }> | null;
};

function apiKey(): string {
  const k = process.env.APIFY_API_KEY;
  if (!k) throw new Error("Falta APIFY_API_KEY en el entorno.");
  return k;
}

async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const key = apiKey();
  const url = `${APIFY_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      ...opts?.headers,
    },
  });
  return res;
}

async function startRun(handle: string, maxItems: number): Promise<string> {
  const res = await apiFetch(`/acts/${ACTOR_ID}/runs`, {
    method: "POST",
    body: JSON.stringify({
      directUrls: [`https://www.instagram.com/${handle}/`],
      resultsType: "posts",
      resultsLimit: maxItems,
      addParentData: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Apify run start failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { data?: { id?: string } };
  const runId = json?.data?.id;
  if (!runId) throw new Error("Apify no devolvió runId");
  return runId;
}

async function pollRun(runId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await apiFetch(`/actor-runs/${runId}`);
    if (!res.ok) continue;
    const json = (await res.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    const status = json?.data?.status;
    if (status === "SUCCEEDED") {
      const datasetId = json?.data?.defaultDatasetId;
      if (!datasetId) throw new Error("Run succeeded pero sin defaultDatasetId");
      return datasetId;
    }
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${runId} terminó con estado: ${status}`);
    }
  }
  throw new Error(`Apify run ${runId} no completó en ${POLL_TIMEOUT_MS / 1000}s`);
}

async function fetchDataset(datasetId: string): Promise<RawInstagramPost[]> {
  const res = await apiFetch(`/datasets/${datasetId}/items?format=json&clean=true`);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Dataset fetch failed (${res.status}): ${text}`);
  }
  const items = (await res.json()) as unknown[];
  return (items ?? []) as RawInstagramPost[];
}

/**
 * Trae posts orgánicos de Instagram para un handle dado.
 * Inicia un run en Apify, espera que termine, y devuelve los items.
 */
export async function fetchInstagramPosts(
  handle: string,
  opts: { maxItems?: number } = {},
): Promise<RawInstagramPost[]> {
  const maxItems = opts.maxItems ?? 50;
  const runId = await startRun(handle, maxItems);
  const datasetId = await pollRun(runId);
  return fetchDataset(datasetId);
}
