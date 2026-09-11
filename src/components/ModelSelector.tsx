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
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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

  // Flat, render-order list for keyboard navigation (skips disabled on move).
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const isSelected = (o: ModelOption) =>
    o.value === selection.value && o.kind === selection.kind;

  const optionId = (i: number) => `model-opt-${i}`;

  const commit = (opt: ModelOption) => {
    if (!opt.available) return;
    onSelect(opt);
    setOpen(false);
  };

  // Move the active highlight to the next/prev enabled option.
  const move = (dir: 1 | -1) => {
    if (flat.length === 0) return;
    let i = activeIndex;
    for (let step = 0; step < flat.length; step++) {
      i = (i + dir + flat.length) % flat.length;
      if (flat[i]?.available) {
        setActiveIndex(i);
        return;
      }
    }
  };

  // Open the menu and highlight the current selection (or the first enabled).
  const openMenu = () => {
    const sel = flat.findIndex((o) => isSelected(o) && o.available);
    const first = flat.findIndex((o) => o.available);
    setActiveIndex(sel >= 0 ? sel : first);
    setOpen(true);
    requestAnimationFrame(() => listRef.current?.focus());
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(flat.findIndex((o) => o.available));
        break;
      case "End":
        e.preventDefault();
        for (let i = flat.length - 1; i >= 0; i--) {
          if (flat[i]?.available) { setActiveIndex(i); break; }
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (flat[activeIndex]) commit(flat[activeIndex]);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = document.getElementById(optionId(activeIndex));
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
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
          ref={listRef}
          role="listbox"
          aria-label="Model"
          tabIndex={-1}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          onKeyDown={onListKeyDown}
          className="absolute right-0 z-30 mt-1.5 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg focus:outline-none"
        >
          {groups.map((group) => (
            <div key={group.provider} className="py-1">
              <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((opt) => {
                const flatIndex = flat.indexOf(opt);
                const selected = isSelected(opt);
                const active = flatIndex === activeIndex;
                const disabled = !opt.available;
                return (
                  <div
                    key={`${opt.kind}-${opt.value}`}
                    id={optionId(flatIndex)}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={disabled}
                    onClick={() => commit(opt)}
                    onMouseMove={() => !disabled && setActiveIndex(flatIndex)}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      disabled && "cursor-not-allowed opacity-55",
                      active && !disabled && "bg-surface-muted",
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
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
