"use client";

import { Lock, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { UsageRing } from "@/components/usage/UsageRing";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { DEFAULT_CHAT_MODEL } from "@/lib/chat-models";
import type {
  AdvisorMetadata,
  ChatMessageModel,
  ConversationItem,
  MarketingRecommendation,
} from "@/components/chat/types";
import { MultiSelectCombobox } from "@/components/layout/MultiSelectCombobox";
import { useGlobalFilters } from "@/lib/data/filter-state";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("advisor");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageModel[]>([]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalFilters] = useGlobalFilters();
  const [local, setLocal] = useState<AdvisorLocal>({ deal_stage: [] });
  const [showFilters, setShowFilters] = useState(false);
  const [hasRecommendation, setHasRecommendation] = useState(false);
  const [model, setModel] = useState<string>(DEFAULT_CHAT_MODEL);
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
            model,
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
          chat_history: chatHistoryForFollowup,
          model,
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
    globalFilters,
    local,
    hasRecommendation,
    input,
    isSubmitting,
    refreshConversations,
    model,
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

  const translate = useCallback(async (language: string) => {
    if (!activeId || !language.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/advisor/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: activeId,
          target_language: language.trim(),
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
          `Recommendation translated to ${language}.`,
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
  }, [activeId, isSubmitting]);

  // Solo mostramos un mini-warning cuando los filtros están lockeados.
  // Los filtros y Etapa viven en un popover triggereado desde el chatbar.
  const advisorFilterBar = hasRecommendation ? (
    <div className="flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] px-2.5 py-1 text-[11px] text-[var(--color-brand-500)]">
      <Lock size={11} strokeWidth={2.5} />
      {t("closedFilters")}
    </div>
  ) : null;

  // Popover de filtros (global + Etapa) accesible desde el chatbar.
  const filtersAccessory = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowFilters((v) => !v)}
        disabled={hasRecommendation}
        title={hasRecommendation ? t("closedFilters") : t("filterLabel")}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-brand-500)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <SlidersHorizontal size={15} strokeWidth={2} />
      </button>
      {showFilters ? (
        <div className="absolute bottom-10 left-0 z-30 w-[640px] max-w-[90vw] rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white p-3 shadow-[var(--shadow-8dp)]">
          <div className="mb-2 flex items-center gap-2">
            <SlidersHorizontal size={13} className="text-[var(--color-brand-500)]" />
            <span className="text-[12px] font-semibold text-[var(--color-text-default)]">{t("filterLabel")}</span>
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              className="ml-auto rounded-full p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-neutral-100)]"
              aria-label="Cerrar"
            >
              <X size={12} />
            </button>
          </div>
          <div className="space-y-2">
            {filterBar}
            <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-100)] bg-[var(--color-bg-page)] px-2 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                Advisor — etapa del deal
              </div>
              <MultiSelectCombobox
                label={t("stageLabel")}
                options={[...DEAL_STAGE_OPTIONS]}
                value={local.deal_stage}
                onChange={(next) => setLocal((prev) => ({ ...prev, deal_stage: next }))}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <ChatInterface
      title={t("title")}
      description={t("description")}
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
          ? t("followupPlaceholder")
          : t("initPlaceholder")
      }
      sidebarTitle={t("sidebarTitle")}
      filterBar={advisorFilterBar}
      assistantLabel={t("assistantLabel")}
      onCancel={cancel}
      inputAccessory={filtersAccessory}
      belowInput={
        <div className="flex items-center gap-2.5">
          <ModelPicker value={model} onChange={setModel} disabled={isSubmitting} />
          <UsageRing />
        </div>
      }
      onTranslate={hasRecommendation && activeId ? translate : undefined}
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
