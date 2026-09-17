"use client";

import { useState, useTransition } from "react";

import { approveSource, triggerAnalysis, triggerDiscovery, type ActionResult } from "./actions";

function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => setResult(await fn()));
  return { pending, result, run };
}

export function ApprovalButtons({ id }: { id: string }) {
  const { pending, result, run } = useAction();

  if (result?.ok) {
    return <span className="text-xs text-[var(--muted)]">{result.message}</span>;
  }

  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() => run(() => approveSource(id, "approved"))}
        className="rounded-md border border-[#d4defa] bg-[var(--brand-soft)] px-2 py-1 text-xs text-[#2f4fa3] disabled:opacity-50"
      >
        Aprobar
      </button>
      <button
        disabled={pending}
        onClick={() => run(() => approveSource(id, "rejected"))}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-50"
      >
        Descartar
      </button>
      {result && !result.ok ? (
        <span className="text-xs text-red-600">{result.message}</span>
      ) : null}
    </span>
  );
}

export function RunButtons() {
  const { pending, result, run } = useAction();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        disabled={pending}
        onClick={() => run(() => triggerDiscovery())}
        className="rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Lanzando…" : "Actualizar fuentes"}
      </button>
      <button
        disabled={pending}
        onClick={() => run(() => triggerAnalysis("linkedin"))}
        className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
      >
        Analizar posts nuevos
      </button>
      {result ? (
        <span className={`text-xs ${result.ok ? "text-[var(--muted)]" : "text-red-600"}`}>
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
