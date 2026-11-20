"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { PostMedia } from "@/components/PostMedia";
import type { ContentPost } from "@/lib/content/types";

/**
 * El chat, con la forma de cualquier chat: mensajes en cascada de más viejo a
 * más nuevo, la caja para escribir fija abajo y, vacío, sugerencias al centro.
 *
 * Cada respuesta trae los posts que cita; van como tarjetas chicas dentro de
 * la respuesta, para chequear de dónde sale lo que dice sin salir del chat.
 * La conversación se guarda en el navegador (sessionStorage) para que un
 * refresh no la borre; si el navegador no deja, sigue andando sin guardar.
 */

type Cited = { ref: string; post: ContentPost };
type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; cited: Cited[]; error?: boolean };

const STORAGE_KEY = "radar-chat-v1";

function load(): Turn[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

function save(turns: Turn[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
  } catch {
    /* sin storage: la conversación vive mientras la pestaña esté abierta */
  }
}

// ─── Texto de la respuesta ───────────────────────────────────────────────────

/** Negritas y citas [pN]. El modelo tiene pedido no usar más que eso. */
function inline(text: string, onCite: (ref: string) => void): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[p\d+\])/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    const cite = /^\[(p\d+)\]$/.exec(part);
    if (cite) {
      return (
        <button
          key={i}
          type="button"
          onClick={() => onCite(cite[1])}
          className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--brand-soft-2)] px-1 align-[2px] text-[10px] font-semibold text-[var(--brand-deep)] hover:bg-[var(--brand-solid)] hover:text-white"
          title="Ver el post en el que se basa"
        >
          {cite[1].slice(1)}
        </button>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Markdownish({ text, onCite }: { text: string; onCite: (ref: string) => void }) {
  const blocks: ReactNode[] = [];
  // Un nivel de anidado alcanza: "Pistas:" y sus ítems abajo.
  let list: Array<{ text: string; children: string[] }> = [];
  let quote: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul${blocks.length}`} className="list-disc space-y-1 pl-5 marker:text-[var(--faint)]">
        {list.map((item, i) => (
          <li key={i}>
            {inline(item.text, onCite)}
            {item.children.length ? (
              <ul className="mt-1 list-[circle] space-y-0.5 pl-5">
                {item.children.map((child, j) => (
                  <li key={j}>{inline(child, onCite)}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(
      <blockquote
        key={`q${blocks.length}`}
        className="whitespace-pre-wrap rounded-[var(--r-m)] border-l-4 border-[var(--brand)] bg-[var(--surface-sunk)] px-3 py-2"
      >
        {inline(quote.join("\n"), onCite)}
      </blockquote>,
    );
    quote = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushList();
      quote.push(q[1]);
      continue;
    }
    flushQuote();
    const bullet = /^([-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      const nested = /^\s{2,}/.test(raw) || (list.length > 0 && /:\**$/.test(list[list.length - 1].text) && !/^\d+\./.test(bullet[1]) && /^\s/.test(raw));
      if (nested && list.length) list[list.length - 1].children.push(bullet[2]);
      else list.push({ text: bullet[2], children: [] });
      continue;
    }
    flushList();
    if (!line) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    // Un borrador entre comillas se muestra como cita, para que se vea qué copiar.
    if (/^["“].{40,}["”]$/.test(line)) {
      quote.push(line.replace(/^["“]|["”]$/g, ""));
      flushQuote();
      continue;
    }
    blocks.push(
      <p key={`p${blocks.length}`} className={heading ? "font-semibold" : undefined}>
        {inline(heading ? heading[1] : line, onCite)}
      </p>,
    );
  }
  flushList();
  flushQuote();
  return <div className="space-y-2">{blocks}</div>;
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Avatar() {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-solid)] text-[14px] font-semibold text-white"
    >
      R
    </span>
  );
}

function SourceCard({ cited, highlighted, id }: { cited: Cited; highlighted: boolean; id: string }) {
  const { post, ref } = cited;
  const hook = post.analysis?.hook ?? post.caption?.slice(0, 100) ?? "";
  return (
    <a
      id={id}
      href={post.post_url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={`flex w-[260px] shrink-0 gap-3 rounded-[var(--r-m)] border bg-[var(--surface)] p-2 transition-shadow hover:shadow-[var(--shadow-8)] ${
        highlighted ? "border-[var(--brand)] ring-2 ring-[var(--brand-soft-2)]" : "border-[var(--border)]"
      }`}
    >
      <div className="relative size-14 shrink-0 overflow-hidden rounded-[var(--r-s)]">
        <PostMedia src={post.image_url ?? null} seed={post.author_handle} text="" />
        <span className="absolute left-0.5 top-0.5 rounded-full bg-[var(--brand-solid)] px-1.5 text-[10px] font-semibold leading-[1.6] text-white">
          {ref.slice(1)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold leading-[1.4] text-[var(--text)]">
          @{post.author_handle}
          <span className="font-normal text-[var(--faint)]"> · {post.platform === "linkedin" ? "LinkedIn" : "Instagram"}</span>
        </p>
        {post.outlier_factor ? (
          <p className="text-[12px] leading-[1.4] text-[var(--brand-deep)]">
            {post.outlier_factor >= 10 ? Math.round(post.outlier_factor) : post.outlier_factor.toFixed(1).replace(".", ",")}× su
            engagement habitual
          </p>
        ) : null}
        <p className="line-clamp-2 text-[12px] leading-[1.4] text-[var(--muted)]">{hook}</p>
      </div>
    </a>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text.replace(/\s*\[p\d+\]/g, "").replace(/\*\*/g, ""))
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => undefined);
      }}
      className="text-[12px] leading-[1.4] text-[var(--faint)] hover:text-[var(--text)]"
    >
      {done ? "Copiado" : "Copiar"}
    </button>
  );
}

function Thinking() {
  return (
    <div className="flex items-start gap-3" aria-live="polite">
      <Avatar />
      <div className="rounded-[var(--r-l)] rounded-tl-[var(--r-s)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <span className="sr-only">Buscando en los datos…</span>
        <span className="flex items-center gap-1" aria-hidden>
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="size-2 animate-bounce rounded-full bg-[var(--faint)]"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
          <span className="ml-2 text-[12px] text-[var(--faint)]">Buscando en los datos…</span>
        </span>
      </div>
    </div>
  );
}

// ─── El chat ─────────────────────────────────────────────────────────────────

export function ChatBox({ questions, title }: { questions: string[]; title: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const restored = useRef(false);
  useEffect(() => {
    setTurns(load());
    restored.current = true;
  }, []);
  useEffect(() => save(turns), [turns]);

  // Siempre abajo de todo: lo último es lo que se está leyendo. Al volver a la
  // página, salto directo; durante la charla, con animación.
  const animate = useRef(false);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: animate.current ? "smooth" : "auto" });
    if (restored.current) animate.current = true;
  }, [turns, busy]);

  // La caja crece con el texto, hasta seis renglones.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const send = useCallback(
    async (question: string, base: Turn[] = turns) => {
      const q = question.trim();
      if (!q || busy) return;
      const next: Turn[] = [...base, { role: "user", content: q }];
      setTurns(next);
      setInput("");
      setBusy(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // Las respuestas con error no se mandan como historia.
            messages: next
              .filter((t) => !(t.role === "assistant" && t.error))
              .map((t) => ({ role: t.role, content: t.content })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "No pude responder.");
        setTurns([...next, { role: "assistant", content: data.text, cited: data.cited ?? [] }]);
      } catch (err) {
        setTurns([
          ...next,
          { role: "assistant", content: (err as Error).message || "No pude responder.", cited: [], error: true },
        ]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, turns],
  );

  const retry = (index: number) => {
    const question = turns[index - 1];
    if (question?.role !== "user") return;
    void send(question.content, turns.slice(0, index - 1));
  };

  const cite = (turnIndex: number, ref: string) => {
    const id = `src-${turnIndex}-${ref}`;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    setHighlight(id);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1800);
  };

  const empty = !turns.length;

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[480px] flex-col overflow-hidden rounded-[var(--r-l)] border border-[var(--border)] bg-[var(--bg)] md:h-[calc(100dvh-3rem)]">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar />
          <div className="min-w-0">
            <h1 className="truncate text-[16px] font-semibold leading-[1.4]">{title}</h1>
            <p className="truncate text-[12px] leading-[1.4] text-[var(--faint)]">
              Responde con los datos de la herramienta. Si no tiene el dato, lo dice.
            </p>
          </div>
        </div>
        {!empty ? (
          <button
            type="button"
            onClick={() => {
              setTurns([]);
              inputRef.current?.focus();
            }}
            disabled={busy}
            className="shrink-0 rounded-[var(--r-m)] border border-[var(--border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50"
          >
            Nueva conversación
          </button>
        ) : null}
      </div>

      {/* Mensajes */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
            <p className="text-[24px] font-semibold leading-[1.4]">¿Qué tenés que publicar?</p>
            <p className="mt-1 max-w-[520px] text-[14px] leading-[1.4] text-[var(--muted)]">
              Contame el tema, el mercado o la audiencia. Te digo qué formato y qué apertura vienen rindiendo, con
              ejemplos reales y un borrador.
            </p>
            <div className="mt-6 grid w-full max-w-[720px] gap-2 sm:grid-cols-2">
              {questions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  className="rounded-[var(--r-m)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left text-[14px] leading-[1.4] text-[var(--text)] shadow-[var(--shadow-4)] transition-shadow hover:shadow-[var(--shadow-8)]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[880px] flex-col gap-5 px-4 py-6">
            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-[var(--r-l)] rounded-tr-[var(--r-s)] bg-[var(--brand-solid)] px-4 py-2 text-[16px] leading-[1.4] text-white">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex items-start gap-3">
                  <Avatar />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`rounded-[var(--r-l)] rounded-tl-[var(--r-s)] border bg-[var(--surface)] px-4 py-3 text-[16px] leading-[1.4] text-[var(--text)] ${
                        turn.error ? "border-[var(--warn-border)] bg-[var(--warn-bg)]" : "border-[var(--border)]"
                      }`}
                    >
                      <Markdownish text={turn.content} onCite={(ref) => cite(i, ref)} />
                      {turn.cited.length ? (
                        <div className="mt-3 border-t border-[var(--border)] pt-3">
                          <p className="mb-2 text-[12px] font-semibold leading-[1.4] text-[var(--muted)]">
                            En qué se basa
                          </p>
                          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                            {turn.cited.map((c) => (
                              <SourceCard
                                key={c.ref}
                                cited={c}
                                id={`src-${i}-${c.ref}`}
                                highlighted={highlight === `src-${i}-${c.ref}`}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 flex gap-3 pl-1">
                      {turn.error ? (
                        <button
                          type="button"
                          onClick={() => retry(i)}
                          disabled={busy}
                          className="text-[12px] font-semibold leading-[1.4] text-[var(--brand-ink)] hover:underline disabled:opacity-50"
                        >
                          Reintentar
                        </button>
                      ) : (
                        <CopyButton text={turn.content} />
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}
            {busy ? <Thinking /> : null}
          </div>
        )}
      </div>

      {/* Caja para escribir, siempre abajo */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3"
      >
        <div className="mx-auto flex max-w-[880px] items-end gap-2 rounded-[var(--r-l)] border border-[var(--border)] bg-[var(--surface)] p-2 focus-within:border-[var(--brand)]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter manda; Shift+Enter baja de renglón. Durante la composición
              // de acentos (IME) no se manda.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            autoFocus
            aria-label="Pregunta"
            placeholder="Escribí tu pregunta…"
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-[1.4] text-[var(--text)] outline-none placeholder:text-[var(--faint)]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Enviar"
            className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r-m)] bg-[var(--brand-solid)] text-white transition-opacity disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="mx-auto mt-1.5 max-w-[880px] px-1 text-[10px] leading-[1.4] text-[var(--faint)]">
          Enter para enviar · Shift+Enter para otro renglón · Revisá los borradores antes de publicar.
        </p>
      </form>
    </div>
  );
}
