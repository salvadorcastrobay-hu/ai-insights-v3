"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useTranslations } from "next-intl";

import { useFilterTransition } from "@/components/layout/FilterTransition";
import { TABLE_MAX, TABLE_PAGE } from "@/lib/data/table-page";

const STRING_PARSER = parseAsString.withDefault("");
const LIMIT_PARSER = parseAsInteger.withDefault(TABLE_PAGE);

/**
 * Filtros + paginación de una tabla de detalle, sincronizados a la URL. El
 * server lee esos params, filtra y corta las filas (ver lib/data/table-page).
 *
 * `prefix` separa los params de cada tabla (ej. "pt" → pt_theme, pt_q,
 * pt_limit). `filterKeys` son los selects; la búsqueda libre es `<prefix>_q`
 * con debounce, y cualquier cambio de filtro vuelve a la primera página.
 */
export function usePagedTableParams<K extends string>(prefix: string, filterKeys: readonly K[]) {
  const parsers = useMemo(() => {
    const out: Record<string, typeof STRING_PARSER | typeof LIMIT_PARSER> = {};
    for (const key of filterKeys) out[`${prefix}_${key}`] = STRING_PARSER;
    out[`${prefix}_q`] = STRING_PARSER;
    out[`${prefix}_limit`] = LIMIT_PARSER;
    return out;
    // filterKeys es estático por tabla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);

  const shared = useFilterTransition();
  const [, localStart] = useTransition();
  const [loadingMore, startLoadMore] = useTransition();
  const [state, setState] = useQueryStates(parsers, {
    shallow: false,
    startTransition: shared?.startTransition ?? localStart,
    clearOnDefault: true,
    scroll: false,
  });

  const qKey = `${prefix}_q`;
  const limitKey = `${prefix}_limit`;
  const urlSearch = String(state[qKey] ?? "");

  // La búsqueda pega al server: debounce para no recomputar en cada tecla.
  const [search, setSearch] = useState(urlSearch);
  useEffect(() => {
    if (search === urlSearch) return;
    const id = setTimeout(() => void setState({ [qKey]: search, [limitKey]: null }), 400);
    return () => clearTimeout(id);
  }, [search, urlSearch, qKey, limitKey, setState]);

  const filters = {} as Record<K, string>;
  for (const key of filterKeys) filters[key] = String(state[`${prefix}_${key}`] ?? "");

  return {
    filters,
    setFilter: (key: K, value: string) => void setState({ [`${prefix}_${key}`]: value, [limitKey]: null }),
    search,
    setSearch,
    loadingMore,
    // "Cargar más" usa su propia transition: no atenúa la página entera
    // (el overlay compartido), solo el botón.
    loadMore: (shown: number) =>
      void setState({ [limitKey]: Math.min(shown + TABLE_PAGE, TABLE_MAX) }, { startTransition: startLoadMore }),
  };
}

type FooterProps = {
  shown: number;
  total: number;
  loadingMore: boolean;
  onLoadMore: () => void;
};

/** Botón "Cargar más" (va dentro del contenedor scrolleable). */
export function LoadMoreButton({ shown, total, loadingMore, onLoadMore }: FooterProps) {
  const t = useTranslations("tablePaging");
  if (total <= shown || shown >= TABLE_MAX) return null;
  return (
    <div className="flex justify-center py-3">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loadingMore}
        className="rounded-full border border-[var(--color-neutral-200)] bg-white px-4 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-500)] disabled:opacity-60"
      >
        {loadingMore ? t("loadingMore") : t("loadMore", { n: Math.min(TABLE_PAGE, total - shown) })}
      </button>
    </div>
  );
}

/** "Mostrando X de N" debajo de la tabla, solo si está cortada. */
export function TableTruncatedNote({ shown, total }: Pick<FooterProps, "shown" | "total">) {
  const t = useTranslations("tablePaging");
  if (total <= shown) return null;
  return (
    <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">
      {t(shown < TABLE_MAX ? "truncated" : "maxed", {
        shown: shown.toLocaleString(),
        total: total.toLocaleString(),
      })}
    </p>
  );
}
