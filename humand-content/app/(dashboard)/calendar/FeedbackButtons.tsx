"use client";

import { useState, useTransition } from "react";

import { FEEDBACK_LABELS, type FeedbackState } from "@/lib/content/types";

import { decideSuggestion } from "./actions";

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

  if (state !== "pending") {
    return (
      <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
        {FEEDBACK_LABELS[state]}
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
