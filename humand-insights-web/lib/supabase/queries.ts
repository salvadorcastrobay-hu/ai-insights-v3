import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getPg } from "@/lib/supabase/pg";

import {
  isOwnBrand,
  normalizeAcquisitionChannel,
  normalizeCompetitor,
  normalizeCountry,
  normalizeIndustry,
  normalizeRegion,
} from "@/lib/data/normalizers";
import type {
  DealSourceFields,
  EnrichedDealSourceFields,
  InsightRow,
} from "@/lib/supabase/types";
import { LOAD_DATA_COLUMNS } from "@/lib/supabase/types";

const LOAD_DATA_SELECT = LOAD_DATA_COLUMNS.join(",");

function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function cleanScalar(value: unknown): string | null {
  if (value == null) return null;
  const stringified = String(value).trim();
  return stringified ? stringified : null;
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function deriveDealSource(props: Record<string, unknown>): DealSourceFields {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = props[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return null;
  };

  return {
    deal_source: pick(
      "origen_del_contacto__from_where_we_got_the_call_",
      "deal_source__bdr_",
      "sqo_source_channel",
      "hs_analytics_source",
      "hs_object_source_label",
    ),
    deal_source_detail: pick(
      "inbound_source",
      "partner_name",
      "hs_analytics_source_data_1",
      "hs_analytics_latest_source_data_1",
    ),
    inbound_source: pick("inbound_source"),
    partner_name: pick("partner_name"),
  };
}

export function enrichWithDealSource(
  row: InsightRow,
  fields: Partial<DealSourceFields> = {},
): InsightRow {
  const deal_source = fields.deal_source ?? row.deal_source ?? null;
  const deal_source_detail = fields.deal_source_detail ?? row.deal_source_detail ?? null;
  const inbound_source = fields.inbound_source ?? row.inbound_source ?? null;
  const partner_name = fields.partner_name ?? row.partner_name ?? null;

  return {
    ...row,
    country: normalizeCountry(row.country),
    industry: normalizeIndustry(row.industry),
    region: normalizeRegion(row.region, row.country),
    competitor_name: normalizeCompetitor(row.competitor_name),
    is_own_brand_competitor: isOwnBrand(row.competitor_name),
    call_date: toIsoDate(row.call_date),
    amount: row.amount == null ? null : Number(row.amount),
    deal_source,
    deal_source_detail,
    inbound_source,
    partner_name,
    acquisition_channel: normalizeAcquisitionChannel(deal_source, deal_source_detail),
  };
}

export async function loadDealProperties(
  dealIds: string[],
  _client?: SupabaseClient,
): Promise<Record<string, EnrichedDealSourceFields>> {
  if (!dealIds.length) return {};

  const uniqueDealIds = [...new Set(dealIds.filter(Boolean))];
  const sql = getPg();

  // One bulk query via direct Postgres instead of paginated PostgREST chunks.
  const rows = await sql<{ deal_id: string; properties: unknown }[]>`
    SELECT deal_id, properties
    FROM raw_deals
    WHERE deal_id = ANY(${uniqueDealIds})
  `;

  const entries: Array<[string, EnrichedDealSourceFields]> = [];
  for (const item of rows) {
    const dealId = cleanScalar(item.deal_id);
    if (!dealId) continue;

    const derived = deriveDealSource(asObject(item.properties));
    entries.push([
      dealId,
      {
        ...derived,
        acquisition_channel: normalizeAcquisitionChannel(
          derived.deal_source,
          derived.deal_source_detail,
        ),
      },
    ]);
  }

  return Object.fromEntries(entries);
}

// Memory cap del Vercel Function en Hobby plan = 1024MB. Sin un date filter
// la tabla crece linealmente y termina OOMeando. Default = 18 meses, suficiente
// para análisis típicos. Tunable vía env LOAD_INSIGHTS_DAYS.
const LOAD_INSIGHTS_DAYS = Number(process.env.LOAD_INSIGHTS_DAYS ?? "540");

// Campos pesados (texto largo) que se truncan al load para reducir memoria.
// Las pages que renderizan estos campos típicamente no muestran >500 chars.
const TRUNCATE_AT = 500;

function truncateField(value: unknown): string | null {
  if (typeof value !== "string") return value as string | null;
  if (value.length <= TRUNCATE_AT) return value;
  return value.slice(0, TRUNCATE_AT - 1).trimEnd() + "…";
}

export async function loadInsightsImpl(
  promptVersion = "v3.0",
  _pageSize = 1000,
  _client?: SupabaseClient,
): Promise<InsightRow[]> {
  const sql = getPg();

  // Bulk fetch via direct Postgres con date filter para fit en memoria.
  // Quote column identifiers so reserved words like "module" work.
  const quotedCols = LOAD_DATA_COLUMNS.map((c) => `"${c}"`).join(", ");
  const rawRows = await sql.unsafe(
    `SELECT ${quotedCols}
       FROM v_insights_dashboard
      WHERE prompt_version = $1
        AND (call_date IS NULL OR call_date >= (CURRENT_DATE - $2::int))
      ORDER BY id`,
    [promptVersion, LOAD_INSIGHTS_DAYS],
  );
  const rows = rawRows as unknown as InsightRow[];

  // Truncar campos de texto pesados in-place para bajar memoria de Sets/Maps
  // y serialización RSC.
  for (const row of rows) {
    if (row.verbatim_quote && typeof row.verbatim_quote === "string" && row.verbatim_quote.length > TRUNCATE_AT) {
      row.verbatim_quote = truncateField(row.verbatim_quote);
    }
    if (row.summary && typeof row.summary === "string" && row.summary.length > TRUNCATE_AT) {
      row.summary = truncateField(row.summary) as string;
    }
    if ((row as { gap_description?: string | null }).gap_description) {
      const desc = (row as { gap_description?: string | null }).gap_description;
      if (typeof desc === "string" && desc.length > TRUNCATE_AT) {
        (row as { gap_description?: string | null }).gap_description = truncateField(desc);
      }
    }
  }

  const dealIds = [
    ...new Set(rows.map((row) => row.deal_id).filter((value): value is string => Boolean(value))),
  ];
  const dealProps = await loadDealProperties(dealIds);

  return rows.map((row) => enrichWithDealSource(row, dealProps[row.deal_id ?? ""] ?? {}));
}

// Module-level in-memory cache. We avoid next/cache's `unstable_cache` because
// it silently drops entries >~2MB, and the insights payload is ~30-50MB.
// This cache is per-container (each warm Vercel function instance keeps its
// own copy), but that's fine — it stays hot for several minutes under load,
// which covers normal navigation between dashboard pages.
type CacheEntry<T> = { value: T; expiresAt: number; promise?: Promise<T> };
const TTL_MS = 60 * 60 * 1000; // 1 hour

const globalCache = globalThis as unknown as {
  __humand_insights_cache?: Map<string, CacheEntry<unknown>>;
};
if (!globalCache.__humand_insights_cache) {
  globalCache.__humand_insights_cache = new Map();
}
const memCache = globalCache.__humand_insights_cache;

async function memoize<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = memCache.get(key) as CacheEntry<T> | undefined;

  if (existing && existing.expiresAt > now) {
    return existing.value;
  }
  // If a fetch is already in flight, piggyback on its promise so we don't
  // fire two parallel 10s queries when two requests arrive at the same time.
  if (existing?.promise) {
    return existing.promise;
  }

  const promise = loader().then((value) => {
    memCache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  }).catch((err) => {
    memCache.delete(key);
    throw err;
  });

  memCache.set(key, {
    value: (existing?.value ?? undefined) as T,
    expiresAt: existing?.expiresAt ?? 0,
    promise,
  });

  return promise;
}

// Preserve per-request React.cache() dedupe on top of the cross-request cache.
export const loadInsights = cache(
  async (promptVersion = "v3.0"): Promise<InsightRow[]> =>
    memoize(`insights:${promptVersion}`, () => loadInsightsImpl(promptVersion)),
);

async function loadInsightsTotalCountImpl(): Promise<number> {
  const sql = getPg();
  const rows = await sql<{ c: string }[]>`SELECT COUNT(*)::text AS c FROM raw_transcripts`;
  return Number(rows[0]?.c ?? 0);
}

export const loadInsightsTotalCount = cache(
  async (_client?: SupabaseClient): Promise<number> =>
    memoize("insights-total-count", () => loadInsightsTotalCountImpl()),
);

export const loadTotalTranscriptsCount = loadInsightsTotalCount;
