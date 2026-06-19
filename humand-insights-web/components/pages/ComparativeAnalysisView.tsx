"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/components/charts/ChartCard";
import { ChartCsvLink } from "@/components/charts/ChartCsvLink";
import { AXIS_THEME, CHART_PALETTE } from "@/components/charts/chart-theme";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import {
  applyDateWindow,
  buildComparison,
  cleanLabel,
  COMPARISON_OPTIONS,
  DISPLAY_OPTIONS,
  FACET_OPTIONS,
  formatMetricValue,
  METRIC_OPTIONS,
  metricTotal,
  windowPresets,
  type ComparativePayload,
  type CompareByKey,
  type DisplayMode,
  type MetricKey,
  type MetricLabel,
  type SlimRow,
} from "@/lib/data/comparative-analysis-data";

type Props = { data: ComparativePayload };

const TIME_PRESETS = [
  "Últimos 30 días vs 30 anteriores",
  "Últimos 90 días vs 90 anteriores",
  "Custom",
] as const;
type TimePreset = (typeof TIME_PRESETS)[number];

function useFacetOptions(rows: SlimRow[]) {
  return useMemo(() => {
    const available: Array<[string, keyof SlimRow]> = [];
    for (const [label, col] of Object.entries(FACET_OPTIONS) as Array<[string, keyof SlimRow]>) {
      const hasAny = rows.some((r) => cleanLabel(r[col]) !== null);
      if (hasAny) available.push([label, col]);
    }
    return available;
  }, [rows]);
}

function selectStyle() {
  return "h-9 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-white px-2 text-[13px] shadow-sm outline-none focus:border-[var(--color-brand-400)]";
}

export function ComparativeAnalysisView({ data }: Props) {
  const t = useTranslations("comparativeAnalysis");
  const rows = data.rows;

  const facetOptions = useFacetOptions(rows);
  const [comparisonKey, setComparisonKey] = useState<CompareByKey>("periods");
  const [facetLabel, setFacetLabel] = useState<string>(
    facetOptions[1]?.[0] ?? facetOptions[0]?.[0] ?? "Tipo de insight",
  );
  const [metricLabel, setMetricLabel] = useState<MetricLabel>("Menciones");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("Volumen absoluto");
  const [topN, setTopN] = useState<number>(10);
  const [normalizeByShare, setNormalizeByShare] = useState<boolean>(false);

  // time-mode state
  const [timePreset, setTimePreset] = useState<TimePreset>("Últimos 90 días vs 90 anteriores");
  const [customStartA, setCustomStartA] = useState(data.dateMin ?? "");
  const [customEndA, setCustomEndA] = useState(data.dateMax ?? "");
  const [customStartB, setCustomStartB] = useState(data.dateMin ?? "");
  const [customEndB, setCustomEndB] = useState(data.dateMax ?? "");

  // category-mode state
  const [valueA, setValueA] = useState<string>("");
  const [valueB, setValueB] = useState<string>("");

  const comparisonMeta = COMPARISON_OPTIONS.find((o) => o.key === comparisonKey)!;
  const facetCol = FACET_OPTIONS[facetLabel] ?? "insight_type_display";
  const metricKey = METRIC_OPTIONS[metricLabel] as MetricKey;

  // Filter out own-brand competitors when comparing on competitor_name facet
  const scopedRows = useMemo(() => {
    if (facetCol === "competitor_name") {
      return rows.filter((r) => !r.is_own_brand_competitor);
    }
    return rows;
  }, [rows, facetCol]);

  // Split rows into A and B
  const { dfA, dfB, labelA, labelB, errorMessage } = useMemo(() => {
    if (comparisonMeta.mode === "time") {
      if (!data.dateMax || !data.dateMin) {
        return {
          dfA: [] as SlimRow[],
          dfB: [] as SlimRow[],
          labelA: "Lado A",
          labelB: "Lado B",
          errorMessage: "No hay fechas válidas para comparar períodos.",
        };
      }
      let sA: string, eA: string, sB: string, eB: string;
      if (timePreset === "Últimos 30 días vs 30 anteriores") {
        ({ startA: sA, endA: eA, startB: sB, endB: eB } = windowPresets(data.dateMax, 30));
      } else if (timePreset === "Últimos 90 días vs 90 anteriores") {
        ({ startA: sA, endA: eA, startB: sB, endB: eB } = windowPresets(data.dateMax, 90));
      } else {
        sA = customStartA || data.dateMin;
        eA = customEndA || data.dateMax;
        sB = customStartB || data.dateMin;
        eB = customEndB || data.dateMax;
        if (sA > eA || sB > eB) {
          return {
            dfA: [] as SlimRow[],
            dfB: [] as SlimRow[],
            labelA: "Lado A",
            labelB: "Lado B",
            errorMessage: "Cada lado necesita un rango válido (inicial ≤ final).",
          };
        }
      }
      return {
        dfA: applyDateWindow(scopedRows, sA, eA),
        dfB: applyDateWindow(scopedRows, sB, eB),
        labelA: `${sA} → ${eA}`,
        labelB: `${sB} → ${eB}`,
        errorMessage: "",
      };
    }

    // category mode
    const column = comparisonMeta.column as keyof SlimRow;
    if (!valueA || !valueB) {
      return {
        dfA: [] as SlimRow[],
        dfB: [] as SlimRow[],
        labelA: valueA || "Lado A",
        labelB: valueB || "Lado B",
        errorMessage: "",
      };
    }
    return {
      dfA: scopedRows.filter((r) => cleanLabel(r[column]) === valueA),
      dfB: scopedRows.filter((r) => cleanLabel(r[column]) === valueB),
      labelA: valueA,
      labelB: valueB,
      errorMessage: "",
    };
  }, [comparisonMeta, timePreset, customStartA, customEndA, customStartB, customEndB, valueA, valueB, scopedRows, data.dateMin, data.dateMax]);

  const categoryValues = useMemo(() => {
    if (comparisonMeta.mode !== "category") return [] as string[];
    const column = comparisonMeta.column as keyof SlimRow;
    const set = new Set<string>();
    for (const r of scopedRows) {
      const v = cleanLabel(r[column]);
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [comparisonMeta, scopedRows]);

  const comparison = useMemo(() => {
    if (dfA.length === 0 && dfB.length === 0) return [];
    return buildComparison(dfA, dfB, facetCol, metricKey);
  }, [dfA, dfB, facetCol, metricKey]);

  // Compute totals and sample sizes
  const totals = useMemo(() => {
    const totalA = metricTotal(dfA, metricKey);
    const totalB = metricTotal(dfB, metricKey);
    const callsA = new Set(dfA.map((r) => r.transcript_id).filter(Boolean)).size;
    const callsB = new Set(dfB.map((r) => r.transcript_id).filter(Boolean)).size;
    const dealsA = new Set(dfA.map((r) => r.deal_id).filter(Boolean)).size;
    const dealsB = new Set(dfB.map((r) => r.deal_id).filter(Boolean)).size;
    const deltaAbs = totalA - totalB;
    const deltaPct = totalB === 0 ? null : ((totalA - totalB) / totalB) * 100;
    return { totalA, totalB, callsA, callsB, dealsA, dealsB, deltaAbs, deltaPct };
  }, [dfA, dfB, metricKey]);

  // Decide sort and top-N slice
  const showShare = displayMode === "Participación porcentual" || (displayMode === "Volumen absoluto" && normalizeByShare);
  const chartRows = useMemo(() => {
    if (comparison.length === 0) return [];
    const enriched = comparison.map((row) => {
      let sortMetric: number;
      if (displayMode === "Delta absoluto") sortMetric = Math.abs(row.deltaAbs);
      else if (displayMode === "Delta porcentual") sortMetric = Math.abs(row.deltaPct ?? 0);
      else if (showShare) sortMetric = Math.max(row.shareA, row.shareB);
      else sortMetric = Math.max(row.a, row.b);
      return { ...row, sortMetric };
    });
    enriched.sort((x, y) => y.sortMetric - x.sortMetric);
    return enriched.slice(0, topN);
  }, [comparison, displayMode, showShare, topN]);

  // Leaders
  const leaders = useMemo(() => {
    const byA = [...comparison].sort((x, y) => y.a - x.a).slice(0, 3).map((r) => r.arista);
    const byB = [...comparison].sort((x, y) => y.b - x.b).slice(0, 3).map((r) => r.arista);
    const byUplift = [...comparison].sort((x, y) => y.deltaAbs - x.deltaAbs).slice(0, 3).map((r) => r.arista);
    return { byA, byB, byUplift };
  }, [comparison]);

  const smallSampleWarning = Math.min(totals.callsA, totals.callsB) < 5 && (dfA.length > 0 || dfB.length > 0);

  // Chart data depending on mode
  type ChartDatum = {
    arista: string;
    [key: string]: string | number;
  };
  const chartData: ChartDatum[] = useMemo(() => {
    if (showShare) {
      return chartRows.map((r) => ({ arista: r.arista, [labelA]: r.shareA, [labelB]: r.shareB }));
    }
    if (displayMode === "Delta absoluto") {
      return chartRows
        .slice()
        .sort((x, y) => x.deltaAbs - y.deltaAbs)
        .map((r) => ({ arista: r.arista, "Delta": r.deltaAbs }));
    }
    if (displayMode === "Delta porcentual") {
      return chartRows
        .slice()
        .sort((x, y) => (x.deltaPct ?? 0) - (y.deltaPct ?? 0))
        .map((r) => ({ arista: r.arista, "Delta %": r.deltaPct ?? 0 }));
    }
    return chartRows.map((r) => ({ arista: r.arista, [labelA]: r.a, [labelB]: r.b }));
  }, [chartRows, showShare, displayMode, labelA, labelB]);

  const chartKeys = useMemo(() => {
    if (showShare || displayMode === "Volumen absoluto") return [labelA, labelB];
    if (displayMode === "Delta absoluto") return ["Delta"];
    return ["Delta %"];
  }, [showShare, displayMode, labelA, labelB]);

  const chartHeight = Math.max(420, Math.min(900, 80 + chartRows.length * 38));

  return (
    <div className="space-y-5">
      <PageTitle
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <SectionHeader title="Configurar comparación" />
      <ChartCard title="Configuración">
        <div className="grid gap-2 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
            Comparar por
            <select
              className={selectStyle()}
              value={comparisonKey}
              onChange={(e) => {
                setComparisonKey(e.target.value as CompareByKey);
                setValueA("");
                setValueB("");
              }}
            >
              {COMPARISON_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
            Arista
            <select className={selectStyle()} value={facetLabel} onChange={(e) => setFacetLabel(e.target.value)}>
              {facetOptions.map(([label]) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
            Métrica
            <select
              className={selectStyle()}
              value={metricLabel}
              onChange={(e) => setMetricLabel(e.target.value as MetricLabel)}
            >
              {Object.keys(METRIC_OPTIONS).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
            Lectura
            <select
              className={selectStyle()}
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}
            >
              {DISPLAY_OPTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1.4fr_1fr]">
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
            Top aristas: <span className="text-[var(--color-text-default)]">{topN}</span>
            <input
              type="range"
              min={5}
              max={25}
              step={1}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="h-2 w-full cursor-pointer"
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-default)]">
            <input
              type="checkbox"
              checked={normalizeByShare}
              onChange={(e) => setNormalizeByShare(e.target.checked)}
              className="h-4 w-4"
            />
            <span>
              Normalizar por share
              <span className="ml-1 text-[var(--color-text-secondary)]">
                (lectura relativa dentro de cada lado)
              </span>
            </span>
          </label>
        </div>
      </ChartCard>

      {/* A/B selection */}
      {comparisonMeta.mode === "time" ? (
        <ChartCard title="Ventana temporal">
          <div className="grid gap-2 md:grid-cols-[1.4fr_auto]">
            <select
              className={selectStyle()}
              value={timePreset}
              onChange={(e) => setTimePreset(e.target.value as TimePreset)}
            >
              {TIME_PRESETS.map((p) => (<option key={p} value={p}>{p}</option>))}
            </select>
          </div>
          {timePreset === "Custom" ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-3">
                <div className="mb-2 text-[12px] font-semibold">Lado A</div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className={selectStyle()} value={customStartA} min={data.dateMin ?? undefined} max={data.dateMax ?? undefined} onChange={(e) => setCustomStartA(e.target.value)} />
                  <input type="date" className={selectStyle()} value={customEndA} min={data.dateMin ?? undefined} max={data.dateMax ?? undefined} onChange={(e) => setCustomEndA(e.target.value)} />
                </div>
              </div>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-3">
                <div className="mb-2 text-[12px] font-semibold">Lado B</div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className={selectStyle()} value={customStartB} min={data.dateMin ?? undefined} max={data.dateMax ?? undefined} onChange={(e) => setCustomStartB(e.target.value)} />
                  <input type="date" className={selectStyle()} value={customEndB} min={data.dateMin ?? undefined} max={data.dateMax ?? undefined} onChange={(e) => setCustomEndB(e.target.value)} />
                </div>
              </div>
            </div>
          ) : null}
        </ChartCard>
      ) : (
        <ChartCard title={`Comparar valores de ${comparisonMeta.label.toLowerCase()}`}>
          {categoryValues.length < 2 ? (
            <div className="text-[13px] text-[var(--color-text-secondary)]">
              No hay suficientes valores para armar una comparación A/B.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
                Lado A
                <select className={selectStyle()} value={valueA} onChange={(e) => setValueA(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {categoryValues.map((v) => (<option key={v} value={v} disabled={v === valueB}>{v}</option>))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
                Lado B
                <select className={selectStyle()} value={valueB} onChange={(e) => setValueB(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {categoryValues.map((v) => (<option key={v} value={v} disabled={v === valueA}>{v}</option>))}
                </select>
              </label>
            </div>
          )}
        </ChartCard>
      )}

      {errorMessage ? (
        <div className="rounded-[var(--radius-s)] border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
          {errorMessage}
        </div>
      ) : null}

      {dfA.length === 0 && dfB.length === 0 && !errorMessage ? (
        <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-white p-4 text-[13px] text-[var(--color-text-secondary)]">
          {comparisonMeta.mode === "category"
            ? "Elegí un valor en Lado A y otro en Lado B para comparar."
            : "Sin datos para la ventana elegida."}
        </div>
      ) : null}

      {dfA.length > 0 || dfB.length > 0 ? (
        <>
          {smallSampleWarning ? (
            <div className="rounded-[var(--radius-s)] border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
              Uno de los lados tiene menos de 5 calls únicas. Leé la comparación como señal exploratoria.
            </div>
          ) : null}

          <SectionHeader title="Resumen A/B" />
          <section className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label={labelA}
              value={formatMetricValue(totals.totalA, metricKey)}
              caption={`${totals.callsA.toLocaleString("en-US")} calls · ${totals.dealsA.toLocaleString("en-US")} deals`}
            />
            <MetricCard
              label={labelB}
              value={formatMetricValue(totals.totalB, metricKey)}
              caption={`${totals.callsB.toLocaleString("en-US")} calls · ${totals.dealsB.toLocaleString("en-US")} deals`}
            />
            <MetricCard
              label="Delta"
              value={formatMetricValue(totals.deltaAbs, metricKey)}
              caption={totals.deltaPct === null ? "n/a" : `${totals.deltaPct.toFixed(1)}%`}
            />
          </section>

          {chartRows.length > 0 ? (
            <>
              <SectionHeader
                title={
                  showShare
                    ? `${facetLabel} por participación relativa`
                    : displayMode === "Delta absoluto"
                    ? `Delta absoluto por ${facetLabel}`
                    : displayMode === "Delta porcentual"
                    ? `Delta porcentual por ${facetLabel}`
                    : `${facetLabel} en A vs B`
                }
              />
              <ChartCard title="Comparativa">
                <div className="relative">
                  <ChartCsvLink rows={chartData} filename="comparative-analysis.csv" />
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <ReBarChart data={chartData} layout="vertical" margin={{ top: 24, bottom: 16, left: 8, right: 48 }}>
                      <CartesianGrid stroke={AXIS_THEME.gridStroke} strokeDasharray="3 3" horizontal={false} />
                      <XAxis
                        type="number"
                        stroke={AXIS_THEME.axisStroke}
                        tick={{ fontSize: AXIS_THEME.tickFontSize, fill: AXIS_THEME.tickColor }}
                        tickFormatter={(v: number) => {
                          if (showShare || displayMode === "Delta porcentual") return `${Math.round(v)}%`;
                          if (metricKey === "revenue") return formatMetricValue(v, "revenue");
                          return Math.round(v).toLocaleString("en-US");
                        }}
                      />
                      <YAxis
                        type="category"
                        dataKey="arista"
                        width={220}
                        interval={0}
                        stroke={AXIS_THEME.axisStroke}
                        tick={{ fontSize: AXIS_THEME.tickFontSize, fill: AXIS_THEME.tickColor }}
                      />
                      <Tooltip
                        contentStyle={{ fontFamily: AXIS_THEME.fontFamily, fontSize: 12, borderRadius: 8, border: "1px solid #eeeef1" }}
                        formatter={(value: number) => {
                          if (showShare || displayMode === "Delta porcentual") return `${value.toFixed(1)}%`;
                          return formatMetricValue(value, metricKey);
                        }}
                      />
                      {chartKeys.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
                      {chartKeys.map((key, i) => (
                        <Bar key={key} dataKey={key} radius={[0, 4, 4, 0]} fill={CHART_PALETTE[i]}>
                          {chartKeys.length === 1 ? (
                            <>
                              {chartData.map((row, idx) => {
                                const v = Number(row[key]);
                                const color = v >= 0 ? CHART_PALETTE[1] : "#ea718b";
                                return <Cell key={idx} fill={color} />;
                              })}
                              <LabelList
                                dataKey={key}
                                position="right"
                                formatter={(value: number) => {
                                  if (displayMode === "Delta porcentual") return `${value.toFixed(1)}%`;
                                  return formatMetricValue(value, metricKey);
                                }}
                                style={{ fontSize: 11, fill: AXIS_THEME.tickColor, fontFamily: AXIS_THEME.fontFamily }}
                              />
                            </>
                          ) : null}
                        </Bar>
                      ))}
                    </ReBarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <SectionHeader title="Detalle de comparación" />
              <ChartCard title="Tabla">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>{facetLabel}</Th>
                      <Th>{labelA}</Th>
                      <Th>{labelB}</Th>
                      <Th>Share A</Th>
                      <Th>Share B</Th>
                      <Th>Delta abs</Th>
                      <Th>Delta %</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {chartRows.map((row) => (
                      <Tr key={row.arista}>
                        <Td>{row.arista}</Td>
                        <Td>{formatMetricValue(row.a, metricKey)}</Td>
                        <Td>{formatMetricValue(row.b, metricKey)}</Td>
                        <Td>{formatMetricValue(row.shareA, metricKey, true)}</Td>
                        <Td>{formatMetricValue(row.shareB, metricKey, true)}</Td>
                        <Td>{formatMetricValue(row.deltaAbs, metricKey)}</Td>
                        <Td>{formatMetricValue(row.deltaPct, metricKey, true)}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </ChartCard>

              <SectionHeader title="Lecturas rápidas" />
              <section className="grid gap-3 md:grid-cols-3">
                <ChartCard title={`Top en ${labelA}`}>
                  <ul className="list-disc pl-5 text-[13px]">
                    {leaders.byA.map((x) => (<li key={x}>{x}</li>))}
                    {leaders.byA.length === 0 ? <li className="list-none text-[var(--color-text-secondary)]">Sin datos</li> : null}
                  </ul>
                </ChartCard>
                <ChartCard title={`Top en ${labelB}`}>
                  <ul className="list-disc pl-5 text-[13px]">
                    {leaders.byB.map((x) => (<li key={x}>{x}</li>))}
                    {leaders.byB.length === 0 ? <li className="list-none text-[var(--color-text-secondary)]">Sin datos</li> : null}
                  </ul>
                </ChartCard>
                <ChartCard title="Mayor uplift en A">
                  <ul className="list-disc pl-5 text-[13px]">
                    {leaders.byUplift.map((x) => (<li key={x}>{x}</li>))}
                    {leaders.byUplift.length === 0 ? <li className="list-none text-[var(--color-text-secondary)]">Sin datos</li> : null}
                  </ul>
                </ChartCard>
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
