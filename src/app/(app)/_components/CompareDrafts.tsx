"use client";

// Compare drafts — run the same question through two models (typically an
// Anthropic model vs an OpenAI model) and show the answers side by side. Each
// pane streams independently from this app's /api/chat (the scoped Brain key
// stays server-side). Read-only: it never persists; it's for choosing a direction.

import * as React from "react";
import { Loader2, Copy, Check, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";
import { effectiveTimeZone, readPrefs, type ChatPrefs } from "@/lib/prefs";

export interface ComparePane {
  label: string;
  model: string;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Parse the AI SDK data stream, calling onText for each `0:"..."` text part. */
async function readDataStreamText(res: Response, onText: (t: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("0:")) {
        try {
          const chunk = JSON.parse(line.slice(2));
          if (typeof chunk === "string") onText(chunk);
        } catch {
          /* skip a malformed line */
        }
      }
    }
  }
}

/**
 * The /api/chat body for one pane. It carries the user's time zone (Settings →
 * Time zone, else this device's) so "today's calls" resolve on the same
 * calendar as the main chat; an unreadable zone is omitted and the Brain's
 * default applies. Read `prefs` at request time, in the browser.
 */
export function compareRequestBody(
  messages: ChatMessage[],
  model: string,
  mode: string,
  prefs: ChatPrefs = readPrefs()
): { messages: ChatMessage[]; model: string; tier: string; mode: string; timeZone?: string } {
  const timeZone = effectiveTimeZone(prefs);
  return { messages, model, tier: model, mode, ...(timeZone ? { timeZone } : {}) };
}

function usePaneStream(open: boolean, messages: ChatMessage[], mode: string, pane: ComparePane) {
  const [text, setText] = React.useState("");
  const [state, setState] = React.useState<"idle" | "loading" | "done" | "error">("idle");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const ctrl = new AbortController();
    setText("");
    setState("loading");
    (async () => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(compareRequestBody(messages, pane.model, mode)),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          if (!cancelled) setState("error");
          return;
        }
        await readDataStreamText(res, (t) => {
          if (!cancelled) setText((prev) => prev + t);
        });
        if (!cancelled) setState("done");
      } catch {
        if (!cancelled) setState((s) => (s === "loading" ? "error" : s));
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [open, messages, mode, pane.model]);

  return { text, state };
}

function Pane({ open, messages, mode, pane }: { open: boolean; messages: ChatMessage[]; mode: string; pane: ComparePane }) {
  const { text, state } = usePaneStream(open, messages, mode, pane);
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border pl-3.5 pr-2">
        <span className="truncate text-sm font-semibold">{pane.label}</span>
        {state === "loading" ? (
          <Loader2 size={14} className="mr-2 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={copy}
            disabled={!text.trim()}
            className="h-7 shrink-0 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            Copy
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm leading-6">
        {state === "error" ? (
          <p className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-danger">This model failed to respond. It may be unavailable.</p>
        ) : text.trim() ? (
          <Markdown content={text} />
        ) : (
          <div className="space-y-2" aria-hidden>
            <div className="h-3 w-11/12 animate-pulse rounded-full bg-surface-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded-full bg-surface-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-surface-muted" />
          </div>
        )}
      </div>
    </div>
  );
}

export function CompareDrafts({
  open,
  onClose,
  messages,
  mode,
  panes,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  mode: string;
  panes: [ComparePane, ComparePane];
}) {
  return (
    <Modal open={open} onClose={onClose} title="Compare drafts" className="max-w-4xl">
      <p className="-mt-1 mb-4 text-[13px] text-muted-foreground">
        The same question, answered by two models. Nothing here is saved — copy the draft you prefer.
      </p>
      <div className={cn("flex min-h-0 gap-3", "h-[60vh] flex-col sm:flex-row")}>
        <Pane open={open} messages={messages} mode={mode} pane={panes[0]} />
        <Pane open={open} messages={messages} mode={mode} pane={panes[1]} />
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          <X size={16} />
          Close
        </Button>
      </div>
    </Modal>
  );
}
