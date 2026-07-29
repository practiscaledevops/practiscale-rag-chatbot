"use client";

import { useChat, type Message } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Check,
  Copy,
  Database,
  Paperclip,
  RefreshCw,
  SearchCheck,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import type { ModelTier } from "@/lib/brain";
import { useAppShell, tierPreset } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { saveConversationTurn } from "./actions";

// Suggested-prompt cards on the empty state — each prefills the composer.
const SUGGESTIONS = [
  {
    icon: Database,
    title: "Synthesize data",
    hint: "Pull the key trends together",
    prompt:
      "Summarize the key trends across our latest reports and highlight what changed.",
  },
  {
    icon: Wand2,
    title: "Creative brainstorm",
    hint: "Explore fresh angles",
    prompt:
      "Brainstorm five fresh angles for our next customer outreach campaign.",
  },
  {
    icon: SearchCheck,
    title: "Check facts",
    hint: "Verify against the knowledge base",
    prompt:
      "Fact-check the following claim against our knowledge base and cite your sources: ",
  },
] as const;

// Quick pills — lightweight starters under the composer.
const PILLS: { label: string; prompt: string }[] = [
  { label: "Summarize a document", prompt: "Summarize this document: " },
  { label: "Draft an email", prompt: "Draft a short, professional email that " },
  { label: "Explain a concept", prompt: "Explain this concept in simple terms: " },
  { label: "Compare options", prompt: "Compare the pros and cons of " },
];

const ROLES_TO_PERSIST = new Set(["user", "assistant", "system"]);

export interface ChatViewProps {
  /** Existing conversation id, or null for a brand-new chat. */
  conversationId?: string | null;
  /** Existing conversation title (used for the browser tab). */
  title?: string | null;
  /** The tier this conversation was last saved with, synced into the switcher. */
  initialTier?: ModelTier;
  /** Turns already persisted for this conversation. */
  initialMessages?: Message[];
}

/** Capitalize the first letter of a name for the greeting. */
function titleCase(name: string): string {
  if (!name) return "there";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The Claude/ChatGPT-grade chat surface. Empty state: a centered greeting, a big
 * rounded composer, quick pills, and suggested-prompt cards. Active thread:
 * streamed, grounded, cited messages with copy / regenerate, a Stop button while
 * streaming, and auto-scroll. Streaming goes through this app's /api/chat (which
 * forwards to the Brain server-side). The selected model flows to /api/chat as
 * `body.model`; the token meter is fed by the usage the Brain reports on finish.
 */
export function ChatView({
  conversationId = null,
  title = null,
  initialTier,
  initialMessages,
}: ChatViewProps) {
  const router = useRouter();
  const { selection, setSelection, addUsage, firstName } = useAppShell();

  // What we forward to the Brain as `model`. We send it under both `model`
  // (the forward-looking field) and `tier` (which the current /api/chat reads
  // and forwards straight through), so the selection takes effect either way.
  const chatBody = useMemo(
    () => ({ model: selection.value, tier: selection.value }),
    [selection.value]
  );

  const {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    status,
    stop,
    reload,
    error,
  } = useChat({
    api: "/api/chat",
    body: chatBody,
    initialMessages: initialMessages ?? [],
    onFinish: (message, { usage: u }) => {
      // Prefer the exact token counts from the stream's finish part; fall back
      // to a rough estimate only when the stream omitted usage.
      const prompt = u?.promptTokens;
      const completion = u?.completionTokens;
      if (Number.isFinite(prompt) || Number.isFinite(completion)) {
        addUsage({
          promptTokens: Number.isFinite(prompt) ? prompt : 0,
          completionTokens: Number.isFinite(completion) ? completion : 0,
        });
      } else {
        addUsage({
          completionTokens: Math.ceil((message.content?.length ?? 0) / 4),
        });
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // Track the persisted id in a ref so the first save of a new chat can flip it
  // without re-rendering mid-stream.
  const conversationIdRef = useRef<string | null>(conversationId);
  const savingRef = useRef(false);

  // Set the tab title to the conversation title, when we have one.
  useEffect(() => {
    if (title) document.title = `${title} · Practiscale`;
  }, [title]);

  // Sync the model switcher to this conversation's saved tier — once, on open.
  // (Only the tier bucket is persisted, so a concrete-model pick restores as its
  // tier preset.)
  const tierSynced = useRef(false);
  useEffect(() => {
    if (!tierSynced.current && initialTier && initialTier !== selection.tier) {
      setSelection(tierPreset(initialTier));
    }
    tierSynced.current = true;
  }, [initialTier, selection.tier, setSelection]);

  // --- Persist a turn once streaming settles -----------------------------
  const persistTurn = useCallback(async () => {
    if (savingRef.current) return;
    const toSave = messages.filter((m) => ROLES_TO_PERSIST.has(m.role));
    if (toSave.length === 0) return;

    savingRef.current = true;
    const wasNew = conversationIdRef.current === null;
    try {
      const result = await saveConversationTurn({
        conversationId: conversationIdRef.current,
        // Persist the tier bucket (a checked enum), derived from the selection.
        tier: selection.tier,
        messages: toSave.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      });
      if (!result.ok) return;
      conversationIdRef.current = result.conversationId;
      if (wasNew) {
        // Reflect the new thread in the URL without a Next navigation, so this
        // view keeps its in-memory stream while a refresh lands on /c/[id].
        window.history.replaceState(null, "", `/c/${result.conversationId}`);
        router.refresh();
      }
    } catch {
      // Best-effort save; the conversation still works if persistence fails.
    } finally {
      savingRef.current = false;
    }
  }, [messages, selection.tier, router]);

  // Fire persistence on the streaming -> ready transition (covers Stop too).
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    const justFinished =
      (was === "streaming" || was === "submitted") && status === "ready";
    if (!justFinished) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") void persistTurn();
    // Keyed on status only: re-running on every `messages` update would fire
    // mid-stream. persistTurn reads the latest messages via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // --- Auto-scroll (only when the user is already near the bottom) --------
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    if (!stickRef.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: status === "streaming" ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, status]);

  // --- Composer ----------------------------------------------------------
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to a max height.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const submit = useCallback(() => {
    if (!input.trim() || busy) return;
    stickRef.current = true;
    handleSubmit(undefined, { body: chatBody });
  }, [input, busy, handleSubmit, chatBody]);

  function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const prefill = useCallback((text: string) => {
    setInput(text);
    // Focus and drop the caret at the end.
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [setInput]);

  // --- Copy-to-clipboard for assistant messages --------------------------
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context) — ignore.
    }
  }, []);

  const empty = messages.length === 0;
  const lastIndex = messages.length - 1;

  const composer = (
    <Composer
      textareaRef={taRef}
      value={input}
      onChange={handleInputChange}
      onKeyDown={onKeyDown}
      onSubmit={onFormSubmit}
      busy={busy}
      onStop={stop}
    />
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {empty ? (
        // -------- Empty state: centered greeting + composer + suggestions --
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 py-10">
            <div className="mb-7 text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                <span className="text-brand-gradient">
                  Hello, {titleCase(firstName)}
                </span>
              </h2>
              <p className="mt-2 text-lg text-muted-foreground">
                How can I assist you today?
              </p>
            </div>

            {composer}

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {PILLS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => prefill(p.prompt)}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-soft transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {SUGGESTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => prefill(s.prompt)}
                    className="group flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-soft-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                      <Icon size={16} />
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {s.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{s.hint}</span>
                  </button>
                );
              })}
            </div>

            <p className="mt-8 text-center text-xs text-muted-foreground">
              Answers are grounded in your Practiscale knowledge base, with inline
              sources you can trace back.
            </p>
          </div>
        </div>
      ) : (
        // -------- Active thread ---------------------------------------------
        <>
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
              <ul className="space-y-6">
                {messages.map((m, idx) => (
                  <li key={m.id}>
                    {m.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-border bg-surface-muted px-4 py-2.5 text-sm text-foreground">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div className="group flex gap-3">
                        <span
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-soft"
                          aria-hidden
                        >
                          <Sparkles size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-relaxed text-foreground">
                            <Markdown content={m.content} />
                          </div>
                          <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <IconButton
                              aria-label={copiedId === m.id ? "Copied" : "Copy message"}
                              size="sm"
                              onClick={() => copy(m.id, m.content)}
                            >
                              {copiedId === m.id ? (
                                <Check size={14} className="text-success" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </IconButton>
                            {idx === lastIndex && !busy && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  stickRef.current = true;
                                  reload({ body: chatBody });
                                }}
                              >
                                <RefreshCw size={14} />
                                Regenerate
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                ))}

                {/* Awaiting the first streamed token. */}
                {status === "submitted" && (
                  <li aria-live="polite" aria-label="Assistant is thinking" className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-soft"
                      aria-hidden
                    >
                      <Sparkles size={15} />
                    </span>
                    <TypingDots />
                  </li>
                )}
              </ul>

              {error && (
                <div
                  role="alert"
                  className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
                >
                  <span>Something went wrong reaching the assistant.</span>
                  <Button variant="secondary" size="sm" onClick={() => reload({ body: chatBody })}>
                    Retry
                  </Button>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* Docked composer */}
          <div className="border-t border-border bg-background/80 backdrop-blur">
            <div className="mx-auto w-full max-w-3xl px-4 py-3">
              {composer}
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Grounded in your knowledge base · Enter to send, Shift+Enter for a new line
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The prompt input: an auto-growing textarea in a big rounded card with an
 * attach affordance and a send / stop button. Shared by the empty-state hero and
 * the docked bottom bar.
 */
function Composer({
  textareaRef,
  value,
  onChange,
  onKeyDown,
  onSubmit,
  busy,
  onStop,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  onStop: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-2.5 py-2 shadow-soft transition-colors focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-ring/40">
        <IconButton
          aria-label="Attach a file (coming soon)"
          type="button"
          title="Attachments coming soon"
          className="shrink-0"
          disabled
        >
          <Paperclip size={17} />
        </IconButton>
        <label htmlFor="chat-input" className="sr-only">
          Message the assistant
        </label>
        <textarea
          id="chat-input"
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message the assistant…"
          className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <IconButton
            aria-label="Stop generating"
            type="button"
            onClick={onStop}
            className="shrink-0 bg-foreground text-background hover:bg-foreground/90 hover:text-background"
          >
            <Square size={15} className="fill-current" />
          </IconButton>
        ) : (
          <IconButton
            aria-label="Send message"
            type="submit"
            disabled={!value.trim()}
            className="shrink-0 bg-accent text-accent-foreground hover:bg-accent-hover hover:text-accent-foreground disabled:opacity-40"
          >
            <ArrowUp size={17} />
          </IconButton>
        )}
      </div>
    </form>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-2 text-muted-foreground" aria-hidden>
      <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-current" />
    </div>
  );
}
