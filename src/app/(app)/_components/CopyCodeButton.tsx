"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copy-to-clipboard button for a fenced code block. */
export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard may be unavailable (insecure context) — ignore.
        }
      }}
      aria-label={copied ? "Copied" : "Copy code"}
      className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check size={14} className="shrink-0 text-success" /> : <Copy size={14} className="shrink-0" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
