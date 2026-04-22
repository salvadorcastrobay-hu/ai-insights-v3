"use client";

import { useEffect, useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { TrendLineChart } from "@/components/charts/LineChart";
import { InsightScatterChart } from "@/components/charts/ScatterChart";
import { PageTitle } from "@/components/pages/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELD_LABELS } from "@/lib/data/constants";
import { useFilteredRows } from "@/lib/data/use-filtered-rows";
import type { InsightRow } from "@/lib/supabase/types";

type ChartType = "bar" | "line" | "area" | "pie" | "scatter" | "histogram";

type DashboardConfig = {
  charts: Array<{ type: ChartType; xField: keyof InsightRow; yAgg: "count" | "sum" | "mean" | "median" | "distinct" }>;
};

type Dashboard = {
  id: string;
  name: string;
  owner: string;
  is_shared: boolean;
  config: DashboardConfig;
};

function aggregate(rows: InsightRow[], field: keyof InsightRow) {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[field] ?? "").trim();
    if (!key) continue;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return [...grouped.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 25);
}

export function CustomDashboardsClient({ rows }: { rows: InsightRow[] }) {
  const { filteredRows } = useFilteredRows(rows);

  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);
  const [name, setName] = useState("My Dashboard");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [xField, setXField] = useState<keyof InsightRow>("insight_type_display");
  const [yAgg, setYAgg] = useState<"count" | "sum" | "mean" | "median" | "distinct">("count");

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/dashboards");
      if (!response.ok) return;
      const payload = await response.json();
      setDashboards(payload.dashboards ?? []);
    })();
  }, []);

  const previewData = useMemo(() => aggregate(filteredRows, xField), [filteredRows, xField]);

  async function saveDashboard() {
    const config: DashboardConfig = {
      charts: [{ type: chartType, xField, yAgg }],
    };

    const body = selectedDashboardId
      ? { id: selectedDashboardId, name, config }
      : { name, config, is_shared: false };

    const response = await fetch("/api/dashboards", {
      method: selectedDashboardId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) return;
    const payload = await response.json();
    const updated = payload.dashboard as Dashboard;

    setDashboards((current) => {
      const exists = current.some((item) => item.id === updated.id);
      if (exists) return current.map((item) => (item.id === updated.id ? updated : item));
      return [updated, ...current];
    });
    setSelectedDashboardId(updated.id);
  }

  async function deleteDashboard(id: string) {
    const response = await fetch("/api/dashboards", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) return;
    setDashboards((current) => current.filter((item) => item.id !== id));
    if (selectedDashboardId === id) setSelectedDashboardId(null);
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Custom Dashboards" subtitle="Builder para gráficos personalizados con persistencia en Supabase." />

      <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
        <ChartCard title="Mi Dashboard">
          <div className="space-y-2">
            {dashboards.map((dashboard) => (
              <div key={dashboard.id} className="rounded-[var(--radius-s)] border border-[var(--color-neutral-100)] p-2">
                <button type="button" className="w-full text-left text-[14px] font-medium" onClick={() => {
                  setSelectedDashboardId(dashboard.id);
                  setName(dashboard.name);
                }}>
                  {dashboard.name}
                </button>
                <Button type="button" className="mt-2 w-full bg-red-500 hover:bg-red-600" onClick={() => deleteDashboard(dashboard.id)}>
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </ChartCard>

        <div className="space-y-3">
          <ChartCard title="Crear Gráfico">
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dashboard name" />

              <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
                {(["bar", "line", "area", "pie", "scatter", "histogram"] as ChartType[]).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>

              <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={xField} onChange={(e) => setXField(e.target.value as keyof InsightRow)}>
                {Object.entries(FIELD_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>

              <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={yAgg} onChange={(e) => setYAgg(e.target.value as "count" | "sum" | "mean" | "median" | "distinct")}>
                {["count", "sum", "mean", "median", "distinct"].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>

              <Button type="button" onClick={saveDashboard}>Guardar</Button>
            </div>
          </ChartCard>

          <ChartCard title="Preview">
            {chartType === "line" ? (
              <TrendLineChart data={previewData.map((row) => ({ month: row.name, value: row.value }))} seriesKeys={["value"]} />
            ) : chartType === "scatter" ? (
              <InsightScatterChart
                data={previewData.map((row, idx) => ({ x: idx + 1, y: row.value, name: row.name }))}
                xKey="x"
                yKey="y"
              />
            ) : (
              <HorizontalBarChart data={previewData} height={520} />
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
