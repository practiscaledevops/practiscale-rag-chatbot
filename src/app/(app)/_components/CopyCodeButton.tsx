"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type CopyState = "idle" | "copied" | "failed";

const SIZE = {
  sm: "h-6 gap-1 px-2 text-[11px]", // code-block header
  md: "h-7 gap-1.5 px-2.5 text-xs", // table toolbar
} as const;

/**
 * A compact pill copy button with brief "Copied" feedback. `onCopy` performs the
 * copy and resolves true on success; false (or a throw) shows "Copy failed".
 */
export function CopyButton({
  onCopy,
  label = "Copy",
  ariaLabel,
  size = "md",
  className,
}: {
  onCopy: () => Promise<boolean>;
  label?: string;
  ariaLabel?: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const handleClick = async () => {
    let ok = false;
    try {
      ok = await onCopy();
    } catch {
      // Clipboard may be unavailable (insecure context / permission) — report it.
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  };

  const text = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={state === "idle" ? (ariaLabel ?? label) : text}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        SIZE[size],
        className
      )}
    >
      {state === "copied" ? (
        <Check size={14} className="shrink-0 text-success" aria-hidden />
      ) : (
        <Copy size={14} className="shrink-0" aria-hidden />
      )}
      <span aria-live="polite">{text}</span>
    </button>
  );
}

/** Copy-to-clipboard button for a fenced code block. */
export function CopyCodeButton({ code }: { code: string }) {
  return (
    <CopyButton
      size="sm"
      label="Copy"
      ariaLabel="Copy code"
      className="hover:bg-surface"
      onCopy={async () => {
        if (!navigator.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(code);
        return true;
      }}
    />
  );
}
