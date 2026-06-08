"use client";

import { ChevronDown, ChevronRight, Download, Eraser, Loader2, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";

import { MultiSelectCombobox } from "@/components/layout/MultiSelectCombobox";
import { useGlobalFilters } from "@/lib/data/filter-state";
import {
  EMPTY_FILTERS,
  computeFilterOptions,
  type FilterOptions,
  type Filters,
} from "@/lib/data/filters";
import type { InsightRow } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type FilterMultiKey = Exclude<keyof Filters, "date_start" | "date_end" | "min_confidence" | "validated" | "clients">;

type FilterFieldConfig = {
  key: FilterMultiKey;
  label: string;
  options: string[];
};

const ARRAY_FILTER_KEYS: FilterMultiKey[] = [
  "types",
  "regions",
  "segments",
  "countries",
  "industries",
  "owners",
  "modules",
  "categories",
  "channels",
  "sources",
];

const FILTER_LABELS: Record<FilterMultiKey, string> = {
  types: "Tipo",
  regions: "Region",
  segments: "Segmento",
  countries: "Pais",
  industries: "Industria",
  owners: "AE",
  modules: "Modulo",
  categories: "Categoria HR",
  channels: "Canal",
  sources: "Fuente",
};

function buildCsvExportHref(filters: Filters): string {
  const params = new URLSearchParams();

  for (const key of ARRAY_FILTER_KEYS) {
    if (filters[key].length) {
      params.set(key, filters[key].join(","));
    }
  }

  if (filters.date_start) {
    params.set("date_start", filters.date_start);
  }
  if (filters.date_end) {
    params.set("date_end", filters.date_end);
  }

  const query = params.toString();
  return query ? `/api/export/csv?${query}` : "/api/export/csv";
}

function DateInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  min?: string | null;
  max?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
        {label}
      </span>
      <input
        type="date"
        value={value ?? ""}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(event) => onChange(event.currentTarget.value || null)}
        className={cn(
          "h-9 rounded-[var(--radius-s)] border bg-white px-3 text-sm shadow-sm outline-none",
          "border-[var(--color-neutral-200)] text-[var(--color-text-default)] focus:border-[var(--color-brand-400)]",
          value && "border-[var(--color-brand-400)] bg-[var(--color-brand-50)]",
        )}
      />
    </div>
  );
}

function ActiveChips({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (next: Partial<Filters>) => void;
}) {
  const chips: { label: string; onRemove: () => void }[] = [];

  for (const key of ARRAY_FILTER_KEYS) {
    const values = filters[key];
    for (const v of values) {
      chips.push({
        label: `${FILTER_LABELS[key]}: ${v}`,
        onRemove: () =>
          setFilters({
            [key]: values.filter((x) => x !== v),
          } as Partial<Filters>),
      });
    }
  }
  if (filters.date_start) {
    chips.push({
      label: `Desde: ${filters.date_start}`,
      onRemove: () => setFilters({ date_start: null }),
    });
  }
  if (filters.date_end) {
    chips.push({
      label: `Hasta: ${filters.date_end}`,
      onRemove: () => setFilters({ date_end: null }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-brand-400)] bg-[var(--color-brand-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-brand-500)]"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="rounded-full p-0.5 hover:bg-[var(--color-brand-100)]"
            aria-label="Quitar"
          >
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function FilterControls({
  filters,
  setFilters,
  options,
}: {
  filters: Filters;
  setFilters: (next: Partial<Filters>) => void;
  options: FilterOptions;
  compact?: boolean;
}) {
  const fields: FilterFieldConfig[] = ARRAY_FILTER_KEYS.map((key) => ({
    key,
    label: FILTER_LABELS[key],
    options: options[key] ?? [],
  }));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {fields.map((field) =>
        field.options.length ? (
          <MultiSelectCombobox
            key={field.key}
            label={field.label}
            options={field.options}
            value={filters[field.key] as string[]}
            onChange={(next) => setFilters({ [field.key]: next })}
          />
        ) : null,
      )}
      <DateInput
        label="Desde"
        value={filters.date_start}
        min={options.date_min}
        max={options.date_max}
        onChange={(next) => setFilters({ date_start: next })}
      />
      <DateInput
        label="Hasta"
        value={filters.date_end}
        min={options.date_min}
        max={options.date_max}
        onChange={(next) => setFilters({ date_end: next })}
      />
      <ConfidenceToggle
        value={filters.min_confidence}
        onChange={(next) => setFilters({ min_confidence: next })}
      />
      <BoolToggle
        active={!!filters.clients}
        label="Solo clientes"
        title="Solo deals que se convirtieron en cliente (Closed Won)."
        onChange={(on) => setFilters({ clients: on ? true : null })}
      />
    </div>
  );
}

/** Toggle booleano genérico para filtros tipo checkbox. */
function BoolToggle({
  active,
  label,
  title,
  onChange,
}: {
  active: boolean;
  label: string;
  title: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[var(--radius-s)] border px-2 py-2 text-[12px] transition",
        active
          ? "border-emerald-400 bg-emerald-50 text-emerald-700"
          : "border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-neutral-300)]",
      )}
      title={title}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={active}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="font-medium">{label}</span>
    </label>
  );
}

/**
 * Toggle "Solo alta confianza (≥0.7)". Al activarse setea min_confidence=0.7,
 * al desactivarse vuelve a null (sin filtro).
 */
function ConfidenceToggle({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const active = value != null && value > 0;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[var(--radius-s)] border px-2 py-2 text-[12px] transition",
        active
          ? "border-[var(--color-brand-400)] bg-[var(--color-brand-50)] text-[var(--color-brand-500)]"
          : "border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-neutral-300)]",
      )}
      title="Excluí insights con confidence < 0.7. Filas sin confidence se mantienen."
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={active}
        onChange={(e) => onChange(e.target.checked ? 0.7 : null)}
      />
      <span className="font-medium">Solo alta confianza (≥0.7)</span>
    </label>
  );
}

function countActive(filters: Filters): number {
  let n = 0;
  for (const key of ARRAY_FILTER_KEYS) n += filters[key].length;
  if (filters.date_start) n++;
  if (filters.date_end) n++;
  if (filters.min_confidence != null && filters.min_confidence > 0) n++;
  return n;
}

export function GlobalFilterBar({
  rows,
  options,
  className,
}: {
  rows?: InsightRow[];
  options?: FilterOptions;
  className?: string;
}) {
  const [filters, setFilters, isPending] = useGlobalFilters();
  const computedOptions = useMemo(() => options ?? computeFilterOptions(rows ?? []), [options, rows]);
  const mergedFilters = { ...EMPTY_FILTERS, ...filters } satisfies Filters;
  const csvExportHref = useMemo(() => buildCsvExportHref(mergedFilters), [mergedFilters]);
  const active = countActive(mergedFilters);
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      aria-busy={isPending}
      className={cn(
        "rounded-[var(--radius-m)] border bg-[var(--color-bg-card)] transition-colors",
        isPending ? "border-[var(--color-brand-400)]" : "border-[var(--color-neutral-200)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="group flex shrink-0 items-center gap-2 text-[12px] font-semibold text-[var(--color-text-default)] transition hover:text-[var(--color-brand-500)]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-s)] bg-[var(--color-brand-50)] text-[var(--color-brand-500)] transition group-hover:bg-[var(--color-brand-100)]">
            <SlidersHorizontal size={13} strokeWidth={2.5} />
          </span>
          <span>Filtros</span>
          {active > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-brand-500)] px-1.5 text-[10px] font-bold text-white">
              {active}
            </span>
          ) : null}
          <span className="text-[var(--color-text-secondary)] transition-transform">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        </button>

        {isPending ? (
          <span
            role="status"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-brand-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-brand-500)]"
          >
            <Loader2 size={12} className="animate-spin" />
            Actualizando…
          </span>
        ) : null}

        {active > 0 && !expanded ? (
          <div className="min-w-0 flex-1">
            <ActiveChips filters={mergedFilters} setFilters={setFilters} />
          </div>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {active > 0 ? (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              title="Limpiar todos los filtros"
              aria-label="Limpiar filtros"
              className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-s)] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]"
            >
              <Eraser size={12} />
            </button>
          ) : null}
          <a
            href={csvExportHref}
            title="Descargar CSV con filtros actuales"
            aria-label="Descargar CSV"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-s)] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]"
          >
            <Download size={12} />
          </a>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-[var(--color-neutral-100)] p-3">
          <FilterControls
            filters={mergedFilters}
            setFilters={setFilters}
            options={computedOptions}
          />
          {active > 0 ? (
            <div className="mt-2.5 border-t border-[var(--color-neutral-100)] pt-2.5">
              <ActiveChips filters={mergedFilters} setFilters={setFilters} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
