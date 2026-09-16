"use client";

// Composer controls — the message settings that belong WITH the next message,
// not in the sidebar. The work-mode picker is an accessible exclusive-choice
// menu (role=menu with menuitemradio items): arrow keys move, Enter/Space
// selects, Escape closes and returns focus to the trigger, click-outside closes.
// Selecting a mode changes ONLY future messages (the parent sends the current
// mode with each send); it never rewrites past turns.

import * as React from "react";
import {
  MessageCircle,
  Pencil,
  Clapperboard,
  Headphones,
  Target,
  ClipboardList,
  Crown,
  ChevronDown,
  Check,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkMode, WorkModeDef } from "@/lib/work-modes";

export const MODE_ICON: Record<WorkMode, LucideIcon> = {
  general: MessageCircle,
  copywriter: Pencil,
  media: Clapperboard,
  sales: Headphones,
  strategy: Target,
  decision_maker: ClipboardList,
  ceo: Crown,
};

export function WorkModePicker({
  modes,
  value,
  onChange,
}: {
  modes: WorkModeDef[];
  value: WorkMode;
  onChange: (m: WorkMode) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemsRef = React.useRef<(HTMLButtonElement | null)[]>([]);

  const current = modes.find((m) => m.id === value) ?? modes[0];
  const CurrentIcon = current ? MODE_ICON[current.id] : MessageCircle;

  // Open at the current selection and focus it.
  React.useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, modes.findIndex((m) => m.id === value));
    setActiveIndex(idx);
    const t = window.setTimeout(() => itemsRef.current[idx]?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, modes, value]);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (activeIndex + dir + modes.length) % modes.length;
      setActiveIndex(next);
      itemsRef.current[next]?.focus();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
      itemsRef.current[0]?.focus();
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      const last = modes.length - 1;
      setActiveIndex(last);
      itemsRef.current[last]?.focus();
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value === "ceo"
            ? "border-private/40 bg-private/10 text-private"
            : value === "general"
              ? "border-border bg-surface text-foreground hover:bg-surface-muted"
              : "border-accent/40 bg-accent/10 text-accent"
        )}
      >
        <CurrentIcon size={15} aria-hidden />
        <span>{current?.label ?? "Mode"}</span>
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Work mode"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-0 z-40 mb-2 w-72 origin-bottom overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft-lg motion-safe:animate-fadeUp"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Work mode
          </p>
          {modes.map((m, i) => {
            const Icon = MODE_ICON[m.id];
            const selected = m.id === value;
            return (
              <button
                key={m.id}
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={i === activeIndex ? 0 : -1}
                onClick={() => {
                  onChange(m.id);
                  close();
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "bg-accent/10" : "hover:bg-surface-muted"
                )}
              >
                <Icon size={16} className={cn("mt-0.5 shrink-0", selected ? "text-accent" : "text-muted-foreground")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {m.label}
                    {m.restricted && <ShieldCheck size={11} className="text-info/80" aria-label="Restricted" />}
                  </span>
                  <span className="block text-xs text-muted-foreground">{m.hint}</span>
                </span>
                {selected && <Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
