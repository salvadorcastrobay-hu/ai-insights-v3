"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart as ReScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCsvLink } from "@/components/charts/ChartCsvLink";
import { AXIS_THEME } from "@/components/charts/chart-theme";

type Props = {
  data: Array<Record<string, string | number | null>>;
  xKey: string;
  yKey: string;
  zKey?: string;
  height?: number;
  color?: string;
  exportFileName?: string;
};

export function InsightScatterChart({
  data,
  xKey,
  yKey,
  zKey,
  height = 320,
  color = "#6f93eb",
  exportFileName = "scatter-chart.csv",
}: Props) {
  return (
    <div className="relative">
      <ChartCsvLink
        rows={data as Array<Record<string, string | number | boolean | null | undefined>>}
        filename={exportFileName}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ReScatterChart margin={{ top: 40, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid stroke={AXIS_THEME.gridStroke} />
          <XAxis type="number" dataKey={xKey} stroke={AXIS_THEME.axisStroke} />
          <YAxis type="number" dataKey={yKey} stroke={AXIS_THEME.axisStroke} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data} fill={color} {...(zKey ? { line: false } : {})} />
        </ReScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export { InsightScatterChart as ScatterChart };
