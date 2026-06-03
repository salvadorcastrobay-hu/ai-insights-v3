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
  });
}

// ─── Helper: convertir Filters TS a JSONB compatible con _filter_insights ─

function filtersToJsonb(filters: Filters): Record<string, unknown> {
  return {
    prompt_version: process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0",
    types: filters.types ?? [],
    regions: filters.regions ?? [],
    segments: filters.segments ?? [],
    countries: filters.countries ?? [],
    industries: filters.industries ?? [],
    owners: filters.owners ?? [],
    modules: filters.modules ?? [],
    categories: filters.categories ?? [],
    channels: filters.channels ?? [],
    sources: filters.sources ?? [],
    date_start: filters.date_start ?? null,
    date_end: filters.date_end ?? null,
    min_confidence: filters.min_confidence ?? null,
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

// ─── Feature flag: usar RPC en lugar de buildXData JS ─────────────────

/** Si `USE_RPC_AGGREGATIONS=true`, las pages migradas usan las RPCs.
 *  Si está off (default), siguen con el flow JS antiguo (safe fallback). */
export function rpcEnabled(): boolean {
  return process.env.USE_RPC_AGGREGATIONS === "true";
}
