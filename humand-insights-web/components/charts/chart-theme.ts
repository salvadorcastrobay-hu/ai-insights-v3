export const CHART_PALETTE = [
  "#6f93eb", "#496be3", "#9785ff", "#4bb69f",
  "#f4c83f", "#ed774a", "#6fd1e7", "#81de38",
  "#ea718b", "#d574c9",
] as const;

export const HEATMAP_STOPS = [
  { t: 0, color: "#f1f4fd" },
  { t: 0.5, color: "#6f93eb" },
  { t: 1, color: "#213478" },
] as const;

export function heatmapTextColor(value: number, maxValue: number): string {
  if (maxValue === 0) return "#111111";
  const ratio = value / maxValue;
  return ratio >= 0.4 ? "#ffffff" : "#111111";
}

export const AXIS_THEME = {
  gridStroke: "#eeeef1",
  axisStroke: "#dfe0e6",
  tickFontSize: 11,
  tickColor: "#636271",
  labelFontSize: 12,
  labelColor: "#303036",
  fontFamily: "Roboto, sans-serif",
};

export const COMPETITOR_REL_COLORS: Record<string, string> = {
  "Usa actualmente": "#E53935",
  Evaluando: "#FB8C00",
  "Migrando desde": "#FDD835",
  "Uso anterior": "#43A047",
  Mencionado: "#1E88E5",
  Descartado: "#424242",
};
