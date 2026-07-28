"use client";

import { useChat, type Message } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Check,
  Copy,
  RefreshCw,
  Sparkles,
  Square,
} from "lucide-react";
import type { ModelTier } from "@/lib/brain";
import { useAppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { saveConversationTurn } from "./actions";

// A couple of gentle starters shown on the empty state.
const SUGGESTIONS = [
  "Summarize the key points from our onboarding docs.",
  "What does our policy say about remote work?",
  "Draft a short reply to a customer asking for a refund.",
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

/**
 * The Claude-like chat surface: a streaming message list, a stop/regenerate
 * toolbar, inline source chips, and an auto-growing composer. Streaming goes
 * through this app's /api/chat (which forwards to the Brain server-side); the
 * TopBar model switcher and token meter are read from / written to the shell
 * context. Completed turns are persisted to the chatbot's own Supabase.
 */
export function ChatView({
  conversationId = null,
  title = null,
  initialTier,
  initialMessages,
}: ChatViewProps) {
  const router = useRouter();
  const { tier, setTier, usage, setUsage } = useAppShell();

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
    body: { tier },
    initialMessages: initialMessages ?? [],
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
  const tierSynced = useRef(false);
  useEffect(() => {
    if (!tierSynced.current && initialTier && initialTier !== tier) {
      setTier(initialTier);
    }
    tierSynced.current = true;
  }, [initialTier, tier, setTier]);

  // --- Token/usage meter (estimate) --------------------------------------
  // Keep the limit in a ref so recomputing usage doesn't depend on it.
  const tokenLimitRef = useRef(usage.tokenLimit);
  tokenLimitRef.current = usage.tokenLimit;
  useEffect(() => {
    const chars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    // TODO(usage): swap this ~4-chars-per-token estimate for the exact token
    // counts the Brain reports (onFinish options.usage / a finish stream part).
    setUsage({ usedTokens: Math.ceil(chars / 4), tokenLimit: tokenLimitRef.current });
  }, [messages, setUsage]);

  // --- Persist a turn once streaming settles -----------------------------
  const persistTurn = useCallback(async () => {
    if (savingRef.current) return;
    const toSave = messages.filter((m) => ROLES_TO_PERSIST.has(m.role));
    if (toSave.length === 0) return;

    savingRef.current = true;
    const wasNew = conversationIdRef.current === null;
    try {
      // Persist via a server action (conversation CRUD lives in the history
      // agent's /api/conversations route; this only saves the active turns).
      const result = await saveConversationTurn({
        conversationId: conversationIdRef.current,
        tier,
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
        // Let the sidebar (server-rendered) pick up the new conversation.
        router.refresh();
      }
    } catch {
      // Best-effort save; the conversation still works if persistence fails.
    } finally {
      savingRef.current = false;
    }
  }, [messages, tier, router]);

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
    // Intentionally keyed on status only: re-running on every `messages` update
    // would fire mid-stream. persistTurn reads the latest messages via closure.
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
    handleSubmit(undefined, { body: { tier } });
  }, [input, busy, handleSubmit, tier]);

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

  function chooseSuggestion(text: string) {
    setInput(text);
    taRef.current?.focus();
  }

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

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {empty ? (
            <EmptyState onPick={chooseSuggestion} />
          ) : (
            <ul className="space-y-6">
              {messages.map((m, idx) => (
                <li key={m.id}>
                  {m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm text-white dark:bg-white dark:text-neutral-900">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div className="group flex flex-col gap-1">
                      <div className="max-w-none text-sm text-neutral-800 dark:text-neutral-200">
                        <Markdown content={m.content} />
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton
                          aria-label={copiedId === m.id ? "Copied" : "Copy message"}
                          size="sm"
                          onClick={() => copy(m.id, m.content)}
                        >
                          {copiedId === m.id ? <Check size={14} /> : <Copy size={14} />}
                        </IconButton>
                        {idx === lastIndex && !busy && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              stickRef.current = true;
                              reload({ body: { tier } });
                            }}
                          >
                            <RefreshCw size={14} />
                            Regenerate
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}

              {/* Awaiting the first streamed token. */}
              {status === "submitted" && (
                <li aria-live="polite" aria-label="Assistant is thinking">
                  <TypingDots />
                </li>
              )}
            </ul>
          )}

          {error && (
            <div
              role="alert"
              className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            >
              <span>Something went wrong reaching the assistant.</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => reload({ body: { tier } })}
              >
                Retry
              </Button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-neutral-200 dark:border-neutral-800">
        <form onSubmit={onFormSubmit} className="mx-auto w-full max-w-3xl px-4 py-3">
          <div className="flex items-end gap-2 rounded-2xl border border-neutral-300 bg-white px-3 py-2 focus-within:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
            <label htmlFor="chat-input" className="sr-only">
              Message the assistant
            </label>
            <textarea
              id="chat-input"
              ref={taRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Message the assistant…"
              className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-neutral-400"
            />
            {busy ? (
              <IconButton
                aria-label="Stop generating"
                size="md"
                onClick={() => stop()}
                className="bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 dark:hover:text-neutral-900"
              >
                <Square size={16} className="fill-current" />
              </IconButton>
            ) : (
              <IconButton
                aria-label="Send message"
                size="md"
                type="submit"
                disabled={!input.trim()}
                className={cn(
                  "bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white",
                  "disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 dark:hover:text-neutral-900"
                )}
              >
                <ArrowUp size={16} />
              </IconButton>
            )}
          </div>
          <p className="mt-2 px-1 text-center text-xs text-neutral-400">
            Answers are grounded in your knowledge base. Enter to send, Shift+Enter for a new line.
          </p>
        </form>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-2xl bg-neutral-100 p-3 dark:bg-neutral-800">
        <Sparkles size={22} className="text-neutral-500" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold">How can I help?</h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">
        Ask anything grounded in your Practiscale knowledge base. Answers include
        inline sources you can trace back.
      </p>
      <div className="mt-6 grid w-full max-w-md gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-neutral-200 px-4 py-2.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 text-neutral-400" aria-hidden>
      <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-current" />
    </div>
  );
}
