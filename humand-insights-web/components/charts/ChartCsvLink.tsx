"use client";

import { useEffect, useMemo } from "react";

type CsvRow = Record<string, string | number | boolean | null | undefined>;

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const normalized = String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function toCsv(rows: CsvRow[]): string {
  if (!rows.length) return "";

  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const header = keys.map(csvEscape).join(",");
  const lines = rows.map((row) => keys.map((key) => csvEscape(row[key])).join(","));
  return [header, ...lines].join("\n");
}

export function ChartCsvLink({
  rows,
  filename,
}: {
  rows: CsvRow[];
  filename: string;
}) {
  const csv = useMemo(() => toCsv(rows), [rows]);
  const href = useMemo(() => {
    if (!csv) return "";
    return URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  }, [csv]);

  useEffect(() => {
    return () => {
      if (href) URL.revokeObjectURL(href);
    };
  }, [href]);

  if (!csv || !href) return null;

  return (
    <a
      href={href}
      download={filename}
      className="absolute right-1 top-1 text-[10px] font-medium text-[var(--color-text-secondary)] opacity-70 underline-offset-2 hover:underline hover:opacity-100"
      title="Descargar CSV"
    >
      CSV
    </a>
  );
}

