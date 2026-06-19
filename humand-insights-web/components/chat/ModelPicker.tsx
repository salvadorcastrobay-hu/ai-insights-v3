"use client";

import { CHAT_MODELS } from "@/lib/chat-models";
import { useTranslations } from "next-intl";

// Selector de modelo (básico/intermedio/avanzado) reutilizable en los chats.
export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("models");
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-[var(--color-text-secondary)]">Modelo</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title="Modelo a usar (más avanzado = mejor calidad, más caro)"
        className="rounded-full border border-[var(--color-neutral-200)] bg-white px-2 py-1 text-[12px] text-[var(--color-text-default)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-400)] disabled:opacity-50"
      >
        {CHAT_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {t(m.tier)}
          </option>
        ))}
      </select>
    </div>
  );
}
