"use client";

import { useChat, type Message } from "@ai-sdk/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  Database,
  Download,
  FileText,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Mail,
  PanelRight,
  Pencil,
  RefreshCw,
  SearchCheck,
  Sparkles,
  Square,
  Table,
  ThumbsDown,
  ThumbsUp,
  Wand2,
  X,
} from "lucide-react";
import type { ModelTier } from "@/lib/brain";
import { useAppShell, tierPreset, type ModelOption } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/utils";
import { WORK_MODES, DEFAULT_MODE } from "@/lib/work-modes";
import {
  OUTPUT_TYPES,
  DEFAULT_OUTPUT_TYPE,
  type OutputType,
} from "@/lib/output-types";
import { friendlyError, parseOptions } from "@/lib/chat-format";
import {
  exportMarkdown,
  exportCsv,
  exportXlsx,
  exportDocx,
  exportPdf,
  tablesFrom,
  type ExportMessage,
} from "@/lib/export-doc";
import { Markdown } from "./Markdown";
import { saveConversationTurn } from "./actions";

// Suggested-prompt cards on the empty state — each prefills the composer.
const SUGGESTIONS = [
  {
    icon: Database,
    title: "Summarize reports",
    hint: "Pull the key trends together",
    prompt:
      "Summarize the key trends across our latest reports and highlight what changed.",
  },
  {
    icon: Wand2,
    title: "Brainstorm ideas",
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

// Executive (CEO mode) quick actions — prefill high-leverage prompts.
const CEO_ACTIONS: { label: string; prompt: string }[] = [
  { label: "What should I focus on today?", prompt: "Given what you know about my priorities and our current data, what are the 3 things I should focus on today, and why?" },
  { label: "Executive briefing", prompt: "Give me a concise executive briefing: pipeline and campaign health, biggest risks and bottlenecks, wins, and decisions waiting on me. Bottom line up front." },
  { label: "Log a decision", prompt: "Log this decision (capture the decision, my assumptions, the owner, expected outcome, and a review date): " },
  { label: "Pressure-test a plan", prompt: "Pressure-test this plan. Surface weak assumptions, blind spots, risks, and second-order effects, then tell me what must be true for it to work: " },
  { label: "What changed since last week?", prompt: "What has changed since last week that I should know about, and what does it imply for my priorities?" },
];

// Slash-command templates: type "/" in the composer to insert a parameterized
// prompt. `template` is inserted into the input for the user to complete.
interface SlashCommand {
  name: string;
  hint: string;
  template: string;
}
const SLASH_COMMANDS: SlashCommand[] = [
  { name: "ad", hint: "Write ad copy", template: "Write ad copy for: " },
  { name: "caption", hint: "Instagram caption", template: "Write an Instagram caption about: " },
  { name: "carousel", hint: "10 carousel ideas", template: "Create 10 carousel ideas from this: " },
  { name: "quotes", hint: "10 standalone quotes", template: "Extract 10 short, standalone quotes from this: " },
  { name: "hooks", hint: "5 short-form hooks", template: "Write 5 scroll-stopping hooks for: " },
  { name: "video-ideas", hint: "5 follow-up video ideas", template: "Give me 5 follow-up video ideas based on: " },
  { name: "email", hint: "Draft an email", template: "Draft a short, on-brand email that " },
  { name: "objection", hint: "Handle a sales objection", template: "How should a consultant handle this objection: " },
  { name: "summarize-call", hint: "Summarize call scores", template: "Summarize the key patterns across our recent call scores, with the top fixes." },
  { name: "brief", hint: "Creative brief", template: "Create a creative brief for: " },
  { name: "decision", hint: "Decision memo", template: "Write a decision memo on: " },
];

/** A retrieved source the Brain streamed for the current answer. */
interface SourceItem {
  id: string;
  source_type?: string | null;
  document_id?: string | null;
  /** ISO date of the source document, for a freshness indicator. */
  date?: string | null;
  snippet?: string;
}

/**
 * Turn a retrieval confidence in [0,1] into a human label + tone. High confidence
 * means the knowledge base clearly covered the question; low means the answer
 * leaned on weak matches and should be read with more caution.
 */
function confidenceMeta(
  c: number | null | undefined
): { label: string; tone: "high" | "medium" | "low"; pct: number } | null {
  if (typeof c !== "number" || !Number.isFinite(c)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, c)) * 100);
  if (pct >= 66) return { label: "High confidence", tone: "high", pct };
  if (pct >= 33) return { label: "Medium confidence", tone: "medium", pct };
  return { label: "Low confidence", tone: "low", pct };
}

/** Friendly names for the tiers Smart Route can resolve to (matches the switcher). */
const TIER_FRIENDLY: Record<string, string> = {
  fast: "Fast",
  recommended: "Balanced",
  max: "Best quality",
};

/** Icon per output type, for the format selector above the composer. */
const OUTPUT_ICONS: Record<OutputType, typeof AlignLeft> = {
  answer: AlignLeft,
  table: Table,
  summary: List,
  checklist: ListChecks,
  steps: ListOrdered,
  memo: FileText,
  email: Mail,
};

/** The format selector shown above the message box. Purely presentational. */
function OutputTypePicker({
  value,
  onChange,
}: {
  value: OutputType;
  onChange: (t: OutputType) => void;
}) {
  return (
    <div
      className="-mx-1 mb-2 flex items-center gap-1 overflow-x-auto px-1 pb-0.5"
      role="radiogroup"
      aria-label="Response format"
    >
      {OUTPUT_TYPES.map((o) => {
        const Icon = OUTPUT_ICONS[o.id];
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            title={o.hint}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            )}
          >
            <Icon size={13} aria-hidden />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** "Updated 3 days ago" style label from an ISO date, or null. */
function freshness(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Updated ${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `Updated ${years} year${years === 1 ? "" : "s"} ago`;
}


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
  const { selection, setSelection, options, addUsage, firstName, mode } = useAppShell();

  // What we forward to the Brain as `model`. We send it under both `model`
  // (the forward-looking field) and `tier` (which the current /api/chat reads
  // and forwards straight through), so the selection takes effect either way.
  // `mode` is the persona/work mode (role-gated server-side).
  // Output type (response format), chosen above the composer. Forwarded to the
  // Brain, which enforces the format server-side. Per-turn, local to the chat.
  const [outputType, setOutputType] = useState<OutputType>(DEFAULT_OUTPUT_TYPE);

  const chatBody = useMemo(
    () => ({ model: selection.value, tier: selection.value, mode, outputType }),
    [selection.value, mode, outputType]
  );

  const {
    messages,
    setMessages,
    append,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    status,
    stop,
    reload,
    error,
    data,
    setData,
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

  // Live activity from the Brain's status/sources data events (see /api/v1/chat).
  // `data` is reset at the start of each send, so it only reflects the current turn.
  const activity = useMemo(() => {
    const items = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    let label: string | null = null;
    let sourcesCount: number | null = null;
    let sources: SourceItem[] = [];
    let confidence: number | null = null;
    let routedTier: string | null = null;
    for (const it of items) {
      if (it?.type === "status" && typeof it.label === "string") label = it.label;
      if (it?.type === "sources" && Array.isArray(it.sources)) {
        sources = (it.sources as SourceItem[]).filter((s) => s && typeof s.id === "string");
        sourcesCount = sources.length;
        if (typeof it.confidence === "number") confidence = it.confidence as number;
      }
      if (it?.type === "route" && typeof it.tier === "string") {
        routedTier = it.tier as string;
      }
      if (it?.type === "status" && it.stage === "retrieved" && typeof it.count === "number") {
        sourcesCount = it.count as number;
      }
    }
    return { label, sourcesCount, sources, confidence, routedTier };
  }, [data]);

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
        // Reflect the new thread in the URL WITHOUT a router refresh/navigation.
        // A router.refresh() here reconciles to the new /c/[id] URL and remounts
        // ChatView from a server DB read — any timing gap there flashes an empty
        // thread and the just-streamed answer disappears. replaceState alone keeps
        // the in-memory messages on screen; a later reload/nav loads them from the
        // DB (they're already persisted above). The sidebar picks up the new
        // thread on the next navigation.
        window.history.replaceState(null, "", `/c/${result.conversationId}`);
      }
    } catch {
      // Best-effort save; the conversation still works if persistence fails.
    } finally {
      savingRef.current = false;
    }
  }, [messages, selection.tier]);

  // Fire persistence on the streaming -> ready transition (covers Stop too).
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    const justFinished =
      (was === "streaming" || was === "submitted") && status === "ready";
    if (!justFinished) return;
    const last = messages[messages.length - 1];
    // Only persist a real answer. An empty assistant turn (upstream 200 that
    // errored mid-stream and yielded no tokens) must NOT be saved, or the thread
    // would reload blank forever.
    if (last?.role === "assistant" && last.content.trim()) void persistTurn();
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
    setData(undefined); // clear last turn's status/sources so `activity` is per-turn
    handleSubmit(undefined, { body: chatBody });
  }, [input, busy, handleSubmit, chatBody, setData]);

  const regenerate = useCallback(() => {
    stickRef.current = true;
    setData(undefined);
    reload({ body: chatBody });
  }, [reload, chatBody, setData]);

  // Regenerate the last answer with a DIFFERENT model (also makes it the
  // selection going forward, like the top-bar switcher).
  const regenerateWith = useCallback(
    (value: string, tier: ModelTier) => {
      const opt = options.find((o) => o.value === value) ?? tierPreset(tier);
      setSelection(opt);
      stickRef.current = true;
      setData(undefined);
      reload({ body: { model: value, tier: value, mode, outputType } });
    },
    [options, setSelection, reload, setData, mode, outputType]
  );

  // Recovery path: switch to the Recommended tier (always available, Brain-
  // resolved) and retry. Useful when a specific model failed for this turn.
  const retryWithRecommended = useCallback(() => {
    const rec = tierPreset("recommended");
    setSelection(rec);
    stickRef.current = true;
    setData(undefined);
    reload({ body: { model: rec.value, tier: rec.value, mode, outputType } });
  }, [setSelection, reload, setData, mode, outputType]);

  // Send a picked option (or an "Other" answer) as the next user message.
  const pickOption = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      stickRef.current = true;
      setData(undefined);
      void append({ role: "user", content }, { body: chatBody });
    },
    [busy, append, chatBody, setData]
  );

  // --- Edit & resend a user message --------------------------------------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState<string | null>(null);

  const submitEdit = useCallback(
    (id: string, newContent: string) => {
      const text = newContent.trim();
      const idx = messages.findIndex((m) => m.id === id);
      setEditingId(null);
      if (idx === -1 || !text) return;
      // Drop the edited message and everything after it, then resend the edit
      // once the truncation has committed (so `append` builds on the trimmed
      // history, not the stale one).
      setMessages(messages.slice(0, idx));
      stickRef.current = true;
      setData(undefined);
      setPendingSend(text);
    },
    [messages, setMessages, setData]
  );

  useEffect(() => {
    if (pendingSend == null || status !== "ready") return;
    const content = pendingSend;
    setPendingSend(null);
    void append({ role: "user", content }, { body: chatBody });
  }, [pendingSend, status, append, chatBody]);

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

  // Evidence side panel (sources for the latest answer).
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  // Executive (CEO) private-memory editor.
  const [memoryOpen, setMemoryOpen] = useState(false);
  const isCeoMode = mode === "ceo";
  // The active work-mode def, for the visible composer chip (so the user can
  // always see which persona a message will be sent in).
  const modeDef = useMemo(
    () => WORK_MODES.find((m) => m.id === mode) ?? WORK_MODES.find((m) => m.id === DEFAULT_MODE)!,
    [mode]
  );

  // Export the conversation in a chosen format. The heavy libraries (docx/jspdf/
  // xlsx) load on demand inside the exporters, so they never bloat the bundle.
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const exportAs = useCallback(
    async (fmt: ExportFormat) => {
      if (messages.length === 0 || exporting) return;
      const turns = messages as unknown as ExportMessage[];
      setExporting(fmt);
      try {
        if (fmt === "md") exportMarkdown(title, turns);
        else if (fmt === "csv") exportCsv(title, turns);
        else if (fmt === "xlsx") await exportXlsx(title, turns);
        else if (fmt === "docx") await exportDocx(title, turns);
        else if (fmt === "pdf") await exportPdf(title, turns);
      } catch (e) {
        console.error("[export] failed:", e);
      } finally {
        setExporting(null);
      }
    },
    [messages, title, exporting]
  );
  // Whether the current conversation contains any table (enables CSV/Excel of
  // the actual data rather than a plain transcript).
  const hasTables = useMemo(
    () => tablesFrom(messages as unknown as ExportMessage[]).length > 0,
    [messages]
  );

  // --- Feedback (thumbs up/down) for the QA loop ------------------------
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const sendFeedback = useCallback(
    (message: Message, idx: number, rating: "up" | "down") => {
      setFeedback((f) => ({ ...f, [message.id]: rating }));
      const prior = messages[idx - 1];
      void fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rating,
          conversationId: conversationIdRef.current,
          content: message.content?.slice(0, 20000),
          prompt: prior?.role === "user" ? prior.content?.slice(0, 20000) : undefined,
          mode,
          model: selection.value,
        }),
      }).catch(() => {
        /* best-effort; the optimistic state stays */
      });
    },
    [messages, mode, selection.value]
  );

  const empty = messages.length === 0;
  const lastIndex = messages.length - 1;

  // The upstream returned 200 but produced no text (e.g. a mid-stream provider
  // error). Surface it explicitly instead of leaving a blank bubble.
  const lastMsg = messages[lastIndex];
  const emptyOutput =
    !busy &&
    !error &&
    !!lastMsg &&
    lastMsg.role === "assistant" &&
    !lastMsg.content.trim();

  const composer = (
    <Composer
      textareaRef={taRef}
      value={input}
      onChange={handleInputChange}
      onKeyDown={onKeyDown}
      onSubmit={onFormSubmit}
      busy={busy}
      onStop={stop}
      onSlashSelect={prefill}
    />
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {isCeoMode && (
        <CeoMemoryModal open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      )}
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
                What are you working on today?
              </p>
            </div>

            {composer}

            {isCeoMode ? (
              // -------- Executive workspace quick actions --------------------
              <>
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {CEO_ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      onClick={() => prefill(a.prompt)}
                      className="rounded-xl border border-border bg-surface px-3.5 py-3 text-left text-sm font-medium text-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-soft-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-center">
                  <Button variant="secondary" size="sm" onClick={() => setMemoryOpen(true)}>
                    <Crown size={14} />
                    Executive context
                  </Button>
                </div>
                <p className="mt-6 text-center text-xs text-muted-foreground">
                  Private executive mode. Your context is stored privately and never appears
                  in other users&apos; chats.
                </p>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      ) : (
        // -------- Active thread (chat column + evidence rail) ----------------
        <div className="flex h-full min-h-0">
          <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
              <ul className="space-y-6">
                {messages.map((m, idx) => (
                  <li key={m.id}>
                    {m.role === "user" ? (
                      editingId === m.id ? (
                        <EditBox
                          initial={m.content}
                          onCancel={() => setEditingId(null)}
                          onSave={(text) => submitEdit(m.id, text)}
                        />
                      ) : (
                        <div className="group flex flex-col items-end gap-1">
                          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-border bg-surface-muted px-4 py-2.5 text-sm text-foreground">
                            {m.content}
                          </div>
                          {!busy && (
                            <div className="flex items-center gap-1 pr-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
                              <IconButton
                                aria-label="Edit and resend"
                                size="sm"
                                onClick={() => setEditingId(m.id)}
                              >
                                <Pencil size={14} />
                              </IconButton>
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="group flex gap-3">
                        <span
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-soft"
                          aria-hidden
                        >
                          <Sparkles size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                          {(() => {
                            const { text, options } = parseOptions(m.content);
                            return (
                              <>
                                <div className="text-sm leading-relaxed text-foreground">
                                  <StreamingMarkdown
                                    content={text}
                                    animate={idx === lastIndex && busy}
                                  />
                                </div>
                                {idx === lastIndex && !busy && options.length > 0 && (
                                  <OptionsPicker
                                    options={options}
                                    onPick={pickOption}
                                    disabled={busy}
                                  />
                                )}
                              </>
                            );
                          })()}
                          {idx === lastIndex && !busy && activity.sourcesCount ? (
                            <SourcesDisclosure
                              count={activity.sourcesCount}
                              sources={activity.sources}
                            />
                          ) : null}
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
                            {m.content.trim() && (
                              <>
                                <IconButton
                                  aria-label="Good response"
                                  size="sm"
                                  onClick={() => sendFeedback(m, idx, "up")}
                                  className={feedback[m.id] === "up" ? "text-success" : undefined}
                                >
                                  <ThumbsUp
                                    size={14}
                                    className={feedback[m.id] === "up" ? "fill-current" : ""}
                                  />
                                </IconButton>
                                <IconButton
                                  aria-label="Bad response"
                                  size="sm"
                                  onClick={() => sendFeedback(m, idx, "down")}
                                  className={feedback[m.id] === "down" ? "text-danger" : undefined}
                                >
                                  <ThumbsDown
                                    size={14}
                                    className={feedback[m.id] === "down" ? "fill-current" : ""}
                                  />
                                </IconButton>
                              </>
                            )}
                            {idx === lastIndex && !busy && (
                              <RegenerateMenu
                                options={options}
                                onRegenerate={regenerate}
                                onRegenerateWith={regenerateWith}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                ))}

                {/* Awaiting the first streamed token — show live pipeline activity. */}
                {status === "submitted" && (
                  <li aria-live="polite" aria-label="Assistant is working" className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-soft"
                      aria-hidden
                    >
                      <Sparkles size={15} />
                    </span>
                    <ActivityLine label={activity.label} />
                  </li>
                )}
              </ul>

              {error && (
                <div
                  role="alert"
                  className="mt-6 flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger"
                >
                  <div className="flex items-start gap-2">
                    <span className="font-medium">Couldn’t generate a response.</span>
                  </div>
                  <p className="text-danger/90">{friendlyError(error)}</p>
                  <div className="mt-0.5 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={regenerate}>
                      <RefreshCw size={14} />
                      Retry
                    </Button>
                    <Button variant="ghost" size="sm" onClick={retryWithRecommended}>
                      Try Recommended model
                    </Button>
                  </div>
                </div>
              )}

              {emptyOutput && (
                <div
                  role="alert"
                  className="mt-6 flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-foreground"
                >
                  <span className="font-medium text-foreground">
                    The model returned no output.
                  </span>
                  <p className="text-muted-foreground">
                    This can happen with a specific model. Try again, or switch to the
                    Recommended model.
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={regenerate}>
                      <RefreshCw size={14} />
                      Retry
                    </Button>
                    <Button variant="ghost" size="sm" onClick={retryWithRecommended}>
                      Try Recommended model
                    </Button>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* Docked composer */}
          <div className="border-t border-border bg-background/80 backdrop-blur">
            <div className="mx-auto w-full max-w-3xl px-4 py-3">
              {/* Response-format selector — shapes the answer's shape (backend
                  enforces it). */}
              <OutputTypePicker value={outputType} onChange={setOutputType} />
              {/* Active work-mode chip — always visible so the user knows which
                  persona this message is sent in (backend enforces it). */}
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                    mode === "ceo"
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : mode === "general"
                        ? "border-border bg-surface-muted text-muted-foreground"
                        : "border-accent/30 bg-accent/5 text-foreground"
                  )}
                  title={`Answering in ${modeDef.label} mode — ${modeDef.hint}. Change it from the Work Mode menu in the sidebar.`}
                >
                  {mode === "ceo" ? <Crown size={12} /> : <Sparkles size={12} />}
                  {modeDef.label} mode
                </span>
                {mode !== "general" && (
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">
                    {modeDef.hint}
                  </span>
                )}
                {/* When Smart Route is active, show which tier it chose last turn. */}
                {selection.value === "smart" && activity.routedTier && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-1 text-[11px] text-muted-foreground">
                    Smart Route → {TIER_FRIENDLY[activity.routedTier] ?? activity.routedTier}
                  </span>
                )}
              </div>
              {composer}
              <div className="mt-2 flex items-center justify-center gap-3 text-xs text-muted-foreground">
                <span className="hidden sm:inline">
                  Grounded in your knowledge base · Enter to send, Shift+Enter for a new line
                </span>
                {activity.sourcesCount ? (
                  <button
                    type="button"
                    onClick={() => setEvidenceOpen((o) => !o)}
                    className="hidden items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
                  >
                    <PanelRight size={13} />
                    {evidenceOpen ? "Hide evidence" : `Evidence (${activity.sourcesCount})`}
                  </button>
                ) : null}
                <ExportMenu onExport={exportAs} exporting={exporting} hasTables={hasTables} />
              </div>
            </div>
          </div>
          </div>
          {evidenceOpen && (
            <EvidencePanel
              count={activity.sourcesCount ?? 0}
              sources={activity.sources}
              confidence={activity.confidence}
              onClose={() => setEvidenceOpen(false)}
            />
          )}
        </div>
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
  onSlashSelect,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  onStop: () => void;
  onSlashSelect: (text: string) => void;
}) {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Slash menu is open when the input is a bare "/word" (no space yet).
  const m = /^\/([\w-]*)$/.exec(value);
  const matches = m ? SLASH_COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase())) : [];
  const slashOpen = matches.length > 0 && !dismissed;
  const activeIdx = Math.min(active, matches.length - 1);

  const select = (cmd: SlashCommand) => {
    setActive(0);
    setDismissed(false);
    onSlashSelect(cmd.template);
  };

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        select(matches[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    onKeyDown(e);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (dismissed) setDismissed(false);
    setActive(0);
    onChange(e);
  }

  return (
    <form onSubmit={onSubmit} className="relative">
      {slashOpen && (
        <div className="absolute bottom-full left-0 z-30 mb-2 max-h-[50vh] w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg">
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Templates
          </p>
          {matches.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(cmd)}
              onMouseMove={() => setActive(i)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                i === activeIdx ? "bg-surface-muted" : "hover:bg-surface-muted"
              )}
            >
              <span className="font-medium text-foreground">/{cmd.name}</span>
              <span className="truncate text-xs text-muted-foreground">{cmd.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2 shadow-soft transition-colors focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-ring/40">
        <label htmlFor="chat-input" className="sr-only">
          Message the assistant
        </label>
        <textarea
          id="chat-input"
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Message the assistant…  (type / for templates)"
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

/** Inline editor for a user message: edit the text, then resend from that point. */
function EditBox({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Focus + caret to end + size to content on open.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Auto-grow.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  return (
    <div className="ml-auto w-full max-w-[85%] rounded-2xl border border-accent/40 bg-surface p-2 shadow-soft">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={1}
        className="max-h-[240px] w-full resize-none bg-transparent px-2 py-1 text-sm text-foreground outline-none"
        aria-label="Edit your message"
      />
      <div className="mt-1 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X size={14} />
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => onSave(value)} disabled={!value.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}

/** Regenerate the last answer — same model on click, or pick another from the menu. */
/** Export formats the composer bar offers. */
type ExportFormat = "md" | "pdf" | "docx" | "csv" | "xlsx";

/** Dropdown that exports the conversation in one of several formats. */
function ExportMenu({
  onExport,
  exporting,
  hasTables,
}: {
  onExport: (fmt: ExportFormat) => void;
  exporting: ExportFormat | null;
  hasTables: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  const items: { fmt: ExportFormat; label: string; note?: string }[] = [
    { fmt: "pdf", label: "PDF" },
    { fmt: "docx", label: "Word (.docx)" },
    { fmt: "md", label: "Markdown" },
    { fmt: "csv", label: "CSV", note: hasTables ? "tables" : "transcript" },
    { fmt: "xlsx", label: "Excel (.xlsx)", note: hasTables ? "tables" : "transcript" },
  ];

  return (
    <div className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {exporting ? (
          <Loader2 size={13} className="animate-spin" aria-hidden />
        ) : (
          <Download size={13} aria-hidden />
        )}
        Export
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-30 mb-1 w-52 rounded-xl border border-border bg-surface p-1 shadow-soft-lg"
        >
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Export as
          </p>
          {items.map((it) => (
            <button
              key={it.fmt}
              type="button"
              role="menuitem"
              disabled={!!exporting}
              onClick={() => {
                setOpen(false);
                onExport(it.fmt);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <span>{it.label}</span>
              {it.note && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {it.note}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RegenerateMenu({
  options,
  onRegenerate,
  onRegenerateWith,
}: {
  options: ModelOption[];
  onRegenerate: () => void;
  onRegenerateWith: (value: string, tier: ModelTier) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  const available = options.filter((o) => o.available);

  return (
    <div className="relative flex items-center" ref={ref}>
      <Button variant="ghost" size="sm" onClick={onRegenerate}>
        <RefreshCw size={14} />
        Regenerate
      </Button>
      {available.length > 0 && (
        <IconButton
          aria-label="Regenerate with a different model"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={14} />
        </IconButton>
      )}
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-1 max-h-[60vh] w-56 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg"
        >
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Regenerate with
          </p>
          {available.map((o) => (
            <button
              key={`${o.kind}-${o.value}`}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onRegenerateWith(o.value, o.tier);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">{o.label}</span>
              {o.kind === "tier" && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  preset
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The "Grounded in N sources" line, expandable to the retrieved source snippets. */
function SourcesDisclosure({ count, sources }: { count: number; sources: SourceItem[] }) {
  const [open, setOpen] = useState(false);
  const has = sources.length > 0;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => has && setOpen((o) => !o)}
        aria-expanded={has ? open : undefined}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors",
          has && "hover:text-foreground"
        )}
      >
        {has && (
          <ChevronRight
            size={12}
            className={cn("transition-transform", open && "rotate-90")}
            aria-hidden
          />
        )}
        Grounded in {count} source{count === 1 ? "" : "s"}
      </button>
      {open && has && (
        <ul className="mt-1.5 space-y-1.5">
          {sources.map((s, i) => (
            <li
              key={s.id}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
            >
              <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <FileText size={11} aria-hidden />
                <span>
                  {i + 1}. {(s.source_type || "source").replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-muted-foreground/90">{s.snippet || "(no preview)"}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Clickable choices for an assistant question (parsed from its ```options block).
 * Each chip sends that option as the next message; the "Other" chip reveals an
 * inline field for a custom answer.
 */
function OptionsPicker({
  options,
  onPick,
  disabled,
}: {
  options: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [other, setOther] = useState("");

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      {options.map((o, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground shadow-soft transition-colors hover:border-accent/50 hover:bg-surface-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {o}
        </button>
      ))}
      {!otherOpen ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOtherOpen(true)}
          className="rounded-full border border-dashed border-border bg-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Other…
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = other.trim();
            if (v) {
              onPick(v);
              setOther("");
              setOtherOpen(false);
            }
          }}
          className="flex items-center gap-1 rounded-full border border-accent/50 bg-surface px-2 py-1 shadow-soft"
        >
          <input
            autoFocus
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOther("");
                setOtherOpen(false);
              }
            }}
            disabled={disabled}
            placeholder="Type your answer…"
            aria-label="Your answer"
            className="w-40 bg-transparent px-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <IconButton
            type="submit"
            aria-label="Send answer"
            size="sm"
            disabled={disabled || !other.trim()}
            className="bg-accent text-accent-foreground hover:bg-accent-hover hover:text-accent-foreground disabled:opacity-40"
          >
            <ArrowUp size={15} />
          </IconButton>
        </form>
      )}
    </div>
  );
}

/** Right-hand evidence rail: the sources the Brain retrieved for the latest answer. */
function EvidencePanel({
  count,
  sources,
  confidence,
  onClose,
}: {
  count: number;
  sources: SourceItem[];
  confidence?: number | null;
  onClose: () => void;
}) {
  const conf = confidenceMeta(confidence);
  return (
    <aside
      aria-label="Evidence"
      className="hidden w-80 shrink-0 flex-col border-l border-border bg-surface/50 lg:flex"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Evidence</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {count} source{count === 1 ? "" : "s"}
          </span>
          <IconButton aria-label="Close evidence panel" size="sm" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </div>
      {conf && (
        <div
          className={cn(
            "flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] font-medium",
            conf.tone === "high" && "text-emerald-600 dark:text-emerald-400",
            conf.tone === "medium" && "text-amber-600 dark:text-amber-400",
            conf.tone === "low" && "text-rose-600 dark:text-rose-400"
          )}
          title="How well the retrieved sources matched your question. Low confidence means the answer leaned on weaker matches — verify before relying on it."
        >
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              conf.tone === "high" && "bg-emerald-500",
              conf.tone === "medium" && "bg-amber-500",
              conf.tone === "low" && "bg-rose-500"
            )}
          />
          {conf.label}
          <span className="text-muted-foreground/70">· {conf.pct}% match</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {sources.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            The sources used to ground the latest answer will appear here, with the
            same numbers as the inline citations.
          </p>
        ) : (
          <ul className="space-y-2">
            {sources.map((s, i) => (
              <li
                key={s.id}
                className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs"
              >
                <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <FileText size={11} aria-hidden />
                    {i + 1}. {(s.source_type || "source").replace(/_/g, " ")}
                  </span>
                  {freshness(s.date) && (
                    <span className="shrink-0 normal-case text-muted-foreground/70">
                      {freshness(s.date)}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground/90">{s.snippet || "(no preview)"}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** Editor for the executive's private memory (super-admin only, /api/ceo/memory). */
function CeoMemoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    fetch("/api/ceo/memory")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setValue(d.content ?? ""))
      .catch(() => setError("Couldn’t load your executive context."))
      .finally(() => setLoading(false));
  }, [open]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ceo/memory", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Save failed");
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Executive context (private)">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Your priorities, principles, communication preferences, and ongoing decisions.
          Used to tailor Executive mode. Private to you — it never appears in other users’
          chats.
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={loading || saving}
          rows={10}
          maxLength={8000}
          placeholder={
            loading
              ? "Loading…"
              : "e.g. My top priorities this quarter are…\nHow I like recommendations framed…\nOpen decisions and their owners…"
          }
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={loading || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Progressive character reveal for a smooth typewriter effect while streaming. */
function useSmoothText(text: string, active: boolean): string {
  const textRef = useRef(text);
  textRef.current = text;
  const [shown, setShown] = useState(text);
  const posRef = useRef(text.length);

  useEffect(() => {
    if (!active) {
      // Not streaming: always show the complete text.
      posRef.current = textRef.current.length;
      setShown(textRef.current);
      return;
    }
    posRef.current = 0; // reveal this turn from the start
    let raf = 0;
    const tick = () => {
      const full = textRef.current;
      // requestAnimationFrame is paused/throttled while the tab is hidden, so if
      // a tick does run while hidden (or the text shrank on a new turn), snap to
      // the full text — the streamed answer must never freeze or blank out on a
      // tab/window switch.
      if ((typeof document !== "undefined" && document.hidden) || posRef.current > full.length) {
        posRef.current = full.length;
        setShown(full);
      } else if (posRef.current < full.length) {
        // Reveal proportional to the backlog so it glides and always catches up.
        const step = Math.max(2, Math.ceil((full.length - posRef.current) / 6));
        posRef.current = Math.min(full.length, posRef.current + step);
        setShown(full.slice(0, posRef.current));
      }
      raf = requestAnimationFrame(tick);
    };
    // When the tab regains focus, immediately show everything received while it
    // was backgrounded (rAF was paused), then keep gliding from there.
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        posRef.current = textRef.current.length;
        setShown(textRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  return active ? shown : text;
}

// Memoized so that when one message streams, the other (settled) messages don't
// re-parse their markdown on every animation frame.
const MemoMarkdown = memo(Markdown);

/** Markdown that reveals smoothly while streaming, then renders in full. */
function StreamingMarkdown({ content, animate }: { content: string; animate: boolean }) {
  const shown = useSmoothText(content, animate);
  return (
    <>
      <MemoMarkdown content={shown} />
      {animate && (
        <span
          className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-text-bottom"
          aria-hidden
        />
      )}
    </>
  );
}

/** A live, single-line pipeline activity indicator ("Searching…", "Writing…"). */
function ActivityLine({ label }: { label: string | null }) {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" aria-live="polite">
      <span className="flex gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
      </span>
      <span>{label ?? "Thinking"}…</span>
    </div>
  );
}
