"use client";

import { useCallback, useEffect, useState } from "react";

export type UsageWindow = {
  used_tokens: number;
  cost_usd: number;
  limit_usd: number;
  pct: number;
  calls: number;
};

export type UsageSummary = {
  owner: string;
  enforcement_enabled: boolean;
  daily: UsageWindow;
  weekly: UsageWindow;
  monthly: UsageWindow;
};

/**
 * Hook: token usage summary del user autenticado.
 * - refresh: re-fetcheás manualmente cuando hace falta (ej. después de un chat send)
 * - autoRefreshMs: polling opcional
 */
export function useUsage(autoRefreshMs?: number): {
  data: UsageSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/me", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as UsageSummary;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!autoRefreshMs) return;
    const t = setInterval(() => void refresh(), autoRefreshMs);
    return () => clearInterval(t);
  }, [autoRefreshMs, refresh]);

  return { data, loading, error, refresh };
}
