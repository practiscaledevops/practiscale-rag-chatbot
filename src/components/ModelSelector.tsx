"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Sparkles, Zap } from "lucide-react";
import type { ModelOption } from "@/components/AppShell";
import { cn } from "@/lib/utils";

export interface ModelSelectorProps {
  selection: ModelOption;
  options: ModelOption[];
  onSelect: (option: ModelOption) => void;
  className?: string;
}

// Provider → group heading. Presets sit first; unknown providers title-case.
const GROUP_LABELS: Record<string, string> = {
  preset: "Speed & quality",
  anthropic: "Claude",
  openai: "GPT",
};

function groupLabel(provider: string): string {
  return (
    GROUP_LABELS[provider] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

// Stable group order: presets, then Claude, then GPT, then the rest.
const GROUP_ORDER = ["preset", "anthropic", "openai"];

/**
 * Model switcher: a dropdown grouped by provider (Speed & quality presets, then
 * the Claude and GPT families from the Brain catalog). Models the user isn't
 * permitted to use are filtered out upstream; models the Brain reports as
 * unavailable render disabled with a subtle reason and can't be picked.
 */
export function ModelSelector({
  selection,
  options,
  onSelect,
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Group options by provider, in a stable order.
  const groups = useMemo(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const opt of options) {
      const list = byProvider.get(opt.provider) ?? [];
      list.push(opt);
      byProvider.set(opt.provider, list);
    }
    const keys = [...byProvider.keys()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return keys.map((provider) => ({
      provider,
      label: groupLabel(provider),
      items: byProvider.get(provider)!,
    }));
  }, [options]);

  const isSelected = (o: ModelOption) =>
    o.value === selection.value && o.kind === selection.kind;

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground shadow-soft transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {selection.kind === "tier" ? (
          <Zap size={14} className="text-accent" aria-hidden />
        ) : (
          <Sparkles size={14} className="text-accent" aria-hidden />
        )}
        <span className="max-w-[10rem] truncate">{selection.label}</span>
        <ChevronDown size={14} className="text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Model"
          className="absolute right-0 z-30 mt-1.5 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg"
        >
          {groups.map((group) => (
            <div key={group.provider} className="py-1">
              <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((opt) => {
                const selected = isSelected(opt);
                const disabled = !opt.available;
                return (
                  <button
                    key={`${opt.kind}-${opt.value}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={disabled}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      onSelect(opt);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      disabled
                        ? "cursor-not-allowed opacity-55"
                        : "hover:bg-surface-muted",
                      selected && "bg-accent/10"
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span
                        className={cn(
                          "truncate font-medium",
                          selected && "text-accent"
                        )}
                      >
                        {opt.label}
                      </span>
                      {(opt.hint || disabled) && (
                        <span className="truncate text-xs text-muted-foreground">
                          {disabled ? opt.reason || "Unavailable" : opt.hint}
                        </span>
                      )}
                    </span>
                    {disabled ? (
                      <span className="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Unavailable
                      </span>
                    ) : (
                      selected && (
                        <Check size={15} className="shrink-0 text-accent" aria-hidden />
                      )
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
