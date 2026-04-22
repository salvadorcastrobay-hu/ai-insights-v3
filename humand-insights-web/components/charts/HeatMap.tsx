"use client";

import { useMemo } from "react";

import { HEATMAP_STOPS, heatmapTextColor } from "@/components/charts/chart-theme";

type Props = {
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
  height?: number;
  showAnnotations?: boolean;
  valueFormat?: (v: number) => string;
};

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((v) => v + v).join("")
    : clean;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function lerpHex(a: string, b: string, t: number): string {
  const c1 = hexToRgb(a);
  const c2 = hexToRgb(b);
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const bChannel = Math.round(c1.b + (c2.b - c1.b) * t);
  return `rgb(${r}, ${g}, ${bChannel})`;
}

function interpolateColor(t: number): string {
  const bounded = Math.max(0, Math.min(1, t));
  for (let i = 0; i < HEATMAP_STOPS.length - 1; i += 1) {
    const a = HEATMAP_STOPS[i];
    const b = HEATMAP_STOPS[i + 1];
    if (bounded >= a.t && bounded <= b.t) {
      const ratio = (bounded - a.t) / (b.t - a.t);
      return lerpHex(a.color, b.color, ratio);
    }
  }
  return HEATMAP_STOPS[HEATMAP_STOPS.length - 1].color;
}

export function HeatMap({
  rowLabels,
  colLabels,
  values,
  height,
  showAnnotations = true,
  valueFormat = (v) => String(Math.round(v)),
}: Props) {
  const rows = rowLabels.length;
  const cols = colLabels.length;
  const computedHeight = height ?? Math.max(360, rows * 36 + 120);
  const topPadding = 110;
  const leftPadding = 220;
  const rightPadding = 24;
  const bottomPadding = 24;

  const matrixMax = useMemo(
    () => values.reduce((acc, row) => Math.max(acc, ...row), 0),
    [values],
  );

  const innerHeight = computedHeight - topPadding - bottomPadding;
  const cellHeight = rows > 0 ? innerHeight / rows : 0;
  const viewWidth = 1000;
  const innerWidth = viewWidth - leftPadding - rightPadding;
  const cellWidth = cols > 0 ? innerWidth / cols : 0;

  return (
    <div className="w-full overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${viewWidth} ${computedHeight}`}>
        {colLabels.map((label, c) => {
          const x = leftPadding + c * cellWidth + cellWidth / 2;
          return (
            <text
              key={`col-${label}-${c}`}
              x={x}
              y={70}
              textAnchor="start"
              transform={`rotate(-30 ${x} 70)`}
              fontSize={11}
              fill="#636271"
            >
              {label}
            </text>
          );
        })}

        {rowLabels.map((label, r) => {
          const y = topPadding + r * cellHeight + cellHeight / 2;
          return (
            <text
              key={`row-${label}-${r}`}
              x={leftPadding - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="#636271"
            >
              {label}
            </text>
          );
        })}

        {values.map((row, r) =>
          row.map((v, c) => {
            const x = leftPadding + c * cellWidth;
            const y = topPadding + r * cellHeight;
            const ratio = matrixMax > 0 ? v / matrixMax : 0;
            const fill = interpolateColor(ratio);

            return (
              <g key={`cell-${r}-${c}`}>
                <rect
                  x={x}
                  y={y}
                  width={Math.max(0, cellWidth - 1)}
                  height={Math.max(0, cellHeight - 1)}
                  fill={fill}
                  rx={2}
                  ry={2}
                />
                {showAnnotations && v > 0 ? (
                  <text
                    x={x + cellWidth / 2}
                    y={y + cellHeight / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={13}
                    fill={heatmapTextColor(v, matrixMax)}
                  >
                    {valueFormat(v)}
                  </text>
                ) : null}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
