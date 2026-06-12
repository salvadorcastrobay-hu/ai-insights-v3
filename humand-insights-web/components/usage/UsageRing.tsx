"use client";

import { useMemo, useState } from "react";

import { useUsage, type UsageSummary, type UsageWindow } from "@/lib/use-usage";

type Props = {
  /** Si está presente, sólo renderiza para emails que matcheen estos valores
   *  (compara contra el prefijo del email — owner del backend). */
  visibleForOwners?: string[];
  /** ms entre auto-refresh. Default: 90s (los chat clients llaman refresh()
   *  manualmente después de cada send, así que el polling solo sirve para
   *  detectar uso desde otras pestañas). */
  autoRefreshMs?: number;
};

const SIZE = 36;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function colorForPct(pct: number): string {
  if (pct >= 90) return "#DC2626"; // red-600
  if (pct >= 70) return "#F59E0B"; // amber-500
  return "#10B981"; // emerald-500
}

export function UsageRing({ visibleForOwners, autoRefreshMs = 90000 }: Props) {
  const { data, loading, error } = useUsage(autoRefreshMs);
  const [open, setOpen] = useState(false);

  const isAllowed = useMemo(() => {
    if (!data) return false;
    if (!visibleForOwners || visibleForOwners.length === 0) return true;
    const owner = (data.owner || "").toLowerCase();
    return visibleForOwners.map((s) => s.toLowerCase()).includes(owner);
  }, [data, visibleForOwners]);

  if (loading || error || !data || !isAllowed) return null;

  const pct = Math.min(100, Math.max(0, data.daily.pct));
  const stroke = colorForPct(pct);
  const offset = CIRCUMFERENCE * (1 - pct / 100);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Uso diario: ${pct.toFixed(0)}%`}
        aria-label="Uso"
        className="flex shrink-0 items-center justify-center rounded-full p-0.5 hover:bg-[var(--color-neutral-100)]"
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#E5E7EB"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={stroke}
            strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: "stroke-dashoffset 300ms ease, stroke 300ms ease" }}
          />
          <text
            x="50%"
            y="50%"
            dominantBaseline="central"
            textAnchor="middle"
            fontSize="9"
            fill="var(--color-text-default)"
            fontWeight="600"
          >
            {pct.toFixed(0)}%
          </text>
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 bottom-[calc(100%+8px)] z-50 w-72 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white p-3 shadow-[var(--shadow-4dp)]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--color-text-default)]">
              Uso (USD)
            </span>
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              {data.enforcement_enabled ? "Cap activo" : "Sin enforcement"}
            </span>
          </div>
          <p className="mb-2 mt-1 text-[11px] text-[var(--color-text-secondary)]">
            {data.owner}
          </p>
          <UsageBar label="Hoy"          window={data.daily} />
          <UsageBar label="Esta semana"  window={data.weekly} />
          <UsageBar label="Este mes"     window={data.monthly} />
        </div>
      ) : null}
    </div>
  );
}

function fmtUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function UsageBar({ label, window: w }: { label: string; window: UsageWindow }) {
  const pct = Math.min(100, w.pct);
  const stroke = colorForPct(pct);
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--color-text-secondary)]">{label}</span>
        <span className="font-mono text-[var(--color-text-default)]">
          {fmtUsd(w.cost_usd)} / {fmtUsd(w.limit_usd)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[var(--color-neutral-100)]">
        <div
          className="h-1.5 rounded-full"
          style={{ width: `${pct}%`, background: stroke, transition: "width 300ms ease" }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-secondary)]">
        <span>{pct.toFixed(0)}%</span>
        <span>{w.used_tokens.toLocaleString()} tokens · {w.calls} calls</span>
      </div>
    </div>
  );
}

export type { UsageSummary };
