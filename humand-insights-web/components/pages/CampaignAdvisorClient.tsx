"use client";

import { AlertCircle, Languages, Link as LinkIcon, Lock, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import type {
  AdvisorMetadata,
  ChatMessageModel,
  ConversationItem,
  ExternalSourceRecord,
  MarketingRecommendation,
} from "@/components/chat/types";
import { MultiSelectCombobox } from "@/components/layout/MultiSelectCombobox";
import { useGlobalFilters } from "@/lib/data/filter-state";

const DEAL_STAGE_OPTIONS = [
  "qualified",
  "demo_scheduled",
  "demo_done",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

type AdvisorLocal = {
  deal_stage: string[];
};

type AdvisorGenerateResponse = {
  conversation_id: string;
  recommendation: MarketingRecommendation;
  pipeline?: Record<string, unknown> | null;
  insights?: Record<string, unknown> | null;
  metadata?: AdvisorMetadata;
  warnings?: string[];
  external_sources?: ExternalSourceRecord[];
};

type AdvisorFollowupResponse = {
  conversation_id: string;
  answer: string;
  warnings?: string[];
};

type LoadedAdvisorConversation = {
  conversation: ConversationItem;
  snapshot?: Record<string, unknown> | null;
  messages: Array<{
    role: "user" | "assistant";
    kind?: string;
    content?: string;
    payload?: Record<string, unknown>;
  }>;
  recommendation?: MarketingRecommendation | null;
  pipeline?: Record<string, unknown> | null;
  insights?: Record<string, unknown> | null;
};

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function toRequestFilters(
  global: ReturnType<typeof useGlobalFilters>[0],
  local: AdvisorLocal,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (global.regions.length === 1) out.region = global.regions[0];
  else if (global.regions.length > 1) out.region = global.regions;
  if (global.segments.length === 1) out.segment = global.segments[0];
  else if (global.segments.length > 1) out.segment = global.segments;
  if (global.industries.length) out.industry = global.industries;
  if (global.countries.length) out.country = global.countries;
  if (local.deal_stage.length) out.deal_stage = local.deal_stage;
  if (global.date_start) out.start_date = global.date_start;
  if (global.date_end) out.end_date = global.date_end;
  return out;
}

function messagesFromLoaded(loaded: LoadedAdvisorConversation): ChatMessageModel[] {
  const out: ChatMessageModel[] = [];
  let recommendationAttached = false;
  loaded.messages.forEach((m, i) => {
    if (m.role === "user") {
      const content =
        (m.payload?.content as string | undefined) ?? m.content ?? "";
      out.push({
        id: createId(`user-${i}`),
        role: "user",
        content,
      });
      return;
    }
    const kind = m.kind ?? "";
    const payload = (m.payload ?? {}) as Record<string, unknown>;
    const content =
      (payload.content as string | undefined) ??
      (payload.answer as string | undefined) ??
      m.content ??
      "";

    if (kind === "recommendation" || kind === "translation") {
      const rec =
        !recommendationAttached && loaded.recommendation
          ? loaded.recommendation
          : null;
      if (rec) recommendationAttached = true;
      out.push({
        id: createId(`assistant-${i}`),
        role: "assistant",
        content: content || (rec?.segment_summary ?? "Recommendation."),
        mode: "advisor_recommendation",
        recommendation: rec,
      });
      return;
    }
    out.push({
      id: createId(`assistant-${i}`),
      role: "assistant",
      content,
      mode: "advisor_followup",
    });
  });
  return out;
}

export function CampaignAdvisorClient({ filterBar }: { filterBar?: ReactNode } = {}) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageModel[]>([]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalFilters] = useGlobalFilters();
  const [local, setLocal] = useState<AdvisorLocal>({ deal_stage: [] });
  const [targetLanguage, setTargetLanguage] = useState("");
  const [externalUrls, setExternalUrls] = useState<string[]>([]);
  const [externalUrlDraft, setExternalUrlDraft] = useState("");
  const [externalSourcesResult, setExternalSourcesResult] = useState<ExternalSourceRecord[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [hasRecommendation, setHasRecommendation] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refreshConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const res = await fetch("/api/advisor/conversations", { cache: "no-store" });
      if (!res.ok) throw new Error(`No pude cargar conversaciones (${res.status})`);
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
    setHasRecommendation(false);
    try {
      const res = await fetch(`/api/advisor/conversations/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`No pude cargar la conversacion (${res.status})`);
      const data = (await res.json()) as LoadedAdvisorConversation;
      setMessages(messagesFromLoaded(data));
      setHasRecommendation(Boolean(data.recommendation));
      const snap = (data.snapshot ?? {}) as Record<string, unknown>;
      const inferred = (snap.inferred_filters ?? {}) as Record<string, unknown>;
      const sources = Array.isArray(inferred.external_sources)
        ? (inferred.external_sources as ExternalSourceRecord[])
        : [];
      setExternalSourcesResult(sources);
      setExternalUrls(sources.map((s) => s.url).filter(Boolean));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar conversacion");
    }
  }, []);

  const newConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setHasRecommendation(false);
    setExternalUrls([]);
    setExternalSourcesResult([]);
    setExternalUrlDraft("");
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsSubmitting(false);
  }, []);

  const chatHistoryForFollowup = useMemo(() => {
    return messages
      .filter((m) => m.mode !== "advisor_recommendation")
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

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
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (!hasRecommendation) {
        const res = await fetch("/api/advisor/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            conversation_id: activeId,
            filters: toRequestFilters(globalFilters, local),
            external_sources: externalUrls,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Error ${res.status}`);
        }
        const data = (await res.json()) as AdvisorGenerateResponse;
        const assistantMsg: ChatMessageModel = {
          id: createId("assistant"),
          role: "assistant",
          content: data.recommendation?.segment_summary ?? "Recommendation generated.",
          mode: "advisor_recommendation",
          recommendation: data.recommendation,
          metadata: data.metadata,
          pipeline: data.pipeline ?? null,
          insights: data.insights ?? null,
          warnings: data.warnings,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setHasRecommendation(true);
        if (data.external_sources) setExternalSourcesResult(data.external_sources);
        if (data.conversation_id && data.conversation_id !== activeId) {
          setActiveId(data.conversation_id);
          refreshConversations();
        }
        return;
      }

      if (!activeId) {
        throw new Error("No active conversation for follow-up.");
      }
      const res = await fetch("/api/advisor/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: activeId,
          question,
          target_language: targetLanguage || "",
          chat_history: chatHistoryForFollowup,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Error ${res.status}`);
      }
      const data = (await res.json()) as AdvisorFollowupResponse;
      const assistantMsg: ChatMessageModel = {
        id: createId("assistant"),
        role: "assistant",
        content: data.answer,
        mode: "advisor_followup",
        warnings: data.warnings,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    activeId,
    chatHistoryForFollowup,
    externalUrls,
    globalFilters,
    local,
    hasRecommendation,
    input,
    isSubmitting,
    refreshConversations,
    targetLanguage,
  ]);

  const renameConversation = useCallback(
    async (id: string, currentTitle: string) => {
      const next = typeof window !== "undefined" ? window.prompt("Nuevo título:", currentTitle) : null;
      if (!next || next.trim() === "" || next === currentTitle) return;
      try {
        const res = await fetch(`/api/advisor/conversations/${id}`, {
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
        const res = await fetch(`/api/advisor/conversations/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        if (id === activeId) {
          setActiveId(null);
          setMessages([]);
          setHasRecommendation(false);
        }
        await refreshConversations();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al eliminar");
      }
    },
    [activeId, refreshConversations],
  );

  const translate = useCallback(async () => {
    if (!activeId || !targetLanguage.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/advisor/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: activeId,
          target_language: targetLanguage.trim(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Error ${res.status}`);
      }
      const data = (await res.json()) as AdvisorGenerateResponse;
      const assistantMsg: ChatMessageModel = {
        id: createId("assistant"),
        role: "assistant",
        content:
          data.recommendation?.segment_summary ??
          `Recommendation translated to ${targetLanguage}.`,
        mode: "advisor_recommendation",
        recommendation: data.recommendation,
        metadata: data.metadata,
        pipeline: data.pipeline ?? null,
        insights: data.insights ?? null,
        warnings: data.warnings,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setIsSubmitting(false);
    }
  }, [activeId, isSubmitting, targetLanguage]);

  const inputBase =
    "h-9 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-white px-3 text-[13px] text-[var(--color-text-default)] outline-none transition-colors focus:border-[var(--color-brand-400)] disabled:cursor-not-allowed disabled:bg-[var(--color-neutral-100)]";
  const labelBase =
    "flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]";

  const addExternalUrl = () => {
    const raw = externalUrlDraft.trim();
    if (!raw) return;
    let normalized = raw;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    try {
      const u = new URL(normalized);
      if (!u.hostname) throw new Error("hostname");
    } catch {
      setError(`URL inválida: ${raw}`);
      return;
    }
    if (externalUrls.includes(normalized)) {
      setExternalUrlDraft("");
      return;
    }
    if (externalUrls.length >= 5) {
      setError("Máximo 5 URLs de contexto.");
      return;
    }
    setExternalUrls((prev) => [...prev, normalized]);
    setExternalUrlDraft("");
  };

  const removeExternalUrl = (url: string) => {
    setExternalUrls((prev) => prev.filter((u) => u !== url));
    setExternalSourcesResult((prev) => prev.filter((r) => r.url !== url));
  };

  const sourcesErrors = externalSourcesResult.filter((r) => r.error);

  const advisorFilterBar = (
    <div className="flex flex-col gap-2">
      {filterBar}
      {hasRecommendation ? (
        <div className="flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] px-2.5 py-1 text-[11px] text-[var(--color-brand-500)]">
          <Lock size={11} strokeWidth={2.5} />
          Filtros bloqueados para esta recomendación. Creá una conversación nueva para cambiarlos.
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] px-3 py-2 shadow-[var(--shadow-4dp)]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
          Advisor
        </span>
        <div className="min-w-[160px]">
          <MultiSelectCombobox
            label="Etapa"
            options={[...DEAL_STAGE_OPTIONS]}
            value={local.deal_stage}
            onChange={(next) => setLocal((prev) => ({ ...prev, deal_stage: next }))}
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <input
            type="text"
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
            placeholder="Traducir a pt-BR, en-US..."
            className={`${inputBase} w-48`}
          />
          <button
            type="button"
            onClick={translate}
            disabled={!activeId || !targetLanguage.trim() || isSubmitting || !hasRecommendation}
            title="Traducir recomendación actual"
            className="flex h-9 items-center gap-1.5 rounded-[var(--radius-s)] bg-[var(--color-brand-500)] px-3 text-[12px] font-semibold text-white transition hover:bg-[var(--color-brand-400)] disabled:cursor-not-allowed disabled:bg-[var(--color-neutral-200)] disabled:text-[var(--color-text-secondary)]"
          >
            <Languages size={13} strokeWidth={2.5} />
            Traducir
          </button>
        </div>
      </div>

      <div className="rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] shadow-[var(--shadow-4dp)]">
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-[var(--color-text-default)] transition hover:bg-[var(--color-neutral-100)]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-s)] bg-[var(--color-brand-50)] text-[var(--color-brand-500)]">
            <LinkIcon size={13} strokeWidth={2.5} />
          </span>
          <span>Fuentes externas</span>
          {externalUrls.length > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-brand-500)] px-1.5 text-[10px] font-bold text-white">
              {externalUrls.length}
            </span>
          ) : (
            <span className="text-[11px] font-normal text-[var(--color-text-secondary)]">
              Opcional · hasta 5 URLs de contexto
            </span>
          )}
          {sourcesErrors.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
              <AlertCircle size={10} />
              {sourcesErrors.length}
            </span>
          ) : null}
          <span className="ml-auto text-[10px] text-[var(--color-text-secondary)]">
            {showSources ? "Ocultar" : "Mostrar"}
          </span>
        </button>
        {showSources ? (
          <div className="space-y-2 border-t border-[var(--color-neutral-100)] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={externalUrlDraft}
                onChange={(e) => setExternalUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addExternalUrl();
                  }
                }}
                placeholder="https://… (campaña, artículo, doc, nota)"
                disabled={hasRecommendation}
                className={`${inputBase} flex-1`}
              />
              <button
                type="button"
                onClick={addExternalUrl}
                disabled={hasRecommendation || !externalUrlDraft.trim()}
                className="flex h-9 items-center gap-1 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] px-2.5 text-[12px] font-semibold text-[var(--color-text-default)] transition hover:bg-[var(--color-neutral-100)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={12} strokeWidth={2.5} />
                Agregar
              </button>
            </div>
            <p className="text-[10px] text-[var(--color-text-secondary)]">
              Humand fetchea cada URL (máx ~4k caracteres) y la pasa al advisor como material de contexto. Útil para campañas, artículos, notas o cualquier referencia que quieras inyectar.
            </p>
            {externalUrls.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {externalUrls.map((url) => {
                  const match = externalSourcesResult.find((r) => r.url === url);
                  const hasError = Boolean(match?.error);
                  const hasExcerpt = Boolean(match?.excerpt);
                  return (
                    <li
                      key={url}
                      className={`flex items-center gap-2 rounded-[var(--radius-s)] border px-2 py-1 text-[11px] ${
                        hasError
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-[var(--color-neutral-200)] bg-[var(--color-bg-page)] text-[var(--color-text-default)]"
                      }`}
                    >
                      <LinkIcon size={11} className="shrink-0 opacity-60" />
                      <span className="truncate" title={match?.error ?? match?.excerpt}>
                        {url}
                      </span>
                      {hasExcerpt && !hasError ? (
                        <span className="shrink-0 rounded-full bg-[var(--color-brand-50)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-brand-500)]">
                          OK
                        </span>
                      ) : null}
                      {hasError ? (
                        <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                          Error
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeExternalUrl(url)}
                        disabled={hasRecommendation}
                        className="ml-auto rounded-full p-0.5 text-[var(--color-text-secondary)] transition hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text-default)] disabled:opacity-40"
                        aria-label="Quitar"
                      >
                        <X size={11} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <ChatInterface
      title="Campaign Advisor"
      description="Generador de angulos de campana con datos reales del pipeline y transcripts. Seleccion filtros para la primera generacion; luego seguimos la conversacion y podemos traducir la recomendacion."
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
      inputPlaceholder={
        hasRecommendation
          ? "Pregunta de follow-up sobre la recomendacion..."
          : "Ej: Como atacamos Enterprise en HISPAM este Q"
      }
      sidebarTitle="Recomendaciones"
      filterBar={advisorFilterBar}
      assistantLabel="Advisor"
      onCancel={cancel}
      starterPrompts={[
        "¿Cómo atacamos Enterprise en HISPAM este Q?",
        "Mensaje que funciona mejor para Mid Market en LatAm",
        "Angle de campaña para retail en Brasil",
        "¿Qué mensaje usar contra Buk en SMB?",
      ]}
      alerts={
        error ? (
          <div className="rounded-[var(--radius-m)] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        ) : null
      }
      emptyState={
        <div className="rounded-[var(--radius-m)] border border-dashed border-[var(--color-neutral-200)] bg-[var(--color-brand-50)] px-6 py-10 text-center text-sm text-[var(--color-text-secondary)]">
          Completa filtros opcionales y escribi una pregunta como{" "}
          <span className="font-medium text-[var(--color-text-default)]">
            &quot;Que mensaje funciona mejor para Mid Market en HISPAM?&quot;
          </span>
        </div>
      }
    />
  );
}
