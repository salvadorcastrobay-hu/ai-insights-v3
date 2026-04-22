import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { TrendLineChart } from "@/components/charts/LineChart";

const MOCK = [
  { name: "A", value: 10 },
  { name: "B", value: 7 },
  { name: "C", value: 5 },
  { name: "D", value: 3 },
];

export default function DevChartsPage() {
  return (
    <div className="space-y-4">
      <h1>Chart primitives preview</h1>
      <ChartCard title="Horizontal bar">
        <HorizontalBarChart data={MOCK} height={280} />
      </ChartCard>
      <ChartCard title="Heatmap">
        <HeatMap rowLabels={["R1", "R2", "R3"]} colLabels={["C1", "C2", "C3"]} values={[[2, 3, 1], [1, 7, 5], [0, 4, 2]]} />
      </ChartCard>
      <ChartCard title="Line">
        <TrendLineChart data={[{ month: "2026-01", count: 12 }, { month: "2026-02", count: 18 }, { month: "2026-03", count: 15 }]} seriesKeys={["count"]} />
      </ChartCard>
    </div>
  );
}
