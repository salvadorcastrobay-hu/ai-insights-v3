"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCsvLink } from "@/components/charts/ChartCsvLink";
import { AXIS_THEME, CHART_PALETTE } from "@/components/charts/chart-theme";

type Props = {
  data: Array<Record<string, string | number>>;
  seriesKeys: string[];
  xKey?: string;
  height?: number;
  exportFileName?: string;
};

export function TrendLineChart({
  data,
  seriesKeys,
  xKey = "month",
  height = 420,
  exportFileName = "line-chart.csv",
}: Props) {
  return (
    <div className="relative">
      <ChartCsvLink rows={data} filename={exportFileName} />
      <ResponsiveContainer width="100%" height={height}>
        <ReLineChart data={data} margin={{ top: 48, bottom: 24, left: 8, right: 8 }}>
          <CartesianGrid stroke={AXIS_THEME.gridStroke} strokeDasharray="3 3" />
          <XAxis
            dataKey={xKey}
            angle={-45}
            textAnchor="end"
            height={60}
            stroke={AXIS_THEME.axisStroke}
            tick={{ fontSize: AXIS_THEME.tickFontSize, fill: AXIS_THEME.tickColor }}
          />
          <YAxis
            stroke={AXIS_THEME.axisStroke}
            tick={{ fontSize: AXIS_THEME.tickFontSize, fill: AXIS_THEME.tickColor }}
          />
          <Tooltip />
          <Legend />
          {seriesKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  );
}

export { TrendLineChart as LineChart };
