"use client";

import { useState, useTransition } from "react";

import { FEEDBACK_LABELS, type FeedbackState } from "@/lib/content/types";

import { decideSuggestion, publishSuggestion } from "./actions";

export function FeedbackButtons({
  entryKey,
  current,
}: {
  entryKey: string;
  current: FeedbackState;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FeedbackState>(current);
  const [error, setError] = useState<string | null>(null);
  const [askingNote, setAskingNote] = useState(false);
  const [note, setNote] = useState("");
  const [askingUrl, setAskingUrl] = useState(false);
  const [url, setUrl] = useState("");

  const decide = (next: FeedbackState, editNote?: string) =>
    start(async () => {
      const result = await decideSuggestion(entryKey, next, editNote);
      if (result.ok) {
        setState(next);
        setAskingNote(false);
        setError(null);
      } else {
        setError(result.message);
      }
    });

  // Una pieza aprobada todavía no está publicada. Sin este paso la cadena del
  // brief se corta acá y nunca se puede comparar lo publicado contra el
  // baseline propio, que es la cuarta métrica.
  const aprobada = state === "approved_as_is" || state === "approved_edited";

  if (askingUrl) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link de la pieza publicada"
          className="min-w-[220px] rounded-[var(--r-s)] border border-[var(--border)] px-2 py-1 text-[12px]"
        />
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await publishSuggestion(entryKey, url);
              if (result.ok) {
                setState("published");
                setAskingUrl(false);
                setError(null);
              } else {
                setError(result.message);
              }
            })
          }
          className="rounded-[var(--r-s)] bg-[var(--brand-solid)] px-2 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          Guardar
        </button>
        <button
          disabled={pending}
          onClick={() => setAskingUrl(false)}
          className="text-[12px] underline disabled:opacity-50"
        >
          cancelar
        </button>
        {error ? <span className="text-[12px] text-[var(--error)]">{error}</span> : null}
      </span>
    );
  }

  if (state !== "pending") {
    return (
      <span className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
        {FEEDBACK_LABELS[state]}
        {aprobada ? (
          <button
            disabled={pending}
            onClick={() => setAskingUrl(true)}
            className="font-semibold text-[var(--brand-ink)] underline disabled:opacity-50"
          >
            marcar publicada
          </button>
        ) : null}
        <button
          disabled={pending}
          onClick={() => decide("pending")}
          className="underline disabled:opacity-50"
        >
          deshacer
        </button>
      </span>
    );
  }

  if (askingNote) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="¿Qué cambiaste?"
          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
        />
        <button
          disabled={pending}
          onClick={() => decide("approved_edited", note)}
          className="rounded-md border border-[#d4defa] bg-[var(--brand-soft)] px-2 py-1 text-xs text-[#2f4fa3] disabled:opacity-50"
        >
          Guardar
        </button>
        <button
          onClick={() => setAskingNote(false)}
          className="text-xs text-[var(--muted)] underline"
        >
          cancelar
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        disabled={pending}
        onClick={() => decide("approved_as_is")}
        className="rounded-md border border-[#d4defa] bg-[var(--brand-soft)] px-2 py-1 text-xs text-[#2f4fa3] disabled:opacity-50"
      >
        Aprobar tal cual
      </button>
      <button
        disabled={pending}
        onClick={() => setAskingNote(true)}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
      >
        Aprobar con cambios
      </button>
      <button
        disabled={pending}
        onClick={() => decide("rejected")}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-50"
      >
        Descartar
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
