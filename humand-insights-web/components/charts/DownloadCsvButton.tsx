"use client";

import { Download } from "lucide-react";

import type { InsightRow } from "@/lib/supabase/types";

type Props = {
  /** Filename slug — derives from the chart title. */
  filename: string;
  /** Insights underlying this chart (after filtering by global filters + chart scope). */
  rows: InsightRow[];
  className?: string;
};

const COLUMNS: Array<{ header: string; field: keyof InsightRow }> = [
  { header: "transcript_id", field: "transcript_id" },
  { header: "call_date", field: "call_date" },
  { header: "company_name", field: "company_name" },
  { header: "segment", field: "segment" },
  { header: "industry", field: "industry" },
  { header: "region", field: "region" },
  { header: "country", field: "country" },
  { header: "deal_id", field: "deal_id" },
  { header: "deal_name", field: "deal_name" },
  { header: "deal_stage", field: "deal_stage" },
  { header: "deal_owner", field: "deal_owner" },
  { header: "amount", field: "amount" },
  { header: "acquisition_channel", field: "acquisition_channel" },
  { header: "insight_type", field: "insight_type" },
  { header: "insight_subtype", field: "insight_subtype_display" },
  { header: "module", field: "module_display" },
  { header: "feature", field: "feature_display" },
  { header: "gap_priority", field: "gap_priority" },
  { header: "competitor", field: "competitor_name" },
  { header: "competitor_relationship", field: "competitor_relationship_display" },
  { header: "summary", field: "summary" },
  { header: "verbatim_quote", field: "verbatim_quote" },
  { header: "confidence", field: "confidence" },
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows: InsightRow[]): string {
  const header = COLUMNS.map((c) => c.header).join(",");
  const lines = [header];
  for (const r of rows) {
    const row = COLUMNS.map((c) => csvEscape(r[c.field]));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Descarga las filas underlying del chart como CSV — 23 columnas con
 * verbatims, deal info, etc. La row count = cantidad real de insights
 * que entran al chart (no las agregadas).
 *
 * Si no hay rows o el componente no recibió rawRows, no renderiza.
 */
export function DownloadCsvButton({ filename, rows, className }: Props) {
  if (!rows || rows.length === 0) return null;

  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const csv = buildCsv(rows);
    // BOM so Excel detects UTF-8.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(filename) || "chart"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex items-center gap-1 rounded-full border border-[var(--color-neutral-200)] bg-white px-2 py-[3px] text-[11px] font-medium text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-500)] ${
        className ?? ""
      }`}
      aria-label={`Descargar CSV de ${filename} (${rows.length} insights)`}
      title={`Descargar CSV con verbatims — ${rows.length.toLocaleString()} filas`}
    >
      <Download className="h-3 w-3 transition-transform group-hover:-translate-y-[1px]" />
      <span>CSV</span>
      <span className="opacity-60">({rows.length.toLocaleString()})</span>
    </button>
  );
}
