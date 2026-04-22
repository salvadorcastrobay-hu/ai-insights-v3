"use client";

import { ArrowUp, Sparkles, Square } from "lucide-react";
import { FormEvent, type ReactNode } from "react";
import { ChatMessage } from "./ChatMessage";
import { ConversationList } from "./ConversationList";
import type { ChatMessageModel, ConversationItem } from "./types";

type Props = {
  title: string;
  description: string;
  conversations: ConversationItem[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRenameConversation?: (id: string, currentTitle: string) => void;
  onDeleteConversation?: (id: string, currentTitle: string) => void;
  isLoadingConversations?: boolean;
  messages: ChatMessageModel[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  isSubmitting?: boolean;
  inputPlaceholder?: string;
  sidebarTitle?: string;
  toolbar?: ReactNode;
  alerts?: ReactNode;
  emptyState?: ReactNode;
  filterBar?: ReactNode;
  assistantLabel?: string;
  onCancel?: () => void;
  starterPrompts?: string[];
  onStarterPromptClick?: (prompt: string) => void;
};

export function ChatInterface({
  title,
  description,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  isLoadingConversations = false,
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  isSubmitting = false,
  inputPlaceholder = "Escribi tu mensaje...",
  sidebarTitle,
  toolbar,
  alerts,
  emptyState,
  filterBar,
  assistantLabel = "Assistant",
  onCancel,
  starterPrompts,
  onStarterPromptClick,
}: Props) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onSubmit();
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-4">
      <ConversationList
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={onSelectConversation}
        onNewConversation={onNewConversation}
        onRenameConversation={onRenameConversation}
        onDeleteConversation={onDeleteConversation}
        title={sidebarTitle}
        isLoading={isLoadingConversations}
      />

      <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] shadow-[var(--shadow-4dp)]">
        <header className="shrink-0 border-b border-[var(--color-neutral-100)] px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-gradient-to-br from-[var(--color-brand-400)] to-[var(--color-brand-500)] text-white">
              <Sparkles size={14} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-500)]">
                Humand Insights AI
              </p>
              <h1 className="text-[18px] font-semibold leading-tight text-[var(--color-text-default)]">
                {title}
              </h1>
            </div>
          </div>
          <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[var(--color-text-secondary)]">
            {description}
          </p>
        </header>

        {toolbar ? (
          <div className="shrink-0 border-b border-[var(--color-neutral-100)] px-6 py-3">
            {toolbar}
          </div>
        ) : null}
        {alerts ? (
          <div className="shrink-0 border-b border-[var(--color-neutral-100)] px-6 py-3">
            {alerts}
          </div>
        ) : null}

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="space-y-4">
              {emptyState ?? (
                <div className="rounded-[var(--radius-m)] border border-dashed border-[var(--color-neutral-200)] bg-[var(--color-brand-50)] px-6 py-10 text-center text-sm text-[var(--color-text-secondary)]">
                  No hay mensajes todavia. Empeza una conversacion para ver resultados aca.
                </div>
              )}
              {starterPrompts && starterPrompts.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => {
                        if (onStarterPromptClick) onStarterPromptClick(prompt);
                        else onInputChange(prompt);
                      }}
                      className="group rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] px-4 py-3 text-left text-[13px] leading-5 text-[var(--color-text-default)] shadow-[var(--shadow-4dp)] transition hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]"
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-500)]">
                        Sugerencia
                      </span>
                      <p className="mt-1">{prompt}</p>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              assistantLabel={assistantLabel}
            />
          ))}
        </div>

        {filterBar ? (
          <div className="shrink-0 border-t border-[var(--color-neutral-100)] bg-[var(--color-bg-page)] px-4 py-2">
            {filterBar}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-[var(--color-neutral-100)] bg-[var(--color-bg-card)] px-4 py-3"
        >
          <div className="flex items-end gap-2 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white p-2 transition-colors focus-within:border-[var(--color-brand-400)]">
            <textarea
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              rows={2}
              className="flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[14px] leading-5 text-[var(--color-text-default)] outline-none placeholder:text-[var(--color-text-secondary)]"
            />
            {isSubmitting && onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cancelar"
                title="Cancelar"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-default)] text-white transition hover:bg-[var(--color-text-secondary)]"
              >
                <Square size={12} strokeWidth={3} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting || inputValue.trim().length === 0}
                aria-label="Enviar"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-500)] text-white transition hover:bg-[var(--color-brand-400)] disabled:cursor-not-allowed disabled:bg-[var(--color-neutral-200)]"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <p className="mt-1.5 px-2 text-[10px] text-[var(--color-text-secondary)]">
            {isSubmitting
              ? "Procesando… tocá el botón para cancelar"
              : "Enter para enviar · Shift+Enter para nueva línea"}
          </p>
        </form>
      </section>
    </div>
  );
}
