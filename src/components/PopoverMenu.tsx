"use client";

// A small light action menu rendered in a portal with fixed positioning, so a
// scrolling container (the chat thread) never clips it. Opens below the trigger,
// or above when there's no room. Click-outside / Escape / scroll / resize close
// it; arrow keys move between items.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PopoverMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Visual "done/active" state (e.g. already submitted). */
  active?: boolean;
  danger?: boolean;
}

export function PopoverMenu({
  label,
  trigger,
  items,
  triggerClassName,
  width = 220,
}: {
  label: string;
  trigger: React.ReactNode;
  items: PopoverMenuItem[];
  triggerClassName?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Estimated menu height: 32px rows + p-1 padding + border.
    const height = items.length * 32 + 10;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, r.left));
    const below = r.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below;
    setPos({ top, left });
  }, [items.length, width]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => itemRefs.current.find((b) => b && !b.disabled)?.focus({ preventScroll: true }), 0);
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = itemRefs.current.filter((b): b is HTMLButtonElement => !!b && !b.disabled);
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-surface-muted text-foreground",
          triggerClassName
        )}
      >
        {trigger}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{ top: pos.top, left: pos.left, width }}
            className="fixed z-[60] rounded-xl border border-border bg-surface p-1 text-foreground shadow-soft-lg motion-safe:animate-fadeUp"
          >
            {items.map((it, i) => (
              <button
                key={it.label}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                  it.danger && "text-danger",
                  it.active && "text-accent-strong"
                )}
              >
                <it.icon size={14} className={cn("shrink-0", it.active ? "text-accent" : "text-muted-foreground")} aria-hidden />
                <span className="min-w-0 truncate">{it.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
