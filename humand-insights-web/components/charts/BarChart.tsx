"use client";

import {
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCsvLink } from "@/components/charts/ChartCsvLink";
import { AXIS_THEME, CHART_PALETTE } from "@/components/charts/chart-theme";

type Row = { name: string; value: number; [k: string]: string | number | boolean | null | undefined };

type Props = {
  data: Row[];
  xKey?: string;
  yKey?: string;
  color?: string;
  multicolor?: boolean;
  /** Fixed height. If omitted, scales with row count: max(240, rows * 32) + 72 padding. */
  height?: number;
  label?: (value: number) => string;
  reverseY?: boolean;
  xMaxMultiplier?: number;
  /** Y-axis label width. Defaults to 220px. Use 260+ for very long labels. */
  yAxisWidth?: number;
  exportFileName?: string;
  /** If set, makes bars clickable and invokes this callback with the full row. */
  onBarClick?: (row: Row) => void;
};

export function HorizontalBarChart({
  data,
  xKey = "value",
  yKey = "name",
  color = "#6f93eb",
  multicolor = false,
  height,
  label,
  reverseY = true,
  xMaxMultiplier = 1.18,
  yAxisWidth = 220,
  exportFileName = "bar-chart.csv",
  onBarClick,
}: Props) {
  const sorted = reverseY ? [...data].reverse() : data;
  const xMax = Math.max(1, ...data.map((d) => Number(d[xKey] ?? 0))) * xMaxMultiplier;

  const rowCount = Math.max(1, data.length);
  const computedHeight = height ?? Math.max(240, rowCount * 32 + 80);

  return (
    <div className="relative">
      <ChartCsvLink rows={sorted} filename={exportFileName} />
      <ResponsiveContainer width="100%" height={computedHeight}>
        <ReBarChart data={sorted} layout="vertical" margin={{ top: 24, bottom: 16, left: 8, right: 48 }}>
          <CartesianGrid stroke={AXIS_THEME.gridStroke} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, xMax]}
            stroke={AXIS_THEME.axisStroke}
            tick={{ fontSize: AXIS_THEME.tickFontSize, fill: AXIS_THEME.tickColor }}
          />
          <YAxis
            type="category"
            dataKey={yKey}
            width={yAxisWidth}
            stroke={AXIS_THEME.axisStroke}
            tick={{ fontSize: AXIS_THEME.tickFontSize, fill: AXIS_THEME.tickColor }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "rgba(111, 147, 235, 0.08)" }}
            contentStyle={{
              fontFamily: AXIS_THEME.fontFamily,
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #eeeef1",
            }}
          />
          <Bar
            dataKey={xKey}
            radius={[0, 4, 4, 0]}
            cursor={onBarClick ? "pointer" : undefined}
            onClick={onBarClick ? (payload: unknown) => {
              const row = (payload as { payload?: Row })?.payload;
              if (row) onBarClick(row);
            } : undefined}
          >
            <LabelList
              dataKey={xKey}
              position="right"
              formatter={(value: number) => (label ? label(Number(value)) : String(value))}
              style={{ fontSize: 11, fill: AXIS_THEME.tickColor, fontFamily: AXIS_THEME.fontFamily }}
            />
            {sorted.map((_, i) => (
              <Cell key={i} fill={multicolor ? CHART_PALETTE[i % CHART_PALETTE.length] : color} />
            ))}
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { HorizontalBarChart as BarChart };
