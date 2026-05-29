"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { UsageRing } from "@/components/usage/UsageRing";
import type {
  ChartPayload,
  ChatMessageModel,
  ConversationItem,
  DataTablePayload,
  SearchResult,
} from "@/components/chat/types";
import { FILTER_PARSERS, useGlobalFilters } from "@/lib/data/filter-state";

const FILTER_KEYS = FILTER_PARSERS;

type ChatApiResponse = {
  conversation_id?: string;
  mode?: ChatMessageModel["mode"];
  content?: string;
  summary?: string | null;
  synthesis?: string | null;
  sql?: string | null;
  quant_sql?: string | null;
  qual_sql?: string | null;
  search_query?: string | null;
  search_filters?: string | null;
  search_sql?: string | null;
  raw_data?: DataTablePayload | null;
  quant_data?: DataTablePayload | null;
  qual_data?: DataTablePayload | null;
  search_sql_data?: DataTablePayload | null;
  search_data?: SearchResult[];
  auto_chart?: ChartPayload | null;
  quant_chart?: ChartPayload | null;
  search_sql_chart?: ChartPayload | null;
  warnings?: string[];
  filters_applied?: Record<string, unknown> | null;
};

type LoadedConversation = {
  conversation: ConversationItem;
  messages: Array<{
    role: "user" | "assistant";
    payload?: Record<string, unknown>;
    content?: string;
  }>;
};

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function buildAssistantMessage(response: ChatApiResponse): ChatMessageModel {
  const content =
    response.synthesis ??
    response.summary ??
    response.content ??
    "Respuesta recibida.";
  return {
    id: createId("assistant"),
    role: "assistant",
    content,
    mode: response.mode ?? "chat",
    warnings: response.warnings,
    sql: response.sql ?? null,
    quant_sql: response.quant_sql ?? null,
    qual_sql: response.qual_sql ?? null,
    search_query: response.search_query ?? null,
    search_filters: response.search_filters ?? null,
    search_sql: response.search_sql ?? null,
    table: response.raw_data ?? null,
    quant_table: response.quant_data ?? null,
    qual_table: response.qual_data ?? null,
    search_sql_table: response.search_sql_data ?? null,
    chart: response.auto_chart ?? response.quant_chart ?? response.search_sql_chart ?? null,
    search_results: response.search_data ?? undefined,
    filters_applied: response.filters_applied ?? null,
  };
}

function messagesFromLoaded(loaded: LoadedConversation): ChatMessageModel[] {
  return loaded.messages.map((m, i) => {
    if (m.role === "user") {
      const content =
        (m.payload?.content as string | undefined) ?? m.content ?? "";
      return {
        id: createId(`user-${i}`),
        role: "user",
        content,
      } as ChatMessageModel;
    }
    // Assistant: el backend guarda los campos del response spread directamente
    // sobre la message (assistant_message = {role: "assistant", ...response}),
    // así que content/summary/synthesis viven en el top-level de m. Fallback a
    // m.payload por si en algún momento se guardaron wrappeados.
    const payload = (m as unknown as ChatApiResponse) ?? {};
    const wrapped = (m.payload as ChatApiResponse | undefined) ?? {};
    const merged: ChatApiResponse = { ...wrapped, ...payload };
    return buildAssistantMessage(merged);
  });
}

export function SqlChatClient({ filterBar }: { filterBar?: ReactNode } = {}) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageModel[]>([]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [filters, setFilters] = useGlobalFilters();

  const activeFiltersPayload = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
    return out;
  }, [filters]);

  const refreshConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const res = await fetch("/api/chat/conversations", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`No pude cargar conversaciones (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { conversations?: ConversationItem[] };
      setConversations(data.conversations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al listar conversaciones");
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    refreshConversations();
    return () => abortRef.current?.abort();
  }, [refreshConversations]);

  const selectConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setMessages([]);
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`No pude cargar la conversacion (${res.status})`);
      const data = (await res.json()) as LoadedConversation;
      setMessages(messagesFromLoaded(data));
      const firstWithFilters = data.messages.find(
        (m) => m.payload && (m.payload as Record<string, unknown>).filters_applied,
      );
      const restored = firstWithFilters?.payload?.filters_applied as
        | Record<string, unknown>
        | undefined;
      if (restored && typeof restored === "object") {
        const next: Record<string, unknown> = {};
        for (const key of Object.keys(FILTER_KEYS)) {
          const v = (restored as Record<string, unknown>)[key];
          if (v !== undefined) next[key] = v;
        }
        if (Object.keys(next).length > 0) {
          void setFilters(next as Parameters<typeof setFilters>[0]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar conversacion");
    }
  }, [setFilters]);

  const newConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setInput("");
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsSubmitting(false);
  }, []);

  const submit = useCallback(async () => {
    const question = input.trim();
    if (!question || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const userMsg: ChatMessageModel = {
      id: createId("user"),
      role: "user",
      content: question,
    };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          conversation_id: activeId,
          history,
          filters: activeFiltersPayload,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Error ${res.status}`);
      }
      const data = (await res.json()) as ChatApiResponse;
      const assistantMsg = buildAssistantMessage(data);
      if (Object.keys(activeFiltersPayload).length > 0) {
        assistantMsg.filters_applied = activeFiltersPayload;
      }
      setMessages((prev) => [...prev, assistantMsg]);
      if (data.conversation_id && data.conversation_id !== activeId) {
        setActiveId(data.conversation_id);
        refreshConversations();
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setIsSubmitting(false);
    }
  }, [activeId, activeFiltersPayload, input, isSubmitting, messages, refreshConversations]);

  const renameConversation = useCallback(
    async (id: string, currentTitle: string) => {
      const next = typeof window !== "undefined" ? window.prompt("Nuevo título:", currentTitle) : null;
      if (!next || next.trim() === "" || next === currentTitle) return;
      try {
        const res = await fetch(`/api/chat/conversations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next.trim() }),
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        await refreshConversations();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al renombrar");
      }
    },
    [refreshConversations],
  );

  const deleteConversation = useCallback(
    async (id: string, currentTitle: string) => {
      const ok = typeof window !== "undefined" && window.confirm(`¿Eliminar "${currentTitle}"?`);
      if (!ok) return;
      try {
        const res = await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        if (id === activeId) {
          setActiveId(null);
          setMessages([]);
        }
        await refreshConversations();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al eliminar");
      }
    },
    [activeId, refreshConversations],
  );

  return (
    <ChatInterface
      title="Chat con IA"
      description="Respuestas sobre pains, gaps, competidores y deals usando datos reales de demos y pipeline. Modos: SQL cuantitativo, hybrid (cuanti+cuali), semantic search y chat."
      conversations={conversations}
      activeConversationId={activeId}
      onSelectConversation={selectConversation}
      onNewConversation={newConversation}
      onRenameConversation={renameConversation}
      onDeleteConversation={deleteConversation}
      isLoadingConversations={isLoadingConversations}
      messages={messages}
      inputValue={input}
      onInputChange={setInput}
      onSubmit={submit}
      isSubmitting={isSubmitting}
      inputPlaceholder="Ej: Top 10 pains en Enterprise en los ultimos 90 dias"
      sidebarTitle="Consultas guardadas"
      assistantLabel="AI"
      onCancel={cancel}
      inputAccessory={
        filterBar ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              title="Filtros"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-brand-500)]"
            >
              <SlidersHorizontal size={15} strokeWidth={2} />
            </button>
            {showFilters ? (
              <div className="absolute bottom-10 left-0 z-30 w-[640px] max-w-[90vw] rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white p-3 shadow-[var(--shadow-8dp)]">
                <div className="mb-2 flex items-center gap-2">
                  <SlidersHorizontal size={13} className="text-[var(--color-brand-500)]" />
                  <span className="text-[12px] font-semibold text-[var(--color-text-default)]">Filtros</span>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="ml-auto rounded-full p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-neutral-100)]"
                    aria-label="Cerrar"
                  >
                    <X size={12} />
                  </button>
                </div>
                {filterBar}
              </div>
            ) : null}
          </div>
        ) : undefined
      }
      inputTrailing={<UsageRing visibleForOwners={["salvador.castrobay", "laura.flores"]} />}
      starterPrompts={[
        "Top 10 pains en Enterprise en los últimos 90 días",
        "¿Cuáles son los competidores más mencionados en Mid Market?",
        "Revenue at stake por feature gap en HISPAM",
        "¿Qué fricciones aparecen más en deals perdidos?",
      ]}
      alerts={
        error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null
      }
      emptyState={
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
          Empeza con una pregunta como{" "}
          <span className="font-medium text-slate-700">
            &quot;Cuales son los competidores mas mencionados en Mid Market?&quot;
          </span>
        </div>
      }
    />
  );
}
