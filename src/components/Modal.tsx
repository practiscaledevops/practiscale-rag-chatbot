"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/IconButton";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Where focus goes on close when the element that opened the dialog is gone
   * by then (e.g. the row or selection bar a delete removed). Without it focus
   * would fall to <body>.
   */
  returnFocus?: () => HTMLElement | null | undefined;
}

/** Focusable, ENABLED controls (a disabled field can't take focus). */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Small accessible modal dialog: a labelled `role="dialog"` panel over a
 * dimmed backdrop. Closes on Escape or backdrop click, moves focus into the
 * panel on open, keeps Tab focus inside it, and restores focus to the trigger
 * (or `returnFocus` when the trigger is gone) on close.
 */
export function Modal({ open, onClose, title, children, className, returnFocus }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Keep the latest onClose in a ref so the focus/keydown effect below does NOT
  // depend on its identity. Callers routinely pass an inline arrow (a new
  // function every render); if the effect depended on onClose, every parent
  // re-render — including each keystroke in a field inside the modal — would
  // re-run the effect and yank focus back to the first focusable element,
  // making the inputs impossible to type in.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const returnFocusRef = useRef(returnFocus);
  useEffect(() => {
    returnFocusRef.current = returnFocus;
  }, [returnFocus]);

  useEffect(() => {
    if (!open) return;

    // Remember what had focus so we can restore it when the dialog closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus to the first focusable element inside the panel.
    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    // Prefer the first real field so typing can start immediately; the close
    // button would otherwise be the first focusable.
    const initialItems = focusables();
    (initialItems.find((el) => el.matches("input, textarea, select")) ??
      initialItems[0])?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        // Minimal focus trap: wrap Tab / Shift+Tab within the panel.
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // The opener may have been removed while the dialog was open (a delete).
      const target = previouslyFocused?.isConnected ? previouslyFocused : returnFocusRef.current?.();
      target?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#111315]/30 p-4 backdrop-blur-[3px] motion-safe:animate-fadeIn"
      // Backdrop click closes; clicks inside the panel are stopped below.
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-foreground shadow-soft-lg motion-safe:animate-fadeUp",
          className
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-[15px] font-semibold tracking-tight">
            {title}
          </h2>
          <IconButton aria-label="Close dialog" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
