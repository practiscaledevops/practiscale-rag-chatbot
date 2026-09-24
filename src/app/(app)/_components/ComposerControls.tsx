"use client";

// Composer controls — the message settings that belong WITH the next message:
// work mode, model quality, response format, knowledge scope, deep research.
// Each picker is an accessible menu (arrow keys move, Enter/Space selects,
// Escape closes and returns focus to the trigger, click-outside closes).
// Selecting changes ONLY future messages; it never rewrites past turns.
//
// Triggers come in two shapes: a labeled pill ("chip") and an icon-only round
// button ("icon"), in two sizes, so the same pickers fit both the new-chat
// composer card and the compact toolbar above the in-thread composer.

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
  Cpu,
  Database,
  Layers,
  Sparkles,
  Megaphone,
  Package,
  HeartHandshake,
  Users,
  UserPlus,
  Settings2,
  Mic,
  Send,
  GraduationCap,
  ListChecks,
  BarChart3,
  LayoutList,
  Atom,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MODE_GROUP_LABELS, EXECUTIVE_MODES, type WorkMode, type WorkModeDef, type ModeGroup } from "@/lib/work-modes";
import { OUTPUT_TYPES, type OutputType } from "@/lib/output-types";
import type { ModelOption } from "@/components/AppShell";

export const MODE_ICON: Record<WorkMode, LucideIcon> = {
  auto: Sparkles,
  general: MessageCircle,
  ceo_advisor: Crown,
  strategy_advisor: Target,
  sales_coach: Headphones,
  marketing_advisor: Megaphone,
  offer_architect: Package,
  cs_advisor: HeartHandshake,
  management_coach: Users,
  hiring_advisor: UserPlus,
  operations_advisor: Settings2,
  content_strategist: Clapperboard,
  copywriter: Pencil,
  ceo_content: Mic,
  distribution_strategist: Send,
  training_builder: GraduationCap,
  sop_builder: ListChecks,
  decision_memo: ClipboardList,
  research_analyst: BarChart3,
};

const GROUP_ORDER: ModeGroup[] = ["general", "business", "content", "build", "analysis"];

type Size = "sm" | "md";
type Tone = "neutral" | "accent" | "private";

interface TriggerStyle {
  size?: Size;
  /** Icon-only round trigger (label moves to aria-label + title). */
  iconOnly?: boolean;
  /** Which edge the menu aligns to (use "right" for triggers near the right edge). */
  align?: "left" | "right";
}

function triggerClass(size: Size, iconOnly: boolean, tone: Tone): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    iconOnly
      ? size === "sm"
        ? "h-8 w-8"
        : "h-9 w-9"
      : size === "sm"
        ? "h-8 gap-1.5 px-2.5 text-xs"
        : "h-9 gap-1.5 px-3 text-[13px]",
    tone === "accent"
      ? "border border-accent/25 bg-accent-soft text-accent-strong hover:bg-accent-soft/80"
      : tone === "private"
        ? "border border-private/25 bg-private/10 text-private"
        : iconOnly
          ? "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          : "border border-border bg-surface text-foreground hover:bg-surface-muted"
  );
}

const MENU =
  "absolute bottom-full z-40 mb-2 overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 text-foreground shadow-soft-lg motion-safe:animate-fadeUp";
const ITEM =
  "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40";
const SECTION = "px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground";

/** Shared open/close + outside-click + focus plumbing for the pickers. */
function useMenu() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemsRef = React.useRef<(HTMLButtonElement | null)[]>([]);
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const close = React.useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);
  return { open, setOpen, ref, triggerRef, itemsRef, close };
}

// ---------------------------------------------------------------------------
// Source scope
// ---------------------------------------------------------------------------

interface Collection {
  id: string;
  name: string;
}

/**
 * Source-scope picker — narrow the answer to specific collections instead of all
 * company knowledge. Fetches the permitted collections itself (server keeps the
 * key). Multi-select; empty selection = all company knowledge. Renders nothing
 * when there are no collections to narrow to.
 */
export function SourceScopePicker({
  value,
  onChange,
  size = "md",
  iconOnly = false,
  align = "left",
}: { value: string[]; onChange: (ids: string[]) => void } & TriggerStyle) {
  const [collections, setCollections] = React.useState<Collection[] | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const { open, setOpen, ref, triggerRef, itemsRef, close } = useMenu();

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
    const t = window.setTimeout(() => itemsRef.current[activeIndex]?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!collections || collections.length === 0) return null;

  const rowCount = collections.length + 1;
  const selectedNames = collections.filter((c) => value.includes(c.id)).map((c) => c.name);
  const label =
    value.length === 0
      ? "Company knowledge"
      : value.length === 1
        ? selectedNames[0] ?? "1 collection"
        : `${value.length} collections`;

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
        aria-label={iconOnly ? `Knowledge: ${label}` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass(size, iconOnly, narrowed ? "accent" : "neutral")}
        title="Choose which knowledge to search"
      >
        <Database size={size === "sm" ? 14 : 16} aria-hidden />
        {!iconOnly && (
          <>
            <span className="max-w-[9rem] truncate">{label}</span>
            <ChevronDown size={13} className={cn("opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Source scope"
          onKeyDown={onMenuKeyDown}
          className={cn(MENU, "max-h-[min(70vh,26rem)] w-72", align === "right" ? "right-0" : "left-0")}
        >
          <p className={SECTION}>Search in</p>
          <button
            ref={(el) => {
              itemsRef.current[0] = el;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={value.length === 0}
            tabIndex={activeIndex === 0 ? 0 : -1}
            onClick={() => onChange([])}
            className={cn(ITEM, "items-center", value.length === 0 ? "bg-accent-soft" : "hover:bg-surface-muted")}
          >
            <Database size={15} className={cn("shrink-0", value.length === 0 ? "text-accent" : "text-muted-foreground")} aria-hidden />
            <span className="flex-1 text-sm font-medium">All company knowledge</span>
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
                className={cn(ITEM, "items-center", checked ? "bg-accent-soft" : "hover:bg-surface-muted")}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border",
                    checked ? "border-accent bg-accent text-accent-foreground" : "border-border"
                  )}
                  aria-hidden
                >
                  {checked && <Check size={12} />}
                </span>
                <Layers size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate text-sm">{c.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model quality
// ---------------------------------------------------------------------------

/**
 * Model-quality picker — the friendly tiers (Smart Route / Fast / Balanced /
 * Best quality / Deep analysis) plus any specific models the user may pick.
 */
export function ModelQualityPicker({
  options,
  value,
  onChange,
  size = "md",
  iconOnly = false,
  align = "left",
}: { options: ModelOption[]; value: ModelOption; onChange: (o: ModelOption) => void } & TriggerStyle) {
  const { open, setOpen, ref, triggerRef, itemsRef, close } = useMenu();
  const enabled = options.map((o, i) => (o.available ? i : -1)).filter((i) => i >= 0);
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    const cur = options.findIndex((o) => o.value === value.value);
    const idx = enabled.includes(cur) ? cur : enabled[0] ?? 0;
    setActiveIndex(idx);
    const t = window.setTimeout(() => itemsRef.current[idx]?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
        aria-label={iconOnly ? `Model: ${value.label}` : undefined}
        title={iconOnly ? `Model: ${value.label}` : "Model quality"}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass(size, iconOnly, "neutral")}
      >
        <Cpu size={size === "sm" ? 14 : 16} className={iconOnly ? undefined : "text-accent"} aria-hidden />
        {!iconOnly && (
          <>
            <span className="max-w-[9rem] truncate">{value.label}</span>
            <ChevronDown size={13} className={cn("opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Model quality"
          onKeyDown={onMenuKeyDown}
          className={cn(MENU, "max-h-[min(70vh,26rem)] w-72", align === "right" ? "right-0" : "left-0")}
        >
          {options.map((o, i) => {
            const header =
              lastKind !== o.kind ? (
                <p key={`h-${o.kind}`} className={SECTION}>
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
                  className={cn(ITEM, selected ? "bg-accent-soft" : "hover:bg-surface-muted")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{o.label}</span>
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

// ---------------------------------------------------------------------------
// Response format
// ---------------------------------------------------------------------------

/** Response-format picker (Answer / Table / Chart / Summary / …), sent as `outputType`. */
export function OutputFormatPicker({
  value,
  onChange,
  size = "md",
  iconOnly = false,
  align = "left",
}: { value: OutputType; onChange: (o: OutputType) => void } & TriggerStyle) {
  const { open, setOpen, ref, triggerRef, itemsRef, close } = useMenu();
  const current = OUTPUT_TYPES.find((o) => o.id === value) ?? OUTPUT_TYPES[0];
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, OUTPUT_TYPES.findIndex((o) => o.id === value));
    setActiveIndex(idx);
    const t = window.setTimeout(() => itemsRef.current[idx]?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
  }, [open, value, itemsRef]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (activeIndex + dir + OUTPUT_TYPES.length) % OUTPUT_TYPES.length;
      setActiveIndex(next);
      itemsRef.current[next]?.focus();
    }
  }

  const custom = value !== "answer";

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly ? `Response format: ${current.label}` : undefined}
        title="Response format"
        onClick={() => setOpen((o) => !o)}
        className={triggerClass(size, iconOnly, custom ? "accent" : "neutral")}
      >
        <LayoutList size={size === "sm" ? 14 : 16} aria-hidden />
        {!iconOnly && (
          <>
            <span>{custom ? current.label : "Format"}</span>
            <ChevronDown size={13} className={cn("opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Response format"
          onKeyDown={onMenuKeyDown}
          className={cn(MENU, "max-h-[min(70vh,26rem)] w-64", align === "right" ? "right-0" : "left-0")}
        >
          <p className={SECTION}>Response format</p>
          {OUTPUT_TYPES.map((o, i) => {
            const selected = o.id === value;
            return (
              <button
                key={o.id}
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={i === activeIndex ? 0 : -1}
                onClick={() => {
                  onChange(o.id);
                  close();
                }}
                className={cn(ITEM, selected ? "bg-accent-soft" : "hover:bg-surface-muted")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
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

// ---------------------------------------------------------------------------
// Deep research toggle
// ---------------------------------------------------------------------------

/** "Deep research" chip — toggles the Deep analysis preset for the next message. */
export function DeepResearchToggle({
  on,
  onToggle,
  size = "md",
}: {
  on: boolean;
  onToggle: () => void;
  size?: Size;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      title="Thorough, structured, multi-angle analysis on the strongest model"
      className={triggerClass(size, false, on ? "accent" : "neutral")}
    >
      <Atom size={size === "sm" ? 14 : 16} className={on ? undefined : "text-accent"} aria-hidden />
      Deep research
    </button>
  );
}

// ---------------------------------------------------------------------------
// Work mode
// ---------------------------------------------------------------------------

export function WorkModePicker({
  modes,
  value,
  onChange,
  size = "md",
  iconOnly = false,
  align = "left",
}: { modes: WorkModeDef[]; value: WorkMode; onChange: (m: WorkMode) => void } & TriggerStyle) {
  const { open, setOpen, ref, triggerRef, itemsRef, close } = useMenu();
  const [activeIndex, setActiveIndex] = React.useState(0);

  const current = modes.find((m) => m.id === value) ?? modes[0];
  const CurrentIcon = current ? MODE_ICON[current.id] : MessageCircle;
  const isExec = EXECUTIVE_MODES.includes(value);
  const ordered = React.useMemo(() => GROUP_ORDER.flatMap((g) => modes.filter((m) => m.group === g)), [modes]);

  React.useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, ordered.findIndex((m) => m.id === value));
    setActiveIndex(idx);
    const t = window.setTimeout(() => itemsRef.current[idx]?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
  }, [open, ordered, value, itemsRef]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (activeIndex + dir + ordered.length) % ordered.length;
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
      const last = ordered.length - 1;
      setActiveIndex(last);
      itemsRef.current[last]?.focus();
    }
  }

  let lastGroup: ModeGroup | null = null;
  const tone: Tone = isExec ? "private" : value === "general" || value === "auto" ? "neutral" : "accent";

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly ? `Work mode: ${current?.label ?? "Mode"}` : undefined}
        onClick={() => setOpen((o) => !o)}
        title="Which expert answers. Auto picks per message."
        className={triggerClass(size, iconOnly, tone)}
      >
        <CurrentIcon size={size === "sm" ? 14 : 16} className={tone === "neutral" ? "text-accent" : undefined} aria-hidden />
        {!iconOnly && (
          <>
            <span className="max-w-[10rem] truncate">{current?.label ?? "Mode"}</span>
            <ChevronDown size={13} className={cn("opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Work mode"
          onKeyDown={onMenuKeyDown}
          className={cn(MENU, "max-h-[min(70vh,30rem)] w-80", align === "right" ? "right-0" : "left-0")}
        >
          {ordered.map((m, i) => {
            const Icon = MODE_ICON[m.id];
            const selected = m.id === value;
            const header =
              lastGroup !== m.group ? (
                <p key={`g-${m.group}`} className={SECTION}>
                  {m.group === "general" ? "Work mode" : MODE_GROUP_LABELS[m.group]}
                </p>
              ) : null;
            lastGroup = m.group;
            return (
              <React.Fragment key={m.id}>
                {header}
                <button
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
                  className={cn(ITEM, selected ? "bg-accent-soft" : "hover:bg-surface-muted")}
                >
                  <Icon
                    size={16}
                    className={cn("mt-0.5 shrink-0", selected || m.id === "auto" ? "text-accent" : "text-muted-foreground")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {m.label}
                      {m.restricted && <ShieldCheck size={11} className="text-accent" aria-label="Restricted" />}
                    </span>
                    <span className="block text-xs text-muted-foreground">{m.hint}</span>
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
