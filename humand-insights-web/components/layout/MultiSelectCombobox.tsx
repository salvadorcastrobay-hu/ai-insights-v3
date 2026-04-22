"use client";

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "cmdk";
import { Check, ChevronDown, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
};

export function MultiSelectCombobox({
  label,
  value,
  options,
  onChange,
  placeholder = "Buscar...",
  emptyText = "Sin resultados",
}: Props) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(value), [value]);
  const count = value.length;

  function toggle(option: string) {
    if (selectedSet.has(option)) {
      onChange(value.filter((v) => v !== option));
    } else {
      onChange([...value, option]);
    }
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  const triggerLabel =
    count === 0
      ? "Todos"
      : count === 1
        ? value[0]
        : `${count} seleccionados`;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
        {label}
      </span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-9 w-full items-center justify-between gap-2 rounded-[var(--radius-s)] border bg-white px-3 text-left text-sm shadow-sm outline-none transition",
              "border-[var(--color-neutral-200)] hover:border-[var(--color-brand-400)] focus:border-[var(--color-brand-400)]",
              count > 0 && "border-[var(--color-brand-400)] bg-[var(--color-brand-50)]",
            )}
          >
            <span
              className={cn(
                "truncate",
                count === 0
                  ? "text-[var(--color-text-secondary)]"
                  : "text-[var(--color-text-default)]",
              )}
            >
              {triggerLabel}
            </span>
            <span className="flex items-center gap-1">
              {count > 0 ? (
                <span
                  onClick={clear}
                  role="button"
                  aria-label="Limpiar"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]"
                >
                  <X size={12} />
                </span>
              ) : null}
              <ChevronDown
                size={14}
                className="text-[var(--color-text-secondary)]"
              />
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[220px] rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white p-0 shadow-[var(--shadow-8dp)]"
          >
            <Command className="flex flex-col">
              <div className="border-b border-[var(--color-neutral-100)] px-2 py-2">
                <CommandInput
                  placeholder={placeholder}
                  className="h-7 w-full border-0 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-secondary)]"
                />
              </div>
              <CommandList className="max-h-64 overflow-auto py-1">
                <CommandEmpty className="px-3 py-4 text-center text-xs text-[var(--color-text-secondary)]">
                  {emptyText}
                </CommandEmpty>
                <CommandGroup>
                  {options.map((option) => {
                    const isSelected = selectedSet.has(option);
                    return (
                      <CommandItem
                        key={option}
                        value={option}
                        onSelect={() => toggle(option)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                          "text-[var(--color-text-default)] aria-selected:bg-[var(--color-brand-50)]",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-sm border",
                            isSelected
                              ? "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white"
                              : "border-[var(--color-neutral-200)]",
                          )}
                        >
                          {isSelected ? <Check size={12} /> : null}
                        </span>
                        <span className="truncate">{option}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
              {count > 0 ? (
                <div className="flex items-center justify-between border-t border-[var(--color-neutral-100)] px-3 py-1.5 text-[11px]">
                  <span className="text-[var(--color-text-secondary)]">
                    {count} seleccionados
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange([])}
                    className="font-medium text-[var(--color-brand-500)] hover:underline"
                  >
                    Limpiar
                  </button>
                </div>
              ) : null}
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
