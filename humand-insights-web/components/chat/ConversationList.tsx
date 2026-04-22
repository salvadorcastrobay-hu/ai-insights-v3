"use client";

import { MessageSquarePlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ConversationItem } from "./types";

type Props = {
  conversations: ConversationItem[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRenameConversation?: (id: string, currentTitle: string) => void;
  onDeleteConversation?: (id: string, currentTitle: string) => void;
  title?: string;
  isLoading?: boolean;
};

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function ConversationList({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  title = "Conversaciones",
  isLoading = false,
}: Props) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpenMenuId(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenuId]);
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] shadow-[var(--shadow-4dp)]">
      <div className="shrink-0 border-b border-[var(--color-neutral-100)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-[var(--color-text-default)]">
            {title}
          </p>
          <button
            type="button"
            onClick={onNewConversation}
            className="flex items-center gap-1 rounded-full bg-[var(--color-brand-500)] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[var(--color-brand-400)]"
          >
            <MessageSquarePlus size={12} />
            Nueva
          </button>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
          Historial persistido en Supabase
        </p>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="rounded-[var(--radius-s)] border border-dashed border-[var(--color-neutral-200)] px-3 py-5 text-center text-xs text-[var(--color-text-secondary)]">
            Cargando...
          </div>
        ) : null}

        {!isLoading && conversations.length === 0 ? (
          <div className="rounded-[var(--radius-s)] border border-dashed border-[var(--color-neutral-200)] px-3 py-5 text-center text-xs text-[var(--color-text-secondary)]">
            Sin conversaciones guardadas.
          </div>
        ) : null}

        {conversations.map((conversation) => {
          const isActive = conversation.id === activeConversationId;
          const menuOpen = openMenuId === conversation.id;
          const canEdit = Boolean(onRenameConversation || onDeleteConversation);
          return (
            <div
              key={conversation.id}
              className={[
                "group relative w-full rounded-[var(--radius-s)] border transition",
                isActive
                  ? "border-[var(--color-brand-400)] bg-[var(--color-brand-50)]"
                  : "border-transparent bg-transparent hover:bg-[var(--color-neutral-100)]",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => onSelectConversation(conversation.id)}
                className="w-full px-3 py-2 pr-8 text-left"
              >
                <p
                  className={[
                    "line-clamp-1 text-[13px] font-medium",
                    isActive
                      ? "text-[var(--color-brand-500)]"
                      : "text-[var(--color-text-default)]",
                  ].join(" ")}
                >
                  {conversation.title}
                </p>
                {conversation.initial_question ? (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-text-secondary)]">
                    {conversation.initial_question}
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">
                  {formatDate(conversation.created_at)}
                </p>
              </button>
              {canEdit ? (
                <div
                  ref={menuOpen ? menuRef : null}
                  className="absolute right-1 top-1"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId((curr) => (curr === conversation.id ? null : conversation.id));
                    }}
                    aria-label="Opciones"
                    className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-s)] text-[var(--color-text-secondary)] opacity-0 transition hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text-default)] group-hover:opacity-100 data-[open=true]:opacity-100"
                    data-open={menuOpen}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {menuOpen ? (
                    <div className="absolute right-0 top-7 z-10 flex min-w-[150px] flex-col overflow-hidden rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] shadow-[var(--shadow-8dp)]">
                      {onRenameConversation ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            onRenameConversation(conversation.id, conversation.title);
                          }}
                          className="flex items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--color-text-default)] transition hover:bg-[var(--color-neutral-100)]"
                        >
                          <Pencil size={12} />
                          Renombrar
                        </button>
                      ) : null}
                      {onDeleteConversation ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            onDeleteConversation(conversation.id, conversation.title);
                          }}
                          className="flex items-center gap-2 px-3 py-2 text-left text-[12px] text-red-600 transition hover:bg-red-50"
                        >
                          <Trash2 size={12} />
                          Eliminar
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
