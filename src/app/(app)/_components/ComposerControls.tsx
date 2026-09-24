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
import { createPortal } from "react-dom";
import {
  MessageCircle,
  Pencil,
  Clapperboard,
  Headphones,
  Target,
  ClipboardList,
  Crown,
  ChevronDown,
  ChevronRight,
  Check,
  ShieldCheck,
  Cpu,
  Layers,
  BrainCircuit,
  Building2,
  BookOpen,
  Lightbulb,
  PhoneCall,
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
import {
  BUILTIN_KNOWLEDGE_SCOPES,
  DEFAULT_KNOWLEDGE_SCOPE,
  normalizeKnowledgeScopes,
  type KnowledgeScope,
} from "@/lib/knowledge-scopes";
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

// Standard density: "sm" triggers are 28px (toolbar above the in-thread
// composer), "md" triggers are 32px (new-chat composer card).
function triggerClass(size: Size, iconOnly: boolean, tone: Tone): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    iconOnly
      ? size === "sm"
        ? "h-7 w-7"
        : "h-8 w-8"
      : size === "sm"
        ? "h-7 gap-1.5 px-2.5 text-xs"
        : "h-8 gap-1.5 px-2.5 text-[13px]",
    tone === "accent"
      ? "border border-accent/25 bg-accent-soft text-accent-strong hover:bg-accent-soft/80"
      : tone === "private"
        ? "border border-private/25 bg-private/10 text-private"
        : iconOnly
          ? "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          : "border border-border bg-surface text-foreground hover:bg-surface-muted"
  );
}

/** Trigger icon size: 16px on a standalone 32px icon button, 14px inside chips. */
function triggerIconSize(size: Size, iconOnly: boolean): number {
  return iconOnly && size === "md" ? 16 : 14;
}

const MENU =
  "z-[45] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1 text-foreground shadow-soft-lg motion-safe:animate-fadeUp";
// Menus are laid out in columns (wide, not tall) so they always fit on screen.
const COLS3 = "columns-1 gap-1 sm:columns-2 lg:columns-3";
const COLS2 = "columns-1 gap-1 sm:columns-2";
// Two-line rows (label + hint); single-line rows add ITEM_SINGLE.
const ITEM =
  "flex w-full break-inside-avoid items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40";
const ITEM_SINGLE = "h-8 items-center py-0";
const ITEM_LABEL = "block text-[13px] font-medium leading-5";
const ITEM_HINT = "block text-xs leading-4 text-muted-foreground";
// Leading/trailing icons in two-line rows sit on the label's 20px line.
const ITEM_ICON = "mt-[3px] shrink-0";
const SECTION = "px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground";

/** Shared open/close + outside-click + focus plumbing for the pickers. */
export function useMenu() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemsRef = React.useRef<(HTMLButtonElement | null)[]>([]);
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const close = React.useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);
  return { open, setOpen, ref, triggerRef, itemsRef, menuRef, close };
}

/**
 * A picker's menu, rendered in a portal with fixed positioning so no scrolling
 * container can clip it (the new-chat screen scrolls, and a tall drop-up used to
 * disappear under the header). Opens on whichever side of the trigger has more
 * room, never wider than the viewport, and its height is capped to the space
 * available — combined with the column layouts below, menus stay fully visible.
 */
export function FloatingMenu({
  open,
  triggerRef,
  menuRef,
  width,
  align,
  label,
  role = "menu",
  onKeyDown,
  onClose,
  className,
  children,
}: {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  align: "left" | "right";
  label: string;
  /**
   * "menu" (default) for pickers of menuitems; "dialog" for a non-modal popover
   * of mostly read-only content (the container itself takes focus, so Escape
   * works even when it holds no enabled item).
   */
  role?: "menu" | "dialog";
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Close the menu; `focusTrigger` returns focus to the trigger. */
  onClose: (focusTrigger?: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null);

  React.useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const M = 8; // viewport margin
      const GAP = 6; // space between trigger and menu
      // Installed app (window-controls-overlay): the fixed, draggable
      // .app-titlebar covers the top of the viewport, so an upward menu must
      // stop below it. The strip is display:none elsewhere, so this is 0.
      const strip = document.querySelector<HTMLElement>(".app-titlebar");
      const topInset = strip ? Math.max(0, strip.getBoundingClientRect().bottom) : 0;
      const w = Math.min(width, vw - M * 2);
      const left = Math.max(M, Math.min(align === "right" ? r.right - w : r.left, vw - w - M));
      const above = r.top - GAP - M - topInset;
      const below = vh - r.bottom - GAP - M;
      setStyle(
        above >= below
          ? { position: "fixed", left, width: w, bottom: vh - r.top + GAP, maxHeight: above }
          : { position: "fixed", left, width: w, top: r.bottom + GAP, maxHeight: below }
      );
    }
    place();
    // Scrolling the page (not the menu's own list) closes the menu rather than
    // letting it trail its trigger across the header.
    function onScroll(e: Event) {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose(false);
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, width, align, triggerRef, menuRef, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      role={role}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        // The menu lives at the end of <body>; Tab must not wander off there.
        // Close + refocus the trigger, and let the browser's Tab move on from it.
        if (e.key === "Tab") {
          onClose(true);
          return;
        }
        onKeyDown?.(e);
      }}
      style={style ?? { position: "fixed", left: 0, top: 0, visibility: "hidden" }}
      className={cn(MENU, className)}
    >
      {children}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Search in (knowledge scope + optional collections)
// ---------------------------------------------------------------------------

export interface KnowledgeCollection {
  id: string;
  name: string;
}

/** The "Search in" selection: a knowledge scope, plus an optional collection narrowing. */
export interface SearchScopeValue {
  /** A lib/knowledge-scopes id ("auto", "playbook", "calls" …). */
  scope: string;
  /** Collections to narrow to (an ADDITIONAL filter; empty = no narrowing). */
  collectionIds: string[];
}

/** Icons for the scopes the Brain ships today. */
export const KNOWLEDGE_SCOPE_ICON: Readonly<Record<string, LucideIcon>> = {
  auto: Sparkles,
  all: BrainCircuit,
  reality: Building2,
  playbook: BookOpen,
  learning: Lightbulb,
  calls: PhoneCall,
};

/** The icon for a scope id. A scope the Brain adds later gets Layers. */
export function knowledgeScopeIcon(id: string): LucideIcon {
  return KNOWLEDGE_SCOPE_ICON[id] ?? Layers;
}

export interface SearchOptions {
  /** The scopes this user may pick (sensitive ones already filtered server-side), Auto first. */
  scopes: KnowledgeScope[];
  collections: KnowledgeCollection[];
}

/**
 * What the "Search in" controls can offer this user, from GET /api/collections
 * (which keeps the Brain key server-side and filters sensitive scopes per user).
 * null while loading. When the request fails, the built-in scopes are used and
 * there are no collections.
 */
export function useSearchOptions(): SearchOptions | null {
  const [options, setOptions] = React.useState<SearchOptions | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: SearchOptions = { scopes: [...BUILTIN_KNOWLEDGE_SCOPES], collections: [] };
      try {
        const res = await fetch("/api/collections", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { collections?: unknown; scopes?: unknown };
          next = {
            scopes: normalizeKnowledgeScopes(data.scopes) ?? next.scopes,
            collections: Array.isArray(data.collections)
              ? (data.collections as KnowledgeCollection[]).filter((c) => c && typeof c.id === "string" && typeof c.name === "string")
              : [],
          };
        }
      } catch {
        /* keep the built-in scopes */
      }
      if (!cancelled) setOptions(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
}

/**
 * "Search in" picker: which knowledge the answer searches. A radio group of the
 * Brain's knowledge scopes (Auto · All Brain · Reality · Playbooks · Learnings ·
 * Consultant calls · any scope the Brain adds later), then an optional
 * collapsible "Narrow to collections" checkbox list. Fetches its options itself
 * (the server keeps the key). Renders nothing until they load.
 */
export function SourceScopePicker({
  value,
  onChange,
  size = "md",
  iconOnly = false,
  align = "left",
}: { value: SearchScopeValue; onChange: (v: SearchScopeValue) => void } & TriggerStyle) {
  const options = useSearchOptions();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [collectionsOpen, setCollectionsOpen] = React.useState(false);
  const { open, setOpen, ref, triggerRef, itemsRef, menuRef, close } = useMenu();

  const scopes = options?.scopes ?? null;
  const collections = options?.collections ?? [];

  // A stored scope this user can't pick (access changed, or the Brain dropped
  // it) falls back to Auto, which is what /api/chat would do on send anyway.
  React.useEffect(() => {
    if (scopes && !scopes.some((s) => s.id === value.scope)) onChange({ ...value, scope: DEFAULT_KNOWLEDGE_SCOPE });
  }, [scopes, value, onChange]);

  // On open: the collections section starts expanded only when some are
  // selected, and focus lands on the selected scope.
  React.useEffect(() => {
    if (!open || !scopes) return;
    setCollectionsOpen(value.collectionIds.length > 0);
    const idx = Math.max(0, scopes.findIndex((s) => s.id === value.scope));
    setActiveIndex(idx);
    const t = window.setTimeout(() => itemsRef.current[idx]?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!scopes) return null;

  const current = scopes.find((s) => s.id === value.scope) ?? scopes[0];
  const CurrentIcon = knowledgeScopeIcon(current.id);
  const narrowedCount = value.collectionIds.length;
  const hasCollections = collections.length > 0;
  const toggleIndex = scopes.length; // the "Narrow to collections" row
  const rowCount = scopes.length + (hasCollections ? 1 + (collectionsOpen ? collections.length : 0) : 0);

  const narrowedLabel =
    narrowedCount === 0
      ? ""
      : narrowedCount === 1
        ? collections.find((c) => c.id === value.collectionIds[0])?.name ?? "1 collection"
        : `${narrowedCount} collections`;
  const a11yLabel = `Search in: ${current.label}${narrowedLabel ? ` (${narrowedLabel})` : ""}`;

  function focusRow(i: number) {
    setActiveIndex(i);
    itemsRef.current[i]?.focus();
  }
  function toggleCollection(id: string) {
    const ids = value.collectionIds;
    onChange({ ...value, collectionIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  }
  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusRow((activeIndex + (e.key === "ArrowDown" ? 1 : -1) + rowCount) % rowCount);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusRow(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusRow(rowCount - 1);
    }
  }

  const tone: Tone = current.id !== DEFAULT_KNOWLEDGE_SCOPE || narrowedCount > 0 ? "accent" : "neutral";

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={a11yLabel}
        title={a11yLabel}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass(size, iconOnly, tone)}
      >
        <CurrentIcon size={triggerIconSize(size, iconOnly)} className={tone === "neutral" && !iconOnly ? "shrink-0 text-accent" : "shrink-0"} aria-hidden />
        {!iconOnly && (
          <>
            <span className="max-w-[10rem] truncate">
              {current.label}
              {narrowedCount > 0 && <span className="opacity-70"> · {narrowedCount}</span>}
            </span>
            <ChevronDown size={12} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
          </>
        )}
      </button>

      <FloatingMenu
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        onClose={close}
        width={360}
        align={align}
        label="Search in"
        onKeyDown={onMenuKeyDown}
      >
        <p className={SECTION}>Search in</p>
        {scopes.map((s, i) => {
          const Icon = knowledgeScopeIcon(s.id);
          const selected = s.id === current.id;
          return (
            <button
              key={s.id}
              ref={(el) => {
                itemsRef.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              tabIndex={i === activeIndex ? 0 : -1}
              onClick={() => {
                onChange({ ...value, scope: s.id });
                close();
              }}
              className={cn(ITEM, selected ? "bg-accent-soft" : "hover:bg-surface-muted")}
            >
              <Icon
                size={14}
                className={cn(ITEM_ICON, selected || s.id === DEFAULT_KNOWLEDGE_SCOPE ? "text-accent" : "text-muted-foreground")}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium leading-5">
                  {s.label}
                  {s.sensitive && <ShieldCheck size={12} className="shrink-0 text-accent" aria-label="Sensitive data" />}
                </span>
                {s.description && <span className={ITEM_HINT}>{s.description}</span>}
              </span>
              {selected && <Check size={14} className={cn(ITEM_ICON, "text-accent")} aria-hidden />}
            </button>
          );
        })}

        {hasCollections && (
          <>
            <div className="mx-1 my-1 border-t border-border" />
            <button
              ref={(el) => {
                itemsRef.current[toggleIndex] = el;
              }}
              type="button"
              role="menuitem"
              aria-expanded={collectionsOpen}
              tabIndex={activeIndex === toggleIndex ? 0 : -1}
              onClick={() => setCollectionsOpen((o) => !o)}
              className={cn(ITEM, ITEM_SINGLE, "hover:bg-surface-muted")}
            >
              <ChevronRight
                size={14}
                className={cn("shrink-0 text-muted-foreground transition-transform", collectionsOpen && "rotate-90")}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Narrow to collections (optional)</span>
              {narrowedCount > 0 && <span className="shrink-0 text-xs text-muted-foreground">{narrowedCount} selected</span>}
            </button>
            {collectionsOpen &&
              collections.map((c, i) => {
                const idx = toggleIndex + 1 + i;
                const checked = value.collectionIds.includes(c.id);
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
                    onClick={() => toggleCollection(c.id)}
                    className={cn(ITEM, ITEM_SINGLE, "pl-8", checked ? "bg-accent-soft" : "hover:bg-surface-muted")}
                  >
                    <span
                      className={cn(
                        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border",
                        checked ? "border-accent bg-accent text-accent-foreground" : "border-border"
                      )}
                      aria-hidden
                    >
                      {checked && <Check size={10} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
                  </button>
                );
              })}
          </>
        )}
      </FloatingMenu>
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
  const { open, setOpen, ref, triggerRef, itemsRef, menuRef, close } = useMenu();
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
        <Cpu size={triggerIconSize(size, iconOnly)} className={iconOnly ? "shrink-0" : "shrink-0 text-accent"} aria-hidden />
        {!iconOnly && (
          <>
            <span className="max-w-[9rem] truncate">{value.label}</span>
            <ChevronDown size={12} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
          </>
        )}
      </button>

      <FloatingMenu
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        onClose={close}
        width={720}
        align={align}
        label="Model quality"
        onKeyDown={onMenuKeyDown}
      >
        <div className={COLS3}>
          {options.map((o, i) => {
            const isFirst = lastKind !== o.kind;
            lastKind = o.kind;
            const selected = o.value === value.value;
            const item = (
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
                    <span className={ITEM_LABEL}>{o.label}</span>
                    {(o.hint || o.reason) && (
                      <span className={ITEM_HINT}>{o.available ? o.hint : o.reason ?? "Unavailable"}</span>
                    )}
                  </span>
                  {selected && <Check size={14} className={cn(ITEM_ICON, "text-accent")} aria-hidden />}
                </button>
            );
            // Keep each section heading with its first row when columns break.
            return isFirst ? (
              <div key={o.value} className="break-inside-avoid">
                <p className={SECTION}>{o.kind === "tier" ? "Quality" : "Specific models"}</p>
                {item}
              </div>
            ) : (
              <React.Fragment key={o.value}>{item}</React.Fragment>
            );
          })}
        </div>
      </FloatingMenu>
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
  const { open, setOpen, ref, triggerRef, itemsRef, menuRef, close } = useMenu();
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
        <LayoutList size={triggerIconSize(size, iconOnly)} className="shrink-0" aria-hidden />
        {!iconOnly && (
          <>
            <span className="whitespace-nowrap">{custom ? current.label : "Format"}</span>
            <ChevronDown size={12} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
          </>
        )}
      </button>
      <FloatingMenu
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        onClose={close}
        width={460}
        align={align}
        label="Response format"
        onKeyDown={onMenuKeyDown}
      >
          <p className={SECTION}>Response format</p>
          <div className={COLS2}>
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
                  <span className={ITEM_LABEL}>{o.label}</span>
                  <span className={ITEM_HINT}>{o.hint}</span>
                </span>
                {selected && <Check size={14} className={cn(ITEM_ICON, "text-accent")} aria-hidden />}
              </button>
            );
          })}
          </div>
      </FloatingMenu>
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
      <Atom size={14} className={on ? "shrink-0" : "shrink-0 text-accent"} aria-hidden />
      <span className="whitespace-nowrap">Deep research</span>
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
  const { open, setOpen, ref, triggerRef, itemsRef, menuRef, close } = useMenu();
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
        <CurrentIcon size={triggerIconSize(size, iconOnly)} className={tone === "neutral" ? "shrink-0 text-accent" : "shrink-0"} aria-hidden />
        {!iconOnly && (
          <>
            <span className="max-w-[10rem] truncate">{current?.label ?? "Mode"}</span>
            <ChevronDown size={12} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
          </>
        )}
      </button>

      <FloatingMenu
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        onClose={close}
        width={780}
        align={align}
        label="Work mode"
        onKeyDown={onMenuKeyDown}
      >
        <div className={COLS3}>
          {ordered.map((m, i) => {
            const Icon = MODE_ICON[m.id];
            const selected = m.id === value;
            const isFirst = lastGroup !== m.group;
            lastGroup = m.group;
            const item = (
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
                    size={14}
                    className={cn(ITEM_ICON, selected || m.id === "auto" ? "text-accent" : "text-muted-foreground")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium leading-5">
                      {m.label}
                      {m.restricted && <ShieldCheck size={12} className="shrink-0 text-accent" aria-label="Restricted" />}
                    </span>
                    <span className={ITEM_HINT}>{m.hint}</span>
                  </span>
                  {selected && <Check size={14} className={cn(ITEM_ICON, "text-accent")} aria-hidden />}
                </button>
            );
            // Keep each group heading with its first row when columns break.
            return isFirst ? (
              <div key={m.id} className="break-inside-avoid">
                <p className={SECTION}>{m.group === "general" ? "Work mode" : MODE_GROUP_LABELS[m.group]}</p>
                {item}
              </div>
            ) : (
              <React.Fragment key={m.id}>{item}</React.Fragment>
            );
          })}
        </div>
      </FloatingMenu>
    </div>
  );
}
