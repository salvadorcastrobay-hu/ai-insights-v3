"use client";

import { Cell, Legend, Pie, PieChart as RePieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartCsvLink } from "@/components/charts/ChartCsvLink";
import { CHART_PALETTE } from "@/components/charts/chart-theme";

type Props = {
  data: { name: string; value: number }[];
  height?: number;
  exportFileName?: string;
};

export function CategoryPieChart({ data, height = 340, exportFileName = "pie-chart.csv" }: Props) {
  return (
    <div className="relative">
      <ChartCsvLink rows={data} filename={exportFileName} />
      <ResponsiveContainer width="100%" height={height}>
        <RePieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={100} label>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </RePieChart>
      </ResponsiveContainer>
    </div>
  );
}

export { CategoryPieChart as PieChart };
