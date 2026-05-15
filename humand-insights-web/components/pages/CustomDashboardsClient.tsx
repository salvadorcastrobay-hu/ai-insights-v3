"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Share2, Trash2, X } from "lucide-react";

import { CategoryPieChart } from "@/components/charts/PieChart";
import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { TrendLineChart } from "@/components/charts/LineChart";
import { InsightScatterChart } from "@/components/charts/ScatterChart";
import { PageTitle } from "@/components/pages/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELD_LABELS } from "@/lib/data/constants";
import { useFilteredRows } from "@/lib/data/use-filtered-rows";
import type { InsightRow } from "@/lib/supabase/types";

type ChartType = "bar" | "stacked-bar" | "line" | "area" | "pie" | "scatter" | "histogram";
type AggType = "count" | "sum" | "mean" | "median" | "distinct";
type Source = "filtered" | "all";

type ChartConfig = {
  id: string;
  title: string;
  type: ChartType;
  xField: keyof InsightRow;
  yAgg: AggType;
  /** Numeric field to aggregate on. Required for sum/mean/median. Optional for distinct (defaults to deal_id). */
  yField?: keyof InsightRow;
  /** Optional second dimension for stacked-bar / pie color split. */
  colorBy?: keyof InsightRow;
  source: Source;
  topN: number;
};

type DashboardConfig = { charts: ChartConfig[] };

type Dashboard = {
  id: string;
  name: string;
  owner: string;
  is_shared: boolean;
  config: DashboardConfig;
  updated_at?: string;
};

const CHART_TYPES: Array<{ value: ChartType; label: string }> = [
  { value: "bar", label: "Barras" },
  { value: "stacked-bar", label: "Barras apiladas" },
  { value: "line", label: "Línea" },
  { value: "area", label: "Área" },
  { value: "pie", label: "Torta" },
  { value: "scatter", label: "Dispersión" },
  { value: "histogram", label: "Histograma" },
];

const AGG_TYPES: Array<{ value: AggType; label: string }> = [
  { value: "count", label: "Conteo" },
  { value: "distinct", label: "Distinct deals" },
  { value: "sum", label: "Suma" },
  { value: "mean", label: "Promedio" },
  { value: "median", label: "Mediana" },
];

const NUMERIC_FIELDS: Array<keyof InsightRow> = ["amount", "confidence"];

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function aggregateOneDim(
  rows: InsightRow[],
  xField: keyof InsightRow,
  yAgg: AggType,
  yField: keyof InsightRow | undefined,
  topN: number,
): Array<{ name: string; value: number }> {
  const buckets = new Map<string, InsightRow[]>();
  for (const r of rows) {
    const key = String(r[xField] ?? "").trim();
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const out: Array<{ name: string; value: number }> = [];
  for (const [name, list] of buckets.entries()) {
    let value = 0;
    if (yAgg === "count") {
      value = list.length;
    } else if (yAgg === "distinct") {
      const targetField = yField ?? "deal_id";
      const s = new Set<string>();
      for (const r of list) {
        const v = r[targetField];
        if (v != null && String(v).trim()) s.add(String(v));
      }
      value = s.size;
    } else {
      const f = yField ?? "amount";
      const nums = list.map((r) => Number(r[f])).filter((n) => Number.isFinite(n));
      if (yAgg === "sum") value = nums.reduce((a, b) => a + b, 0);
      else if (yAgg === "mean") value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      else if (yAgg === "median") value = median(nums);
    }
    out.push({ name, value });
  }
  return out.sort((a, b) => b.value - a.value).slice(0, topN);
}

function aggregateTwoDim(
  rows: InsightRow[],
  xField: keyof InsightRow,
  colorBy: keyof InsightRow,
  yAgg: AggType,
  yField: keyof InsightRow | undefined,
  topN: number,
) {
  const stacks = new Map<string, Map<string, InsightRow[]>>();
  const colorTotals = new Map<string, number>();
  for (const r of rows) {
    const x = String(r[xField] ?? "").trim();
    const c = String(r[colorBy] ?? "").trim();
    if (!x || !c) continue;
    if (!stacks.has(x)) stacks.set(x, new Map());
    const inner = stacks.get(x)!;
    const list = inner.get(c) ?? [];
    list.push(r);
    inner.set(c, list);
    colorTotals.set(c, (colorTotals.get(c) ?? 0) + 1);
  }
  const colorOrder = [...colorTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  const xTotals: Array<[string, number]> = [];
  for (const [x, inner] of stacks.entries()) {
    let total = 0;
    for (const list of inner.values()) total += list.length;
    xTotals.push([x, total]);
  }
  const xOrder = xTotals.sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k]) => k);
  const data = xOrder.map((x) => {
    const row: Record<string, string | number> = { name: x };
    const inner = stacks.get(x)!;
    for (const c of colorOrder) {
      const list = inner.get(c) ?? [];
      let v = 0;
      if (yAgg === "count") v = list.length;
      else if (yAgg === "distinct") {
        const targetField = yField ?? "deal_id";
        const s = new Set<string>();
        for (const r of list) {
          const val = r[targetField];
          if (val != null && String(val).trim()) s.add(String(val));
        }
        v = s.size;
      } else {
        const f = yField ?? "amount";
        const nums = list.map((r) => Number(r[f])).filter((n) => Number.isFinite(n));
        if (yAgg === "sum") v = nums.reduce((a, b) => a + b, 0);
        else if (yAgg === "mean") v = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        else if (yAgg === "median") v = median(nums);
      }
      row[c] = v;
    }
    return row;
  });
  return { data, stackKeys: colorOrder };
}

function aggregateTimeSeries(
  rows: InsightRow[],
  yAgg: AggType,
  yField: keyof InsightRow | undefined,
  colorBy: keyof InsightRow | undefined,
) {
  const byMonth = new Map<string, Map<string, InsightRow[]>>();
  for (const r of rows) {
    if (!r.call_date) continue;
    const month = r.call_date.slice(0, 7);
    const series = colorBy ? String(r[colorBy] ?? "").trim() || "(sin)" : "value";
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const inner = byMonth.get(month)!;
    const list = inner.get(series) ?? [];
    list.push(r);
    inner.set(series, list);
  }
  const months = [...byMonth.keys()].sort();
  const seriesSet = new Set<string>();
  for (const inner of byMonth.values()) for (const k of inner.keys()) seriesSet.add(k);
  const seriesKeys = [...seriesSet].sort();
  const data = months.map((m) => {
    const row: Record<string, string | number> = { month: m };
    const inner = byMonth.get(m)!;
    for (const s of seriesKeys) {
      const list = inner.get(s) ?? [];
      let v = 0;
      if (yAgg === "count") v = list.length;
      else if (yAgg === "distinct") {
        const targetField = yField ?? "deal_id";
        const set = new Set<string>();
        for (const r of list) { const val = r[targetField]; if (val != null && String(val).trim()) set.add(String(val)); }
        v = set.size;
      } else {
        const f = yField ?? "amount";
        const nums = list.map((r) => Number(r[f])).filter((n) => Number.isFinite(n));
        if (yAgg === "sum") v = nums.reduce((a, b) => a + b, 0);
        else if (yAgg === "mean") v = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        else if (yAgg === "median") v = median(nums);
      }
      row[s] = v;
    }
    return row;
  });
  return { data, seriesKeys };
}

function histogramBuckets(rows: InsightRow[], field: keyof InsightRow, bucketCount = 20) {
  const nums = rows.map((r) => Number(r[field])).filter((n) => Number.isFinite(n));
  if (!nums.length) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = Math.max(1, max - min);
  const step = span / bucketCount;
  const buckets = Array(bucketCount).fill(0);
  for (const n of nums) {
    const idx = Math.min(bucketCount - 1, Math.floor((n - min) / step));
    buckets[idx] += 1;
  }
  return buckets.map((count, i) => ({
    name: `${(min + i * step).toFixed(0)}–${(min + (i + 1) * step).toFixed(0)}`,
    value: count,
  }));
}

function newChart(): ChartConfig {
  return {
    id: crypto.randomUUID(),
    title: "Nuevo gráfico",
    type: "bar",
    xField: "insight_type_display",
    yAgg: "count",
    source: "filtered",
    topN: 15,
  };
}

export function CustomDashboardsClient({ rows }: { rows: InsightRow[] }) {
  const { filteredRows } = useFilteredRows(rows);

  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("Mi Dashboard");
  const [isShared, setIsShared] = useState(false);
  const [charts, setCharts] = useState<ChartConfig[]>([newChart()]);
  const [editingChartId, setEditingChartId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/dashboards");
      if (!response.ok) return;
      const payload = await response.json();
      setDashboards(payload.dashboards ?? []);
    })();
  }, []);

  const loadDashboard = useCallback((d: Dashboard) => {
    setSelectedId(d.id);
    setName(d.name);
    setIsShared(d.is_shared);
    setCharts(d.config?.charts?.length ? d.config.charts : [newChart()]);
    setRenaming(false);
    setEditingChartId(null);
  }, []);

  const newDashboard = useCallback(() => {
    setSelectedId(null);
    setName("Mi Dashboard");
    setIsShared(false);
    setCharts([newChart()]);
    setEditingChartId(null);
    setRenaming(false);
  }, []);

  async function saveDashboard() {
    const config: DashboardConfig = { charts };
    const body = selectedId
      ? { id: selectedId, name, config, is_shared: isShared }
      : { name, config, is_shared: isShared };
    const response = await fetch("/api/dashboards", {
      method: selectedId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const payload = await response.json();
    const updated = payload.dashboard as Dashboard;
    setDashboards((cur) => {
      const exists = cur.some((d) => d.id === updated.id);
      return exists ? cur.map((d) => (d.id === updated.id ? updated : d)) : [updated, ...cur];
    });
    setSelectedId(updated.id);
    setRenaming(false);
  }

  async function deleteDashboard(id: string) {
    if (!confirm("¿Borrar este dashboard?")) return;
    const response = await fetch("/api/dashboards", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) return;
    setDashboards((cur) => cur.filter((d) => d.id !== id));
    if (selectedId === id) newDashboard();
  }

  function updateChart(id: string, patch: Partial<ChartConfig>) {
    setCharts((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function deleteChart(id: string) {
    setCharts((cur) => cur.filter((c) => c.id !== id));
  }
  function addChart() {
    setCharts((cur) => [...cur, newChart()]);
    setEditingChartId(charts[charts.length - 1]?.id ?? null);
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Custom Dashboards"
        subtitle="Combiná tus propios gráficos. Cada dashboard puede tener varios charts y se guarda en tu cuenta."
      />

      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        <ChartCard title="Mis Dashboards">
          <Button type="button" onClick={newDashboard} className="mb-3 flex w-full items-center justify-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Nuevo
          </Button>
          <div className="space-y-1.5">
            {dashboards.length === 0 ? (
              <p className="text-[12px] text-[var(--color-text-secondary)]">Aún no tenés dashboards.</p>
            ) : (
              dashboards.map((d) => (
                <div
                  key={d.id}
                  className={`group flex items-center gap-1 rounded-[var(--radius-s)] border p-2 transition-colors ${
                    selectedId === d.id
                      ? "border-[var(--color-brand-400)] bg-[var(--color-brand-50)]"
                      : "border-[var(--color-neutral-100)] hover:bg-[var(--color-neutral-100)]"
                  }`}
                >
                  <button type="button" className="flex-1 text-left text-[13px] font-medium" onClick={() => loadDashboard(d)}>
                    {d.name}
                    {d.is_shared ? <Share2 className="ml-1 inline h-3 w-3 text-[var(--color-brand-500)]" /> : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDashboard(d.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Borrar"
                    title="Borrar"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </button>
                </div>
              ))
            )}
          </div>
        </ChartCard>

        <div className="space-y-3">
          <ChartCard>
            <div className="flex flex-wrap items-center gap-2">
              {renaming ? (
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus onBlur={() => setRenaming(false)} className="max-w-xs" />
              ) : (
                <h2 className="flex items-center gap-2 text-[18px] font-semibold">
                  {name}
                  <button type="button" onClick={() => setRenaming(true)} aria-label="Renombrar" title="Renombrar">
                    <Pencil className="h-3.5 w-3.5 text-[var(--color-text-secondary)] hover:text-[var(--color-brand-500)]" />
                  </button>
                </h2>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
                Compartido con el equipo
              </label>
              <Button type="button" onClick={saveDashboard} className="flex items-center gap-1">
                <Save className="h-3.5 w-3.5" /> {selectedId ? "Guardar cambios" : "Guardar"}
              </Button>
            </div>
          </ChartCard>

          {charts.map((chart) => (
            <ChartCard key={chart.id}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <input
                  type="text"
                  value={chart.title}
                  onChange={(e) => updateChart(chart.id, { title: e.target.value })}
                  className="flex-1 border-b border-transparent bg-transparent text-[16px] font-semibold focus:border-[var(--color-brand-400)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setEditingChartId(editingChartId === chart.id ? null : chart.id)}
                  className="text-[11px] font-medium text-[var(--color-brand-500)] hover:underline"
                >
                  {editingChartId === chart.id ? "Cerrar editor" : "Editar"}
                </button>
                <button type="button" onClick={() => deleteChart(chart.id)} aria-label="Borrar gráfico" title="Borrar gráfico">
                  <X className="h-4 w-4 text-[var(--color-text-secondary)] hover:text-red-500" />
                </button>
              </div>

              {editingChartId === chart.id ? (
                <div className="mb-3 grid gap-2 rounded-[var(--radius-s)] border border-[var(--color-neutral-100)] bg-[var(--color-bg-page)] p-3 md:grid-cols-3 lg:grid-cols-6">
                  <FieldLabel label="Tipo">
                    <select
                      className="w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-1.5"
                      value={chart.type}
                      onChange={(e) => updateChart(chart.id, { type: e.target.value as ChartType })}
                    >
                      {CHART_TYPES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </FieldLabel>

                  <FieldLabel label="Eje X / categoría">
                    <select
                      className="w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-1.5"
                      value={String(chart.xField)}
                      onChange={(e) => updateChart(chart.id, { xField: e.target.value as keyof InsightRow })}
                    >
                      {Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </FieldLabel>

                  <FieldLabel label="Métrica">
                    <select
                      className="w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-1.5"
                      value={chart.yAgg}
                      onChange={(e) => updateChart(chart.id, { yAgg: e.target.value as AggType })}
                    >
                      {AGG_TYPES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </FieldLabel>

                  {(chart.yAgg === "sum" || chart.yAgg === "mean" || chart.yAgg === "median" || chart.type === "histogram") ? (
                    <FieldLabel label="Campo numérico">
                      <select
                        className="w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-1.5"
                        value={String(chart.yField ?? "amount")}
                        onChange={(e) => updateChart(chart.id, { yField: e.target.value as keyof InsightRow })}
                      >
                        {NUMERIC_FIELDS.map((f) => <option key={String(f)} value={String(f)}>{FIELD_LABELS[String(f)] ?? String(f)}</option>)}
                      </select>
                    </FieldLabel>
                  ) : null}

                  <FieldLabel label="Color (opcional)">
                    <select
                      className="w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-1.5"
                      value={chart.colorBy ? String(chart.colorBy) : ""}
                      onChange={(e) => updateChart(chart.id, { colorBy: e.target.value ? (e.target.value as keyof InsightRow) : undefined })}
                    >
                      <option value="">(ninguno)</option>
                      {Object.entries(FIELD_LABELS).filter(([k]) => k !== String(chart.xField)).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </FieldLabel>

                  <FieldLabel label="Top N">
                    <input
                      type="number"
                      min={3}
                      max={50}
                      className="w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-1.5"
                      value={chart.topN}
                      onChange={(e) => updateChart(chart.id, { topN: Math.max(3, Math.min(50, Number(e.target.value) || 15)) })}
                    />
                  </FieldLabel>

                  <FieldLabel label="Datos">
                    <select
                      className="w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-1.5"
                      value={chart.source}
                      onChange={(e) => updateChart(chart.id, { source: e.target.value as Source })}
                    >
                      <option value="filtered">Filtrados (filtros globales)</option>
                      <option value="all">Todo el dataset</option>
                    </select>
                  </FieldLabel>
                </div>
              ) : null}

              <RenderChart chart={chart} filtered={filteredRows} all={rows} />
            </ChartCard>
          ))}

          <Button type="button" onClick={addChart} className="flex w-full items-center justify-center gap-1 bg-white !text-[var(--color-text-default)] border border-[var(--color-neutral-200)] hover:!bg-[var(--color-neutral-100)]">
            <Plus className="h-3.5 w-3.5" /> Agregar gráfico al dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function RenderChart({ chart, filtered, all }: { chart: ChartConfig; filtered: InsightRow[]; all: InsightRow[] }) {
  const source = chart.source === "filtered" ? filtered : all;

  const memoized = useMemo(() => {
    if (chart.type === "histogram") {
      const field = chart.yField ?? "amount";
      return { mode: "single" as const, data: histogramBuckets(source, field) };
    }
    if (chart.type === "line" || chart.type === "area") {
      return { mode: "time" as const, ...aggregateTimeSeries(source, chart.yAgg, chart.yField, chart.colorBy) };
    }
    if (chart.colorBy && (chart.type === "stacked-bar" || chart.type === "bar")) {
      return { mode: "stack" as const, ...aggregateTwoDim(source, chart.xField, chart.colorBy, chart.yAgg, chart.yField, chart.topN) };
    }
    return { mode: "single" as const, data: aggregateOneDim(source, chart.xField, chart.yAgg, chart.yField, chart.topN) };
  }, [chart, source]);

  if (chart.type === "pie") {
    if (memoized.mode !== "single") return null;
    return <CategoryPieChart data={memoized.data} height={360} />;
  }
  if (chart.type === "scatter") {
    if (memoized.mode !== "single") return null;
    return (
      <InsightScatterChart
        data={memoized.data.map((row, i) => ({ x: i + 1, y: row.value, name: row.name }))}
        xKey="x"
        yKey="y"
      />
    );
  }
  if (chart.type === "line" || chart.type === "area") {
    if (memoized.mode !== "time") return null;
    return <TrendLineChart data={memoized.data} seriesKeys={memoized.seriesKeys} />;
  }
  if (chart.type === "histogram") {
    if (memoized.mode !== "single") return null;
    const data = memoized.data as Array<{ name: string; value: number }>;
    return <HorizontalBarChart data={data} height={Math.max(280, data.length * 24)} />;
  }
  if (memoized.mode === "stack") {
    return <StackedBarChart data={memoized.data} yKey="name" stackKeys={memoized.stackKeys} height={Math.max(320, memoized.data.length * 36)} />;
  }
  const data = memoized.data as Array<{ name: string; value: number }>;
  return <HorizontalBarChart data={data} height={Math.max(320, data.length * 32)} />;
}
