"use client";

import { useState } from "react";

/**
 * Copia el calendario como TSV.
 *
 * El CSV sirve para quien quiere el archivo; esto es para lo que realmente
 * pasa, que es pegarlo en Notion o en una planilla. El TSV se pega como tabla
 * sin pasar por ningún importador.
 */
export function CopyButton({ tsv }: { tsv: string }) {
  const [state, setState] = useState<"listo" | "copiado" | "error">("listo");

  async function copy() {
    try {
      await navigator.clipboard.writeText(tsv);
      setState("copiado");
      setTimeout(() => setState("listo"), 2000);
    } catch {
      // Sin permiso de portapapeles no hay nada que hacer desde acá; el CSV
      // sigue estando como salida alternativa.
      setState("error");
    }
  }

  const label =
    state === "copiado" ? "Copiado ✓" : state === "error" ? "No se pudo copiar" : "Copiar tabla";

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-[var(--r-m)] border border-[var(--border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--border-strong)]"
    >
      {label}
    </button>
  );
}
