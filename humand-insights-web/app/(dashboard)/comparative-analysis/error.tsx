"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[comparative-analysis] runtime error:", error);
  }, [error]);

  return (
    <div className="m-4 rounded-[var(--radius-m)] border border-red-300 bg-red-50 p-4 text-[13px] text-red-900">
      <div className="mb-2 font-semibold">Comparative Analysis — runtime error</div>
      <div className="mb-2">
        <span className="font-medium">message:</span> {error.message}
      </div>
      {error.digest ? (
        <div className="mb-2">
          <span className="font-medium">digest:</span> {error.digest}
        </div>
      ) : null}
      {error.stack ? (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] leading-tight">
          {error.stack}
        </pre>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded border border-red-300 bg-white px-3 py-1 text-[12px] font-medium text-red-800 hover:bg-red-100"
      >
        Reintentar
      </button>
    </div>
  );
}
