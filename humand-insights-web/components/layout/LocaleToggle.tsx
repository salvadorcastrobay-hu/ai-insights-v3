"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "@/lib/locale-action";
import type { Locale } from "@/i18n/request";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "es", label: "ES" },
  { value: "pt", label: "PT" },
  { value: "en", label: "EN" },
];

export function LocaleToggle() {
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          disabled={pending}
          onClick={() => startTransition(() => setLocale(opt.value))}
          className={[
            "rounded-[5px] px-2 py-1 text-[11px] font-semibold transition-colors",
            locale === opt.value
              ? "bg-[var(--color-brand-100)] text-[var(--color-brand-500)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
