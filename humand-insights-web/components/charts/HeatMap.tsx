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

/**
 * Strip redundant parentheticals from labels for axis legibility. E.g.
 *   "SMB (<250 employees)"            → "SMB"
 *   "Mid Market (250-1000 employees)" → "Mid Market"
 *
 * Heuristic: only strip when the parenthetical contains "employee" or is the
 * trailing chunk of a 2-part label. Keeps things like "Performance Review (PR)"
 * intact because we don't blindly drop every `(...)`.
 */
function compactLabel(label: string): string {
  return label.replace(/\s*\(\s*[^)]*employees?[^)]*\)\s*$/i, "").trim() || label;
}

/** Truncate con ellipsis para que labels largos no se solapen en el eje. */
function truncate(label: string, max: number): string {
  if (label.length <= max) return label;
  return label.slice(0, max - 1).trimEnd() + "…";
}

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
  // Floor row height at 40px so few-row heatmaps don't collapse into tiny cells.
  const MIN_CELL_HEIGHT = 40;
  const computedHeight = height ?? Math.max(360, rows * 44 + 130);
  // Adaptive left padding: enough to fit the longest row label, no more.
  // Avoids huge whitespace when labels are short (e.g. "processes", "talent").
  const longestRow = rowLabels.reduce((m, l) => Math.max(m, l.length), 0);
  const leftPadding = Math.min(260, Math.max(120, longestRow * 7 + 24));
  const rightPadding = 24;
  const bottomPadding = 24;

  const matrixMax = useMemo(
    () => values.reduce((acc, row) => Math.max(acc, ...row), 0),
    [values],
  );

  const viewWidth = 1000;
  const innerWidth = viewWidth - leftPadding - rightPadding;
  // Cap cell width so few-column heatmaps don't get stretched into giant
  // sparse panels, but be generous when there are only a few columns —
  // otherwise we leave a lot of empty space on either side.
  const maxCellWidth = cols <= 3 ? 220 : cols <= 5 ? 180 : 150;
  const rawCellWidth = cols > 0 ? innerWidth / cols : 0;
  const cellWidth = Math.min(rawCellWidth, maxCellWidth);
  const matrixWidth = cellWidth * cols;
  const xOffset = leftPadding + (innerWidth - matrixWidth) / 2;

  // Column label legibility: en vez de rotar (frágil — se recorta arriba con
  // celdas anchas y se solapa con celdas angostas), las dejamos SIEMPRE
  // horizontales y las truncamos para que cada label entre en el ancho de su
  // propia celda. El nombre completo va en <title> (hover). Nunca se solapa
  // (cada label está acotado a su celda) ni se recorta (una sola línea).
  const CHAR_PX = 6.6; // ancho aprox de char a fontSize 12, fontWeight 600
  const colLabelMaxChars = Math.max(3, Math.floor((cellWidth - 8) / CHAR_PX));
  // Una línea horizontal sobre la matriz — padding chico y fijo.
  const topPadding = 56;

  const rawInnerHeight = computedHeight - topPadding - bottomPadding;
  const rawCellHeight = rows > 0 ? rawInnerHeight / rows : 0;
  const cellHeight = Math.max(rawCellHeight, MIN_CELL_HEIGHT);
  const innerHeight = cellHeight * rows;
  // If we expanded cellHeight beyond what the parent height accommodated,
  // grow the svg viewBox so the rows aren't clipped.
  const finalHeight = innerHeight + topPadding + bottomPadding;

  return (
    <div className="w-full overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${viewWidth} ${finalHeight}`}>
        {colLabels.map((label, c) => {
          const x = xOffset + c * cellWidth + cellWidth / 2;
          const compact = compactLabel(label);
          const display = truncate(compact, colLabelMaxChars);
          const truncated = display !== compact;
          return (
            <text
              key={`col-${label}-${c}`}
              x={x}
              y={topPadding - 14}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill="#303036"
            >
              {truncated ? <title>{label}</title> : null}
              {display}
            </text>
          );
        })}

        {rowLabels.map((label, r) => {
          const y = topPadding + r * cellHeight + cellHeight / 2;
          return (
            <text
              key={`row-${label}-${r}`}
              x={xOffset - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="#636271"
            >
              {compactLabel(label)}
            </text>
          );
        })}

        {values.map((row, r) =>
          row.map((v, c) => {
            const x = xOffset + c * cellWidth;
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
