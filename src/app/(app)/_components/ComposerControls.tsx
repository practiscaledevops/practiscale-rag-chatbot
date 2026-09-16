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
  Zap,
  Database,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkMode, WorkModeDef } from "@/lib/work-modes";
import type { ModelOption } from "@/components/AppShell";

export const MODE_ICON: Record<WorkMode, LucideIcon> = {
  general: MessageCircle,
  copywriter: Pencil,
  media: Clapperboard,
  sales: Headphones,
  strategy: Target,
  decision_maker: ClipboardList,
  ceo: Crown,
};

interface Collection {
  id: string;
  name: string;
}

/**
 * Source-scope picker — narrow the answer to specific collections instead of all
 * company knowledge. Fetches the permitted collections itself (server keeps the
 * key). Multi-select; empty selection = all company knowledge. Renders nothing
 * when there are no collections to narrow to. Accessible: arrow keys move, Space/
 * Enter toggles, Escape closes, click-outside closes.
 */
export function SourceScopePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [collections, setCollections] = React.useState<Collection[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemsRef = React.useRef<(HTMLButtonElement | null)[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/collections", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { collections?: Collection[] };
          setCollections(data.collections ?? []);
        } else if (!cancelled) {
          setCollections([]);
        }
      } catch {
        if (!cancelled) setCollections([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => itemsRef.current[activeIndex]?.focus(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Nothing to narrow to → don't clutter the composer.
  if (!collections || collections.length === 0) return null;

  // rows: index 0 = "Company knowledge" (all), then each collection.
  const rowCount = collections.length + 1;
  const selectedNames = collections.filter((c) => value.includes(c.id)).map((c) => c.name);
  const label =
    value.length === 0
      ? "Company knowledge"
      : value.length === 1
        ? selectedNames[0] ?? "1 collection"
        : `${value.length} collections`;

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function move(dir: 1 | -1) {
    const next = (activeIndex + dir + rowCount) % rowCount;
    setActiveIndex(next);
    itemsRef.current[next]?.focus();
  }

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    }
  }

  const narrowed = value.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-[background-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          narrowed ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-surface text-foreground hover:bg-surface-muted"
        )}
        title="Choose which knowledge to search"
      >
        <Database size={15} aria-hidden />
        <span className="max-w-[10rem] truncate">{label}</span>
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Source scope"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-0 z-40 mb-2 max-h-[min(70vh,26rem)] w-72 origin-bottom overflow-y-auto rounded-xl border border-white/10 bg-surface-muted p-1 shadow-[0_16px_40px_-8px_rgb(0_0_0/0.55)] ring-1 ring-white/10 motion-safe:animate-fadeUp"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Search in
          </p>
          <button
            ref={(el) => {
              itemsRef.current[0] = el;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={value.length === 0}
            tabIndex={activeIndex === 0 ? 0 : -1}
            onClick={() => onChange([])}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value.length === 0 ? "bg-accent/10" : "hover:bg-white/[0.06]"
            )}
          >
            <Database size={15} className={cn("shrink-0", value.length === 0 ? "text-accent" : "text-muted-foreground")} aria-hidden />
            <span className="flex-1 text-sm font-medium text-foreground">All company knowledge</span>
            {value.length === 0 && <Check size={15} className="shrink-0 text-accent" aria-hidden />}
          </button>

          <div className="my-1 border-t border-border" />

          {collections.map((c, i) => {
            const idx = i + 1;
            const checked = value.includes(c.id);
            return (
              <button
                key={c.id}
                ref={(el) => {
                  itemsRef.current[idx] = el;
                }}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                tabIndex={activeIndex === idx ? 0 : -1}
                onClick={() => toggle(c.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  checked ? "bg-accent/10" : "hover:bg-white/[0.06]"
                )}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", checked ? "border-accent bg-accent text-accent-foreground" : "border-border")} aria-hidden>
                  {checked && <Check size={12} />}
                </span>
                <Layers size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate text-sm text-foreground">{c.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Model-quality picker for the composer — the friendly tiers (Smart Route / Fast
 * / Balanced / Best quality / Deep analysis) plus any specific models the user is
 * permitted to pick. Accessible menu: arrow keys move over enabled options,
 * Enter/Space selects, Escape closes and restores focus, click-outside closes.
 */
export function ModelQualityPicker({
  options,
  value,
  onChange,
}: {
  options: ModelOption[];
  value: ModelOption;
  onChange: (o: ModelOption) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemsRef = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Indices of enabled options (unavailable models are skipped by keyboard nav).
  const enabled = options.map((o, i) => (o.available ? i : -1)).filter((i) => i >= 0);
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    const cur = options.findIndex((o) => o.value === value.value);
    const idx = enabled.includes(cur) ? cur : enabled[0] ?? 0;
    setActiveIndex(idx);
    const t = window.setTimeout(() => itemsRef.current[idx]?.focus(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  function move(dir: 1 | -1) {
    const pos = enabled.indexOf(activeIndex);
    const next = enabled[(pos + dir + enabled.length) % enabled.length];
    setActiveIndex(next);
    itemsRef.current[next]?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    }
  }

  let lastKind: string | null = null;

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-foreground transition-[background-color,transform] duration-150 active:scale-[0.98] hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Zap size={15} className="text-accent" aria-hidden />
        <span>{value.label}</span>
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Model quality"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-0 z-40 mb-2 max-h-[min(70vh,26rem)] w-72 origin-bottom overflow-y-auto rounded-xl border border-white/10 bg-surface-muted p-1 shadow-[0_16px_40px_-8px_rgb(0_0_0/0.55)] ring-1 ring-white/10 motion-safe:animate-fadeUp"
        >
          {options.map((o, i) => {
            const header =
              lastKind !== o.kind ? (
                <p key={`h-${o.kind}`} className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {o.kind === "tier" ? "Quality" : "Specific models"}
                </p>
              ) : null;
            lastKind = o.kind;
            const selected = o.value === value.value;
            return (
              <React.Fragment key={o.value}>
                {header}
                <button
                  ref={(el) => {
                    itemsRef.current[i] = el;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={!o.available}
                  tabIndex={i === activeIndex ? 0 : -1}
                  onClick={() => {
                    onChange(o);
                    close();
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                    selected ? "bg-accent/10" : "hover:bg-white/[0.06]"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{o.label}</span>
                    {(o.hint || o.reason) && (
                      <span className="block text-xs text-muted-foreground">{o.available ? o.hint : o.reason ?? "Unavailable"}</span>
                    )}
                  </span>
                  {selected && <Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
          className="absolute bottom-full left-0 z-40 mb-2 max-h-[min(70vh,26rem)] w-72 origin-bottom overflow-y-auto rounded-xl border border-white/10 bg-surface-muted p-1 shadow-[0_16px_40px_-8px_rgb(0_0_0/0.55)] ring-1 ring-white/10 motion-safe:animate-fadeUp"
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
                  selected ? "bg-accent/10" : "hover:bg-white/[0.06]"
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
