"use client";

import { Check, ChevronDown, Gauge } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelTier } from "@/lib/brain";
import { cn } from "@/lib/utils";

const TIERS: { value: ModelTier; label: string; hint: string }[] = [
  { value: "fast", label: "Fast", hint: "Quick answers" },
  { value: "recommended", label: "Recommended", hint: "Balanced" },
  { value: "max", label: "Max", hint: "Highest quality" },
];

export interface TopBarProps {
  /** Selected model tier. Defaults to "recommended" when uncontrolled. */
  tier?: ModelTier;
  onTierChange?: (tier: ModelTier) => void;

  /** Usage meter. Placeholder values now; wired to real metering later. */
  usedTokens?: number;
  tokenLimit?: number;

  /** Optional title shown at the left (e.g. the conversation title). */
  title?: string;

  className?: string;
}

/**
 * App top bar: a model/tier switcher (Fast / Recommended / Max) and a token
 * usage meter. Both are presentational — the chat/history agents pass the real
 * tier state and metering; sensible placeholders render standalone.
 */
export function TopBar({
  tier = "recommended",
  onTierChange,
  usedTokens = 0,
  tokenLimit = 100_000,
  title,
  className,
}: TopBarProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = TIERS.find((t) => t.value === tier) ?? TIERS[1];

  // Close the tier menu on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

  const pct =
    tokenLimit > 0
      ? Math.min(100, Math.round((usedTokens / tokenLimit) * 100))
      : 0;

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">
          {title || "Practiscale Assistant"}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Usage meter */}
        <div
          className="hidden items-center gap-2 sm:flex"
          title={`${usedTokens.toLocaleString()} / ${tokenLimit.toLocaleString()} tokens`}
        >
          <Gauge size={15} className="text-neutral-400" aria-hidden />
          <div
            className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
            role="progressbar"
            aria-label="Token usage"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-neutral-900 dark:bg-neutral-100"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="tabular-nums text-xs text-neutral-500">{pct}%</span>
        </div>

        {/* Model / tier switcher */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {current.label}
            <ChevronDown size={14} className="text-neutral-400" />
          </button>

          {open && (
            <ul
              role="listbox"
              aria-label="Model tier"
              className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
            >
              {TIERS.map((t) => {
                const selected = t.value === tier;
                return (
                  <li key={t.value} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onClick={() => {
                        onTierChange?.(t.value);
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium">{t.label}</span>
                        <span className="text-xs text-neutral-500">{t.hint}</span>
                      </span>
                      {selected && <Check size={15} className="shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </header>
  );
}
