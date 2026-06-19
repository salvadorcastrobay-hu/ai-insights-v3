"use client";

import { Globe } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import { setLocale } from "@/lib/locale-action";
import type { Locale } from "@/i18n/request";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "en", label: "English" },
];

export function LocaleToggle() {
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="flex items-center justify-center rounded-md p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]"
        aria-label="Change language"
      >
        <Globe size={15} />
      </button>

      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 min-w-[110px] rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.10)]">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={pending}
              onClick={() => {
                startTransition(() => setLocale(opt.value));
                setOpen(false);
              }}
              className={[
                "w-full px-3 py-1.5 text-left text-[12px] font-medium transition-colors",
                locale === opt.value
                  ? "bg-[var(--color-brand-50)] text-[var(--color-brand-500)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
