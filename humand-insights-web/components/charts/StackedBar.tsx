"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCsvLink } from "@/components/charts/ChartCsvLink";
import { AXIS_THEME, CHART_PALETTE } from "@/components/charts/chart-theme";

type StackedBarProps = {
  data: Array<Record<string, string | number>>;
  yKey: string;
  stackKeys: string[];
  colorMap?: Record<string, string>;
  /** Optional fixed height. If omitted, scales with row count. */
  height?: number;
  yAxisWidth?: number;
  /** Add "%" or similar to tick labels */
  xTickSuffix?: string;
  exportFileName?: string;
};

export function StackedBarChart({
  data,
  yKey,
  stackKeys,
  colorMap,
  height,
  yAxisWidth = 220,
  xTickSuffix,
  exportFileName = "stacked-bar-chart.csv",
}: StackedBarProps) {
  const rowCount = Math.max(1, data.length);
  const computedHeight = height ?? Math.max(260, rowCount * 34 + 96);

  return (
    <div className="relative">
      <ChartCsvLink rows={data} filename={exportFileName} />
      <ResponsiveContainer width="100%" height={computedHeight}>
        <BarChart data={data} layout="vertical" margin={{ top: 24, bottom: 16, left: 8, right: 24 }}>
          <CartesianGrid stroke={AXIS_THEME.gridStroke} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            stroke={AXIS_THEME.axisStroke}
            tick={{ fontSize: AXIS_THEME.tickFontSize, fill: AXIS_THEME.tickColor }}
            tickFormatter={xTickSuffix ? (v) => `${v}${xTickSuffix}` : undefined}
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
            contentStyle={{
              fontFamily: AXIS_THEME.fontFamily,
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #eeeef1",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: AXIS_THEME.fontFamily }} />
          {stackKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="a"
              fill={colorMap?.[key] ?? CHART_PALETTE[i % CHART_PALETTE.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { StackedBarChart as StackedBar };
