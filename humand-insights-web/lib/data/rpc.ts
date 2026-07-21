/**
 * Wrappers tipados sobre Supabase RPC para agregaciones server-side.
 *
 * Cada función:
 *  - Llama a una RPC de Postgres (definida en migrations/*_rpc_functions.py).
 *  - Devuelve data YA AGREGADA, evitando cargar 30K+ rows a Node.
 *  - Es STABLE (read-only) — no muta nada en la DB.
 *
 * Si la RPC falla (network, función inexistente, etc.), la función devuelve
 * un fallback razonable + loguea el error. NUNCA tira excepción al caller —
 * las pages tienen que ser robustas a una RPC caída.
 */

import { createClient } from "@supabase/supabase-js";

import type { Filters } from "@/lib/data/filters";

// ─── Cliente Supabase con service_role (server-side only) ─────────────
// IMPORTANTE: no exportar al cliente. Solo Server Components / API routes.

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Timeout duro: si una RPC se cuelga (PostgREST no tiene statement_timeout
    // por default), abortamos a los 25s. Los wrappers cachean el error y
    // devuelven fallback → la página renderiza en vez de quedar en skeleton
    // infinito, y el console.warn deja en los logs qué RPC falló.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(25_000) }),
    },
  });
}

// ─── Helper: convertir Filters TS a JSONB compatible con _filter_insights ─

export function filtersToJsonb(filters: Filters): Record<string, unknown> {
  return {
    prompt_version: process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.2",
    types: filters.types ?? [],
    regions: filters.regions ?? [],
    segments: filters.segments ?? [],
    countries: filters.countries ?? [],
    industries: filters.industries ?? [],
    owners: filters.owners ?? [],
    modules: [],
    categories: filters.categories ?? [],
    channels: filters.channels ?? [],
    sources: filters.sources ?? [],
    date_start: filters.date_start ?? null,
    date_end: filters.date_end ?? null,
    min_confidence: filters.min_confidence ?? null,
    // Validadas: default ON en todas las pages. Solo se apaga con validated===false.
    validated: filters.validated === false ? null : "true",
    clients: filters.clients ? "true" : null,
  };
}

// ─── RPC #1: get_kpis ─────────────────────────────────────────────────

export type KpisResult = {
  total_insights: number;
  total_calls: number;
  deals_matched: number;
  revenue_usd: number;
  insights_per_call: number;
};

const EMPTY_KPIS: KpisResult = {
  total_insights: 0,
  total_calls: 0,
  deals_matched: 0,
  revenue_usd: 0,
  insights_per_call: 0,
};

export async function getKpis(filters: Filters): Promise<KpisResult> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("get_kpis", {
      f: filtersToJsonb(filters),
    });
    if (error) {
      console.warn("[rpc.getKpis] error:", error.message);
      return EMPTY_KPIS;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return EMPTY_KPIS;
    return {
      total_insights: Number(row.total_insights ?? 0),
      total_calls: Number(row.total_calls ?? 0),
      deals_matched: Number(row.deals_matched ?? 0),
      revenue_usd: Number(row.revenue_usd ?? 0),
      insights_per_call: Number(row.insights_per_call ?? 0),
    };
  } catch (exc) {
    console.warn("[rpc.getKpis] threw:", exc);
    return EMPTY_KPIS;
  }
}

// ─── RPC genéricas (espejo de dashboard-aggregations.ts) ──────────────

export type NameValue = { name: string; value: number };
export type NameValuePct = { name: string; value: number; pct: number };

type ScopeOpts = {
  /** insight_type raw: "pain" | "product_gap" | "competitive_signal" | ... */
  scope?: string | null;
  /** excluir is_own_brand_competitor (para competitive_signal) */
  excludeOwnBrand?: boolean;
  n?: number;
};

/** Top N labels por # de transcripts distintos. Espeja groupDistinctTranscripts(). */
export async function rpcGroupDistinct(
  filters: Filters,
  dim: string,
  opts: ScopeOpts = {},
): Promise<NameValue[]> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("rpc_group_distinct", {
      f: filtersToJsonb(filters),
      dim,
      scope: opts.scope ?? null,
      exclude_own_brand: opts.excludeOwnBrand ?? false,
      n: opts.n ?? 15,
    });
    if (error) {
      console.warn("[rpc.groupDistinct] error:", error.message);
      return [];
    }
    return (data ?? []).map((r: { name: string; value: number | string }) => ({
      name: r.name,
      value: Number(r.value ?? 0),
    }));
  } catch (exc) {
    console.warn("[rpc.groupDistinct] threw:", exc);
    return [];
  }
}

/** Top N con % sobre `total`. Espeja groupWithPct()/painsWithPct(). */
export async function rpcGroupWithPct(
  filters: Filters,
  dim: string,
  total: number,
  opts: ScopeOpts = {},
): Promise<NameValuePct[]> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("rpc_group_with_pct", {
      f: filtersToJsonb(filters),
      dim,
      total,
      scope: opts.scope ?? null,
      exclude_own_brand: opts.excludeOwnBrand ?? false,
      n: opts.n ?? 15,
    });
    if (error) {
      console.warn("[rpc.groupWithPct] error:", error.message);
      return [];
    }
    return (data ?? []).map(
      (r: { name: string; value: number | string; pct: number | string }) => ({
        name: r.name,
        value: Number(r.value ?? 0),
        pct: Number(r.pct ?? 0),
      }),
    );
  } catch (exc) {
    console.warn("[rpc.groupWithPct] threw:", exc);
    return [];
  }
}

/** Suma de amount por deal único, agrupado por dim. Espeja revenueByFeature(). */
export async function rpcRevenueBy(
  filters: Filters,
  dim: string,
  opts: ScopeOpts = {},
): Promise<NameValue[]> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("rpc_revenue_by", {
      f: filtersToJsonb(filters),
      dim,
      scope: opts.scope ?? null,
      exclude_own_brand: opts.excludeOwnBrand ?? false,
      n: opts.n ?? 15,
    });
    if (error) {
      console.warn("[rpc.revenueBy] error:", error.message);
      return [];
    }
    return (data ?? []).map((r: { name: string; value: number | string }) => ({
      name: r.name,
      value: Number(r.value ?? 0),
    }));
  } catch (exc) {
    console.warn("[rpc.revenueBy] threw:", exc);
    return [];
  }
}

// ─── rpc_sample_stats → DataQualityFooter ─────────────────────────────

export type SampleStatsRpc = {
  unique_calls: number;
  unique_deals: number;
  insights_count: number;
  period_start: string | null;
  period_end: string | null;
  avg_confidence: number | null;
  high_confidence_pct: number | null;
};

export async function rpcSampleStats(filters: Filters): Promise<SampleStatsRpc | null> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("rpc_sample_stats", {
      f: filtersToJsonb(filters),
    });
    if (error) {
      console.warn("[rpc.sampleStats] error:", error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      unique_calls: Number(row.unique_calls ?? 0),
      unique_deals: Number(row.unique_deals ?? 0),
      insights_count: Number(row.insights_count ?? 0),
      period_start: row.period_start ?? null,
      period_end: row.period_end ?? null,
      avg_confidence: row.avg_confidence == null ? null : Number(row.avg_confidence),
      high_confidence_pct:
        row.high_confidence_pct == null ? null : Number(row.high_confidence_pct),
    };
  } catch (exc) {
    console.warn("[rpc.sampleStats] threw:", exc);
    return null;
  }
}

// ─── RPC de pivot + bespoke (regional-gtm) ────────────────────────────

export type StackResult = { data: Array<Record<string, string | number>>; stackKeys: string[] };
export type HeatmapResult = { rowLabels: string[]; colLabels: string[]; values: number[][] };

type StackOpts = ScopeOpts & { topStackN?: number };

export async function rpcStack(
  filters: Filters,
  yDim: string,
  stackDim: string,
  opts: StackOpts = {},
): Promise<StackResult> {
  const empty: StackResult = { data: [], stackKeys: [] };
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("rpc_stack", {
      f: filtersToJsonb(filters),
      y_dim: yDim,
      stack_dim: stackDim,
      scope: opts.scope ?? null,
      exclude_own_brand: opts.excludeOwnBrand ?? false,
      top_n: opts.n ?? 10,
      top_stack_n: opts.topStackN ?? 8,
    });
    if (error) {
      console.warn("[rpc.stack] error:", error.message);
      return empty;
    }
    return (data as StackResult) ?? empty;
  } catch (exc) {
    console.warn("[rpc.stack] threw:", exc);
    return empty;
  }
}

export async function rpcHeatmap(
  filters: Filters,
  rowDim: string,
  colDim: string,
  opts: ScopeOpts & { nRows?: number; nCols?: number } = {},
): Promise<HeatmapResult> {
  const empty: HeatmapResult = { rowLabels: [], colLabels: [], values: [] };
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("rpc_heatmap", {
      f: filtersToJsonb(filters),
      row_dim: rowDim,
      col_dim: colDim,
      scope: opts.scope ?? null,
      exclude_own_brand: opts.excludeOwnBrand ?? false,
      n_rows: opts.nRows ?? 15,
      n_cols: opts.nCols ?? 10,
    });
    if (error) {
      console.warn("[rpc.heatmap] error:", error.message);
      return empty;
    }
    return (data as HeatmapResult) ?? empty;
  } catch (exc) {
    console.warn("[rpc.heatmap] threw:", exc);
    return empty;
  }
}

export type PipelineGridRow = { segment: string; region: string; revenue: number; deals: number };
export type PainRegionRow = { region: string; pain: string; demos: number; pct: number };
export type CompetitorCountryRowRpc = {
  country: string;
  competitor: string;
  mentions: number;
  top_relationship: string;
};

async function rpcRows<T>(
  fn: string,
  filters: Filters,
  extra: Record<string, unknown> = {},
): Promise<T[]> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc(fn, { f: filtersToJsonb(filters), ...extra });
    if (error) {
      console.warn(`[rpc.${fn}] error:`, error.message);
      return [];
    }
    return (data ?? []) as T[];
  } catch (exc) {
    console.warn(`[rpc.${fn}] threw:`, exc);
    return [];
  }
}

export const rpcPipelineGrid = (f: Filters) =>
  rpcRows<PipelineGridRow>("rpc_pipeline_grid", f).then((rows) =>
    rows.map((r) => ({ ...r, revenue: Number(r.revenue), deals: Number(r.deals) })),
  );
export const rpcPainRegionPct = (f: Filters) =>
  rpcRows<PainRegionRow>("rpc_pain_region_pct", f).then((rows) =>
    rows.map((r) => ({ ...r, demos: Number(r.demos), pct: Number(r.pct) })),
  );
export const rpcCompetitorsByCountry = (f: Filters) =>
  rpcRows<CompetitorCountryRowRpc>("rpc_competitors_by_country", f).then((rows) =>
    rows.map((r) => ({ ...r, mentions: Number(r.mentions) })),
  );

// ─── competitive-intelligence ─────────────────────────────────────────

export type CompetitiveKpisRpc = {
  relevant_competitors: number;
  deals_with_signal: number;
  total_deals: number;
  comp_revenue: number;
};
export type MigrationRowRpc = {
  id: string;
  company: string;
  competitor: string;
  relationship: string;
  industry: string;
  country: string;
  segment: string;
  revenue: number;
  stage: string;
  owner: string;
  deal: string;
};

export async function rpcCompetitiveKpis(filters: Filters): Promise<CompetitiveKpisRpc> {
  const empty: CompetitiveKpisRpc = {
    relevant_competitors: 0,
    deals_with_signal: 0,
    total_deals: 0,
    comp_revenue: 0,
  };
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("rpc_competitive_kpis", { f: filtersToJsonb(filters) });
    if (error) {
      console.warn("[rpc.competitiveKpis] error:", error.message);
      return empty;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return empty;
    return {
      relevant_competitors: Number(row.relevant_competitors ?? 0),
      deals_with_signal: Number(row.deals_with_signal ?? 0),
      total_deals: Number(row.total_deals ?? 0),
      comp_revenue: Number(row.comp_revenue ?? 0),
    };
  } catch (exc) {
    console.warn("[rpc.competitiveKpis] threw:", exc);
    return empty;
  }
}

export const rpcMigrationRows = (f: Filters) =>
  rpcRows<MigrationRowRpc>("rpc_migration_rows", f).then((rows) =>
    rows.map((r) => ({ ...r, revenue: Number(r.revenue) })),
  );

// ─── executive-summary ────────────────────────────────────────────────

export type BreakdownGroup = { name: string; data: NameValue[] };
export type KpisNormRpc = {
  total_calls: number;
  deals_matched: number;
  revenue: number;
  insights_per_call: number;
};

async function rpcJson<T>(fn: string, filters: Filters, extra: Record<string, unknown> = {}, fallback: T): Promise<T> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc(fn, { f: filtersToJsonb(filters), ...extra });
    if (error) {
      console.warn(`[rpc.${fn}] error:`, error.message);
      return fallback;
    }
    return (data as T) ?? fallback;
  } catch (exc) {
    console.warn(`[rpc.${fn}] threw:`, exc);
    return fallback;
  }
}

export async function rpcKpisNorm(filters: Filters): Promise<KpisNormRpc> {
  const empty: KpisNormRpc = { total_calls: 0, deals_matched: 0, revenue: 0, insights_per_call: 0 };
  const row = await rpcRows<KpisNormRpc>("rpc_kpis_norm", filters);
  const r = row[0];
  if (!r) return empty;
  return {
    total_calls: Number(r.total_calls ?? 0),
    deals_matched: Number(r.deals_matched ?? 0),
    revenue: Number(r.revenue ?? 0),
    insights_per_call: Number(r.insights_per_call ?? 0),
  };
}

export const rpcModuleDemand = (f: Filters, n = 12) =>
  rpcRows<{ name: string; value: number | string }>("rpc_module_demand", f, { n }).then((rows) =>
    rows.map((r) => ({ name: r.name, value: Number(r.value) })),
  );

export const rpcTopBreakdowns = (
  f: Filters,
  primaryDim: string,
  breakdownDim: string,
  opts: { scope?: string | null; topPrimary?: number; topBreakdown?: number } = {},
) =>
  rpcJson<BreakdownGroup[]>(
    "rpc_top_breakdowns",
    f,
    {
      primary_dim: primaryDim,
      breakdown_dim: breakdownDim,
      scope: opts.scope ?? null,
      top_primary: opts.topPrimary ?? 2,
      top_breakdown: opts.topBreakdown ?? 6,
    },
    [],
  );

export const rpcPainThemeSiblings = (f: Filters, topN = 2) =>
  rpcJson<BreakdownGroup[]>("rpc_pain_theme_siblings", f, { top_n: topN }, []);

export const rpcFaqModuleBreakdown = (f: Filters, topTopics = 2) =>
  rpcJson<BreakdownGroup[]>("rpc_faq_module_breakdown", f, { top_topics: topTopics }, []);

export const rpcFaqModuleHeat = (f: Filters, topModules = 10, topTopics = 6) =>
  rpcJson<HeatmapResult>("rpc_faq_module_heat", f, { top_modules: topModules, top_topics: topTopics }, {
    rowLabels: [],
    colLabels: [],
    values: [],
  });

export const rpcMonthlyTrend = (f: Filters, scope?: string | null) =>
  rpcJson<Array<Record<string, string | number>>>("rpc_monthly_trend", f, { scope: scope ?? null }, []);

// ─── won vs lost pains (Overview) ─────────────────────────────────────

export type WonLostPainRpc = {
  pain: string;
  won_demos: number;
  lost_demos: number;
  won_total: number;
  lost_total: number;
};

export const rpcWonLostPains = (f: Filters, n = 8) =>
  rpcRows<WonLostPainRpc>("rpc_won_lost_pains", f, { n }).then((rows) =>
    rows.map((r) => ({
      pain: r.pain,
      won_demos: Number(r.won_demos),
      lost_demos: Number(r.lost_demos),
      won_total: Number(r.won_total),
      lost_total: Number(r.lost_total),
    })),
  );

// ─── deals validados (first_meeting_status='Validated') ───────────────

export async function rpcValidatedDeals(filters: Filters): Promise<number> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("rpc_validated_deals", { f: filtersToJsonb(filters) });
    if (error) {
      console.warn("[rpc.validatedDeals] error:", error.message);
      return 0;
    }
    return Number(data ?? 0);
  } catch (exc) {
    console.warn("[rpc.validatedDeals] threw:", exc);
    return 0;
  }
}

// ─── Feature flag: usar RPC en lugar de buildXData JS ─────────────────

/** Si `USE_RPC_AGGREGATIONS=true`, las pages migradas usan las RPCs.
 *  Si está off (default), siguen con el flow JS antiguo (safe fallback). */
export function rpcEnabled(): boolean {
  return process.env.USE_RPC_AGGREGATIONS === "true";
}
