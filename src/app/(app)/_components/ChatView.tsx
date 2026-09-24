"use client";

import { useChat, type Message } from "@ai-sdk/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Columns2,
  Copy,
  Crown,
  GitBranch,
  Database,
  Download,
  FileText,
  Gavel,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Mic,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Pencil,
  PieChart,
  RefreshCw,
  RotateCw,
  SearchCheck,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import type { ModelTier } from "@/lib/brain";
import { useAppShell, tierPreset, type ModelOption } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { VoiceInput } from "@/components/VoiceInput";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/utils";
import { spliceText } from "@/lib/voice-shared";
import { isExecutiveMode, type WorkMode, type WorkModeDef } from "@/lib/work-modes";
import {
  WorkModePicker,
  ModelQualityPicker,
  SourceScopePicker,
  OutputFormatPicker,
  DeepResearchToggle,
} from "./ComposerControls";
import { PromptLibrary } from "./PromptLibrary";
import { BrainOrb } from "@/components/BrainOrb";
import { OrbAvatar } from "@/components/OrbAvatar";
import { PopoverMenu } from "@/components/PopoverMenu";
import { readPrefs } from "@/lib/prefs";
import { CompareDrafts, type ComparePane } from "./CompareDrafts";
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
import { JobProgress } from "./JobProgress";
import {
  MAX_FILES,
  ACCEPTED_ACCEPT,
  ACCEPTED_LABEL,
  attachmentKind,
  isSupportedName,
  maxBytesFor,
  maxMbFor,
  statusLabelFor,
  type ChatAttachment,
} from "@/lib/attachments-shared";
import { ObjectDrawer } from "@/components/ObjectDrawer";
import {
  conflictSentence,
  formatMetricValue,
  formatPeriod,
  parseConflictsEvent,
  parsePerformanceEvent,
  type ConflictPair,
  type PerformanceMetric,
} from "@/lib/brain-types";

/** A file the user is attaching to the next message (upload lifecycle in the composer). */
type PendingAttachment = {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  text?: string;
  truncated?: boolean;
  error?: string;
  /** Kept until the upload succeeds, so a failed upload can be retried. */
  file?: File;
};

/** Human-readable byte size, e.g. "12 KB", "3.4 MB". */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Suggested-prompt cards on the empty state — each prefills the composer.
const SUGGESTIONS: Suggestion[] = [
  {
    icon: PieChart,
    title: "Synthesize data",
    hint: "Turn our latest call scores into 5 key takeaways.",
    prompt:
      "Summarize our latest call scores into the 5 key takeaways, with the numbers behind each.",
  },
  {
    icon: Lightbulb,
    title: "Creative brainstorm",
    hint: "Fresh angles for our next outreach campaign.",
    prompt:
      "Brainstorm five fresh angles for our next customer outreach campaign.",
  },
  {
    icon: Gavel,
    title: "Check facts",
    hint: "Verify a claim against our knowledge base.",
    prompt:
      "Fact-check the following claim against our knowledge base and cite your sources: ",
  },
];

// Mode-specific launchpad — the selected work mode feels functional before the
// user types. Falls back to the general SUGGESTIONS above.
type Suggestion = { icon: typeof Database; title: string; hint: string; prompt: string };

const MODE_SUGGESTIONS: Partial<Record<WorkMode, Suggestion[]>> = {
  copywriter: [
    { icon: Wand2, title: "Generate hooks", hint: "High-converting openers", prompt: "Generate 5 high-converting hooks for " },
    { icon: FileText, title: "Rewrite a landing page", hint: "Sharper, on-brand copy", prompt: "Rewrite this landing page copy to be sharper and on-brand: " },
    { icon: Sparkles, title: "Objections into ads", hint: "Turn pushback into angles", prompt: "Turn our most common sales objections into ad angles: " },
    { icon: RefreshCw, title: "Email sequence", hint: "A full nurture flow", prompt: "Create a 4-email nurture sequence for " },
  ],
  content_strategist: [
    { icon: Sparkles, title: "Video concept", hint: "A short-form idea", prompt: "Create a short-form video concept for " },
    { icon: FileText, title: "30-second script", hint: "Hook to CTA", prompt: "Write a 30-second video script (hook to CTA) about " },
    { icon: Database, title: "Content series", hint: "A themed set", prompt: "Build a 5-part content series on " },
    { icon: Wand2, title: "Thumbnail angles", hint: "Scroll-stopping ideas", prompt: "Give me 5 thumbnail / cover angles for " },
  ],
  sales_coach: [
    { icon: SearchCheck, title: "Analyze a call", hint: "What went well & why", prompt: "Analyze our recent call scores and tell me what the top performers do differently." },
    { icon: RefreshCw, title: "Practice an objection", hint: "Roleplay a tough one", prompt: "Roleplay a prospect raising this objection and coach my response: " },
    { icon: FileText, title: "Follow-up messages", hint: "Move the deal forward", prompt: "Draft follow-up messages after a discovery call about " },
    { icon: Database, title: "Patterns in calls", hint: "Recurring themes", prompt: "Find the recurring patterns and top objections across our recent call scores." },
  ],
  strategy_advisor: [
    { icon: Sparkles, title: "Options & trade-offs", hint: "3-4 grounded paths", prompt: "Give me 3-4 options with trade-offs for " },
    { icon: SearchCheck, title: "Pressure-test a plan", hint: "Find the weak points", prompt: "Pressure-test this plan and surface the risks and weak assumptions: " },
    { icon: RefreshCw, title: "Compare directions", hint: "Side by side", prompt: "Compare the pros and cons of these two directions: " },
    { icon: Database, title: "Biggest risks", hint: "What could go wrong", prompt: "What are the biggest risks and blind spots in " },
  ],
  decision_memo: [
    { icon: FileText, title: "Decision memo", hint: "Recommendation-first", prompt: "Write a decision memo (recommendation up front, evidence, options, risks, next step) on: " },
    { icon: SearchCheck, title: "Recommend with evidence", hint: "Cited from our data", prompt: "Give me an evidence-backed recommendation, citing our knowledge base, on: " },
    { icon: Database, title: "Options & risks", hint: "Weighed clearly", prompt: "List the options, trade-offs, and risks for the decision: " },
    { icon: Sparkles, title: "Bottom line", hint: "One clear call", prompt: "Bottom line: what should we decide about the following, and why? " },
  ],
  management_coach: [
    { icon: SearchCheck, title: "Diagnose a manager", hint: "Dependency, delegation, accountability", prompt: "My manager is overloaded and the team waits on their decisions. Here is the situation: " },
    { icon: Wand2, title: "Delegation plan", hint: "What to hand off and how", prompt: "Build a delegation plan for this manager and team: " },
    { icon: FileText, title: "Accountability check", hint: "Who chases whom?", prompt: "Run the accountability diagnostic on this team: " },
    { icon: Database, title: "What did we learn?", hint: "Our past management experiments", prompt: "What have we already tried and learned about manager delegation at PractiScale?" },
  ],
  training_builder: [
    { icon: FileText, title: "Build a training", hint: "Modules, exercises, assessment", prompt: "Build a 90-minute training for our managers on: " },
    { icon: Wand2, title: "30-day program", hint: "A complete implementation plan", prompt: "Build a 30-day implementation program for the team on: " },
    { icon: Database, title: "Onboarding curriculum", hint: "From our SOPs and playbooks", prompt: "Build an onboarding curriculum for a new " },
    { icon: SearchCheck, title: "Assessment", hint: "Test what they learned", prompt: "Create an assessment with answer key for the training on: " },
  ],
  ceo_content: [
    { icon: Sparkles, title: "10 posts from a lesson", hint: "Founder voice, real experience", prompt: "Turn this real experience into 10 LinkedIn posts in my voice: " },
    { icon: Wand2, title: "Reel ideas from our data", hint: "What we actually learned", prompt: "Give me 10 CEO reel ideas grounded in what we actually learned this quarter." },
    { icon: FileText, title: "Story from a failure", hint: "Lesson-first storytelling", prompt: "Write a founder story about this failure and what it taught us: " },
    { icon: Database, title: "Case study post", hint: "Proof-led", prompt: "Write a proof-led post about this client result: " },
  ],
};

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
  /** Operating Intelligence lane + object identity (when the chunk belongs to a knowledge object). */
  lane?: string | null;
  ref?: string | null;
  name?: string | null;
  authority?: string | null;
  endorsement?: string | null;
  current?: boolean;
  via?: string | null;
}

/** "Save as Organizational Learning?" — a candidate the Brain detected in the conversation. */
interface LearningCandidate {
  kind: "decision" | "implementation" | "experiment" | "result" | "learning";
  title: string;
  change: string;
  observedResult: string | null;
  department: string | null;
  relatedRefs: string[];
  missingEvidence: string[];
  confidence: number;
}

const LANE_LABEL: Record<string, string> = {
  reality: "Reality",
  learning: "Learning",
  playbook: "Playbook",
  platform: "Platform",
  performance: "Performance",
  raw: "Raw",
};

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

/**
 * The conversation column (thread + docked composer share it). Wide by design:
 * it fills the workspace up to 1200px (1400px on extra-wide screens) so answers,
 * tables and long threads use the screen instead of a narrow centre strip with
 * empty sides.
 */
const THREAD_COL = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8 2xl:max-w-[1400px]";

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
  /** Pre-filled composer text (from `/?prompt=`, e.g. "Ask about this" on the Brain map). */
  initialInput?: string;
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
  initialInput,
}: ChatViewProps) {
  const { selection, setSelection, options, addUsage, firstName, mode, setMode, modeDefs, outputType, setOutputType } =
    useAppShell();
  const router = useRouter();
  const [branching, setBranching] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  // What we forward to the Brain as `model`. We send it under both `model`
  // (the forward-looking field) and `tier` (which the current /api/chat reads
  // and forwards straight through), so the selection takes effect either way.
  // `mode` is the persona/work mode (role-gated server-side).

  // Source scope: collections the user narrowed to (empty = all company
  // knowledge). Per-message setting, forwarded to /api/chat → the Brain.
  const [scopeCollectionIds, setScopeCollectionIds] = useState<string[]>(() => {
    const ids = readPrefs().collectionIds;
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  });

  // Attachments for the NEXT message: files the user attached, uploaded to
  // /api/attachments for text extraction, then forwarded with the send. Cleared
  // after each send (attachments apply to the turn they're sent with).
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const attachIdRef = useRef(0);
  const attachStartedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Upload one file for extraction; flip its chip to ready (with text) or error.
  const uploadAttachment = useCallback(async (id: string, file: File) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/attachments", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Upload failed");
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status: "ready",
                text: typeof json.text === "string" ? json.text : "",
                truncated: !!json.truncated,
                file: undefined,
                error: undefined,
              }
            : a
        )
      );
    } catch (e) {
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, status: "error", error: e instanceof Error ? e.message : "Upload failed" }
            : a
        )
      );
    }
  }, []);

  // Validate + queue files, then kick off their uploads. Enforces the file
  // count/size/type caps client-side (the server re-checks).
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      let room = MAX_FILES - attachmentsRef.current.length;
      const additions: PendingAttachment[] = [];
      for (const file of list) {
        if (room <= 0) break;
        const id = `att-${attachIdRef.current++}`;
        if (!isSupportedName(file.name)) {
          additions.push({ id, name: file.name, size: file.size, status: "error", error: `Unsupported type · accepts ${ACCEPTED_LABEL}` });
          continue;
        }
        // Size limit depends on the kind (voice notes get more room than text).
        if (file.size > maxBytesFor(file.name)) {
          additions.push({ id, name: file.name, size: file.size, status: "error", error: `Too large · max ${maxMbFor(file.name)} MB` });
          continue;
        }
        additions.push({ id, name: file.name, size: file.size, status: "uploading", file });
        room--;
      }
      if (additions.length === 0) return;
      setAttachments((prev) => [...prev, ...additions]);
      for (const a of additions) {
        if (a.status === "uploading" && a.file && !attachStartedRef.current.has(a.id)) {
          attachStartedRef.current.add(a.id);
          void uploadAttachment(a.id, a.file);
        }
      }
    },
    [uploadAttachment]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    attachStartedRef.current.delete(id);
  }, []);

  const retryAttachment = useCallback(
    (id: string) => {
      const item = attachmentsRef.current.find((a) => a.id === id);
      if (!item?.file) return;
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "uploading", error: undefined } : a))
      );
      void uploadAttachment(id, item.file);
    },
    [uploadAttachment]
  );

  // The saved thread id as STATE (conversationIdRef below is the mutable twin),
  // so chatBody re-derives once a new chat's first turn is persisted and every
  // later /api/chat call carries the id — that's what attributes usage to the
  // thread (the route verifies ownership before trusting it).
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId);
  // Deep-audit background jobs launched from this thread; each renders a live
  // progress card. Persisted in localStorage so the cards SURVIVE navigation
  // (the job runs server-side regardless); pruned after 3 hours.
  const [audits, setAudits] = useState<{ id: string; title: string; startedAt: number }[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = JSON.parse(localStorage.getItem("practiscale:audits") || "[]") as { id: string; title: string; startedAt: number }[];
      return raw.filter((a) => a && a.id && Date.now() - (a.startedAt ?? 0) < 3 * 60 * 60 * 1000);
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("practiscale:audits", JSON.stringify(audits.slice(0, 6)));
    } catch {
      /* localStorage may be unavailable */
    }
  }, [audits]);

  const chatBody = useMemo(
    () => ({
      model: selection.value,
      tier: selection.value,
      mode,
      conversationId: activeConversationId,
      outputType,
      ...(scopeCollectionIds.length ? { collectionIds: scopeCollectionIds } : {}),
    }),
    [selection.value, mode, activeConversationId, scopeCollectionIds, outputType]
  );

  // useChat throttles message-state updates (experimental_throttle below) but
  // flips `status` synchronously, so the last rendered assistant turn can lag
  // the finished one by a chunk. onFinish hands us the COMPLETE message; keep it
  // so persistence never saves a truncated answer.
  const finishedRef = useRef<{ id: string; content: string } | null>(null);

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
    // Seeded from `/?prompt=` (only read on mount; a later prompt on the same
    // mounted page is applied by the effect below).
    initialInput: initialInput ?? "",
    // Coalesce stream chunks into at most ~20 state updates/s: a fast model can
    // deliver 60+ chunks/s and each one re-rendered this whole view. The reveal
    // effect below smooths the visible text between updates anyway.
    experimental_throttle: 50,
    onFinish: (message, { usage: u }) => {
      finishedRef.current = { id: message.id, content: message.content ?? "" };
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
    let modeInfo: { mode: string; label: string; auto: boolean; intent: string } | null = null;
    let learning: LearningCandidate | null = null;
    // Operating Intelligence: the disagreements the Brain resolved and the
    // structured metrics it used as verified business data for this answer.
    let conflicts: ConflictPair[] = [];
    let performance: PerformanceMetric[] = [];
    for (const it of items) {
      if (it?.type === "status" && typeof it.label === "string") label = it.label;
      const pairs = parseConflictsEvent(it);
      if (pairs) conflicts = pairs;
      const metrics = parsePerformanceEvent(it);
      if (metrics) performance = metrics;
      if (it?.type === "sources" && Array.isArray(it.sources)) {
        sources = (it.sources as SourceItem[]).filter((s) => s && typeof s.id === "string");
        sourcesCount = sources.length;
        if (typeof it.confidence === "number") confidence = it.confidence as number;
      }
      if (it?.type === "route" && typeof it.tier === "string") {
        routedTier = it.tier as string;
      }
      if (it?.type === "mode" && typeof it.mode === "string") {
        modeInfo = {
          mode: it.mode as string,
          label: typeof it.label === "string" ? (it.label as string) : (it.mode as string),
          auto: !!it.auto,
          intent: typeof it.intent === "string" ? (it.intent as string) : "",
        };
      }
      if (it?.type === "learning_candidate" && typeof it.title === "string") {
        const kinds = ["decision", "implementation", "experiment", "result", "learning"] as const;
        const kind = kinds.includes(it.kind as (typeof kinds)[number]) ? (it.kind as LearningCandidate["kind"]) : "learning";
        learning = {
          kind,
          title: it.title as string,
          change: typeof it.change === "string" ? (it.change as string) : "",
          observedResult: typeof it.observedResult === "string" ? (it.observedResult as string) : null,
          department: typeof it.department === "string" ? (it.department as string) : null,
          relatedRefs: Array.isArray(it.relatedRefs) ? (it.relatedRefs as string[]) : [],
          missingEvidence: Array.isArray(it.missingEvidence) ? (it.missingEvidence as string[]) : [],
          confidence: typeof it.confidence === "number" ? (it.confidence as number) : 0,
        };
      }
      if (it?.type === "status" && it.stage === "retrieved" && typeof it.count === "number") {
        sourcesCount = it.count as number;
      }
    }
    return { label, sourcesCount, sources, confidence, routedTier, modeInfo, learning, conflicts, performance };
  }, [data]);

  // "Save as Organizational Learning?" — per-turn state keyed by the candidate title.
  const [learningState, setLearningState] = useState<{ key: string; status: "idle" | "saving" | "saved" | "ignored" | "error"; ref?: string; error?: string }>({ key: "", status: "idle" });
  const saveLearning = useCallback(async (c: LearningCandidate, notes?: string) => {
    setLearningState({ key: c.title, status: "saving" });
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: c.kind,
          title: c.title,
          change: c.change,
          observedResult: c.observedResult,
          department: c.department,
          relatedRefs: c.relatedRefs,
          missingEvidence: c.missingEvidence,
          notes: notes || undefined,
          conversationId: conversationIdRef.current,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ref?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "Couldn't save the learning");
      setLearningState({ key: c.title, status: "saved", ref: json.ref });
    } catch (e) {
      setLearningState({ key: c.title, status: "error", error: e instanceof Error ? e.message : "Couldn't save the learning" });
    }
  }, []);

  // Manual "Save as learning" from ANY answer. The automatic card only appears
  // when the Brain detects a decision/result in the user's own message; the
  // button lets a person turn an answer they acted on into Organizational
  // Learning directly (the card stays editable before saving).
  const [manualLearning, setManualLearning] = useState<{ messageId: string; candidate: LearningCandidate } | null>(null);
  const candidateFromAnswer = useCallback(
    (m: { content: string }, idx: number): LearningCandidate => {
      const text = parseOptions(m.content).text;
      const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
      const firstLine =
        text
          .split("\n")
          .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
          .find((l) => l.length > 0) ?? "Learning from chat";
      const prevUser = [...messages.slice(0, idx)].reverse().find((x) => x.role === "user")?.content ?? "";
      const isLast = idx === messages.length - 1;
      const refs = isLast ? Array.from(new Set(activity.sources.map((s) => s.ref).filter((r): r is string => !!r))) : [];
      return {
        kind: "learning",
        title: (heading ?? firstLine).slice(0, 120),
        change: (prevUser || firstLine).slice(0, 1500),
        observedResult: text.slice(0, 1500),
        department: null,
        relatedRefs: refs.slice(0, 10),
        missingEvidence: [],
        confidence: 0.5,
      };
    },
    [messages, activity.sources]
  );

  // Track the persisted id in a ref so the first save of a new chat can flip it
  // without re-rendering mid-stream.
  const conversationIdRef = useRef<string | null>(conversationId);
  const savingRef = useRef(false);
  // Guards the new-chat pre-create in submit(): a double-Enter during the create
  // round-trip must not spawn two threads or send the turn twice.
  const preCreatingRef = useRef(false);

  // Set the tab title to the conversation title, when we have one.
  useEffect(() => {
    if (title) document.title = `${title} · Practiscale`;
  }, [title]);

  // Sync the model switcher to this conversation's saved tier — once, on open.
  // (Only the tier bucket is persisted, so a concrete-model pick restores as its
  // tier preset — or, for a user whose switcher has no presets, as the first
  // usable concrete model in that tier.)
  const tierSynced = useRef(false);
  useEffect(() => {
    if (!tierSynced.current && initialTier && initialTier !== selection.tier) {
      const next =
        options.find((o) => o.kind === "tier" && o.value === initialTier) ??
        options.find((o) => o.kind === "model" && o.available && o.tier === initialTier);
      if (next) setSelection(next);
    }
    tierSynced.current = true;
  }, [initialTier, selection.tier, options, setSelection]);

  /** A message's full text — the finished copy when the throttled state lags it. */
  const fullContent = useCallback((m: Message): string => {
    const fin = finishedRef.current;
    return fin && fin.id === m.id && fin.content.length > m.content.length ? fin.content : m.content;
  }, []);

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
          content: fullContent(m),
        })),
      });
      if (!result.ok) return;
      conversationIdRef.current = result.conversationId;
      setActiveConversationId(result.conversationId);
      // Tell the shell to add (or re-title) this thread in the sidebar now,
      // without a router refresh that would remount and flash the stream.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("chat:saved", {
            detail: { id: result.conversationId, title: result.title, created: wasNew },
          })
        );
      }
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
  }, [messages, selection.tier, fullContent]);

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
    if (last?.role === "assistant" && fullContent(last).trim()) void persistTurn();
    // Keyed on status only: re-running on every `messages` update would fire
    // mid-stream. persistTurn reads the latest messages via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // --- Auto-scroll (only when the user is already near the bottom) --------
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  // `atBottom` mirrors stickRef as state, so the "Jump to latest" pill can show
  // when the user scrolls up while a response streams below.
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }, []);

  const jumpToLatest = useCallback(() => {
    stickRef.current = true;
    setAtBottom(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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

  const submit = useCallback(async () => {
    const hasText = input.trim().length > 0;
    const ready = attachmentsRef.current.filter((a) => a.status === "ready" && a.text);
    const uploading = attachmentsRef.current.some((a) => a.status === "uploading");
    if (busy || uploading) return;
    if (!hasText && ready.length === 0) return;
    const t = input.trim().toLowerCase();
    const isDeepAudit =
      hasText &&
      (t.includes("deep audit") ||
        t.includes("full audit") ||
        t.includes("thorough audit") ||
        t.includes("detailed audit") ||
        t.includes("audit all") ||
        t.includes("audit every") ||
        t.includes("audit each") ||
        ((t.includes("all") || t.includes("every")) && t.includes("read") && t.includes("transcript")));
    if (isDeepAudit) {
      const query = input.trim();
      setInput("");
      void (async () => {
        try {
          const res = await fetch("/api/jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query }),
          });
          const json = (await res.json().catch(() => ({}))) as { job?: { id: string; title: string }; error?: string };
          const jb = json.job;
          if (res.ok && jb) setAudits((prev) => [{ id: jb.id, title: jb.title, startedAt: Date.now() }, ...prev]);
          else void append({ role: "assistant", content: json.error ? `I couldn't start that audit: ${json.error}` : "I couldn't start that audit." }, { body: chatBody });
        } catch {
          void append({ role: "assistant", content: "I couldn't start that audit (network error)." }, { body: chatBody });
        }
      })();
      return;
    }
    stickRef.current = true;
    setData(undefined); // clear last turn's status/sources so `activity` is per-turn
    const payload: ChatAttachment[] = ready.map((a) => ({ name: a.name, text: a.text as string }));
    // The user message this turn sends (a default naming the files when there's
    // no question), reused as the title/first turn when pre-creating a new thread.
    const firstText = hasText
      ? input.trim()
      : `Please review the attached file${ready.length > 1 ? "s" : ""}: ${ready.map((a) => a.name).join(", ")}`;

    // For a BRAND-NEW thread, create the conversation row (persisting the user's
    // message) BEFORE streaming, so its id rides along in the request body. That
    // lets /api/chat finish and save the answer server-side even if the user
    // navigates away mid-stream — a new chat otherwise has no id server-side and
    // the in-progress answer is lost on navigation. One extra round-trip, only on
    // the first message of a new chat; existing threads already carry their id.
    //
    // NOTE: this goes through the plain /api/conversations route, NOT the
    // saveConversationTurn Server Action. A Server Action resolving right as we
    // replaceState to /c/[id] makes Next.js re-render that route, which remounts
    // this view mid-stream and the in-progress answer vanishes from the screen.
    let convId = conversationIdRef.current;
    if (convId === null) {
      if (preCreatingRef.current) return; // a create is already in flight
      preCreatingRef.current = true;
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier: selection.tier, messages: [{ role: "user", content: firstText }] }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          conversationId?: string;
          conversation?: { title?: string | null } | null;
        };
        if (res.ok && json.conversationId) {
          const id = json.conversationId;
          convId = id;
          conversationIdRef.current = id;
          setActiveConversationId(id);
          window.dispatchEvent(
            new CustomEvent("chat:saved", {
              detail: { id, title: json.conversation?.title ?? firstText.slice(0, 80), created: true },
            })
          );
          window.history.replaceState(null, "", `/c/${id}`);
        }
      } catch {
        // Pre-create failed — fall back to an unscoped turn. The client's own
        // onFinish save still persists it in the normal (no-navigation) case.
      } finally {
        preCreatingRef.current = false;
      }
    }

    const withId = convId === chatBody.conversationId ? chatBody : { ...chatBody, conversationId: convId };
    const body = payload.length ? { ...withId, attachments: payload } : withId;
    if (hasText) {
      handleSubmit(undefined, { body });
    } else {
      void append({ role: "user", content: firstText }, { body });
    }
    setAttachments([]);
    attachStartedRef.current.clear();
  }, [input, busy, handleSubmit, append, chatBody, setData, setInput, selection.tier]);

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
      reload({ body: { model: value, tier: value, mode, ...(scopeCollectionIds.length ? { collectionIds: scopeCollectionIds } : {}) } });
    },
    [options, setSelection, reload, setData, mode, scopeCollectionIds]
  );

  // Branch: fork a NEW conversation containing everything up to and including a
  // chosen answer, so the user can explore a different direction without losing
  // this thread. Persists the truncated history as a new conversation, then opens it.
  const branch = useCallback(
    async (idx: number) => {
      if (branching) return;
      const upto = messages
        .slice(0, idx + 1)
        .filter((m) => ROLES_TO_PERSIST.has(m.role))
        .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));
      if (upto.length === 0) return;
      setBranching(true);
      try {
        const res = await saveConversationTurn({ conversationId: null, messages: upto, tier: selection.tier });
        if (res.ok && res.conversationId) router.push(`/c/${res.conversationId}`);
      } finally {
        setBranching(false);
      }
    },
    [branching, messages, selection.tier, router]
  );

  // Compare drafts: the two models to pit against each other — Claude (Balanced)
  // vs an available OpenAI model, falling back to Claude Best quality if OpenAI
  // isn't configured. And the conversation up to the last question, so both
  // models answer the same thing with the same context.
  const comparePanes = useMemo<[ComparePane, ComparePane]>(() => {
    const openai = options.find((o) => o.kind === "model" && o.provider === "openai" && o.available);
    const a: ComparePane = { label: "Claude · Balanced", model: "recommended" };
    const b: ComparePane = openai
      ? { label: openai.label, model: openai.value }
      : { label: "Claude · Best quality", model: "max" };
    return [a, b];
  }, [options]);

  const compareMessages = useMemo(() => {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return [];
    return messages
      .slice(0, lastUser + 1)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }, [messages]);

  // Recovery path: switch to the Recommended tier (always available, Brain-
  // resolved) and retry. Useful when a specific model failed for this turn.
  const retryWithRecommended = useCallback(() => {
    const rec = tierPreset("recommended");
    setSelection(rec);
    stickRef.current = true;
    setData(undefined);
    reload({ body: { model: rec.value, tier: rec.value, mode, ...(scopeCollectionIds.length ? { collectionIds: scopeCollectionIds } : {}) } });
  }, [setSelection, reload, setData, mode, scopeCollectionIds]);

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

  // Insert a dictated transcript at the caret (or append when the composer isn't
  // focused). The user reviews and sends — dictation never auto-submits.
  const insertDictation = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const el = taRef.current;
    // The textarea's live value is the source of truth for the caret position.
    const cur = el?.value ?? input;
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    const { value, caret } = spliceText(cur, clean, start, end);
    setInput(value);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* selection may be unavailable if the node changed */
      }
    });
  }, [input, setInput]);

  // Apply a `/?prompt=` seed: on mount this just focuses (useChat already has
  // the text); when the prompt changes on an already-mounted page it re-seeds.
  const seededRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialInput || seededRef.current === initialInput) return;
    seededRef.current = initialInput;
    prefill(initialInput);
  }, [initialInput, prefill]);

  // Knowledge-object drawer (opened from the evidence panel's ref buttons).
  // "Ask about this" prefills an empty chat, or starts a new one otherwise.
  const [drawerRef, setDrawerRef] = useState<string | null>(null);
  const askAbout = useCallback(
    (prompt: string) => {
      setDrawerRef(null);
      if (messages.length === 0) prefill(prompt);
      else router.push(`/?prompt=${encodeURIComponent(prompt)}`);
    },
    [messages.length, prefill, router]
  );

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
  const isCeoMode = isExecutiveMode(mode);

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

  // --- Submit an answer for approval ------------------------------------
  const [approvalFor, setApprovalFor] = useState<{ message: Message; idx: number } | null>(null);
  const [approvalTitle, setApprovalTitle] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());

  const openApproval = useCallback((message: Message, idx: number) => {
    const firstLine =
      parseOptions(message.content).text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
    setApprovalTitle(firstLine.replace(/^#+\s*/, "").slice(0, 120));
    setApprovalError(null);
    setApprovalFor({ message, idx });
  }, []);

  const submitApproval = useCallback(async () => {
    if (!approvalFor || approvalBusy) return;
    setApprovalBusy(true);
    setApprovalError(null);
    const { message, idx } = approvalFor;
    const prior = messages[idx - 1];
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: parseOptions(message.content).text.slice(0, 50000),
          title: approvalTitle.trim() || undefined,
          prompt: prior?.role === "user" ? prior.content?.slice(0, 20000) : undefined,
          mode,
          model: selection.value,
          conversationId: conversationIdRef.current,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setApprovalError(data.error || "Couldn't submit for approval. Try again.");
        return;
      }
      setApprovedIds((prev) => new Set(prev).add(message.id));
      setApprovalFor(null);
    } catch {
      setApprovalError("Couldn't submit for approval. Try again.");
    } finally {
      setApprovalBusy(false);
    }
  }, [approvalFor, approvalBusy, approvalTitle, messages, mode, selection.value]);

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

  const attachUploading = attachments.some((a) => a.status === "uploading");
  const attachReadyCount = attachments.filter((a) => a.status === "ready").length;
  const canSend = (input.trim().length > 0 || attachReadyCount > 0) && !attachUploading;

  // --- Deep research (toggles the "Deep analysis" preset) -----------------
  const deepOption = useMemo(() => options.find((o) => o.value === "deep" && o.available) ?? null, [options]);
  const beforeDeepRef = useRef<ModelOption | null>(null);
  const deepOn = selection.value === "deep";
  const toggleDeep = useCallback(() => {
    if (!deepOption) return;
    if (deepOn) {
      setSelection(beforeDeepRef.current ?? options.find((o) => o.value === "smart") ?? tierPreset("recommended"));
    } else {
      beforeDeepRef.current = selection;
      setSelection(deepOption);
    }
  }, [deepOption, deepOn, options, selection, setSelection]);

  // --- Saved prompts (the user's prompt library) --------------------------
  const [libraryOpen, setLibraryOpen] = useState(false);

  // --- Client-only bits: timestamps (viewer's time zone) + read aloud ------
  // Rendered after mount so server (UTC) and browser times never disagree.
  const [hydrated, setHydrated] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => {
    setHydrated(true);
    setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const speak = useCallback(
    (id: string, text: string) => {
      if (!("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      if (speakingId === id) {
        synth.cancel();
        setSpeakingId(null);
        return;
      }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(speakableText(text));
      const done = () => setSpeakingId((cur) => (cur === id ? null : cur));
      utterance.onend = done;
      utterance.onerror = done;
      setSpeakingId(id);
      synth.speak(utterance);
    },
    [speakingId]
  );

  const composerCore = {
    textareaRef: taRef,
    value: input,
    onChange: handleInputChange,
    onKeyDown,
    onSubmit: onFormSubmit,
    busy,
    onStop: stop,
    onSlashSelect: prefill,
    attachments,
    onAttachFiles: addFiles,
    onRemoveAttachment: removeAttachment,
    onRetryAttachment: retryAttachment,
    onDictate: insertDictation,
    canSend,
    onOpenLibrary: () => setLibraryOpen(true),
  };

  // New-chat composer card: deep research, mode + format on the left; model +
  // knowledge scope (icon-only) on the right, next to mic + send.
  const heroComposer = (
    <Composer
      {...composerCore}
      variant="hero"
      leftTools={
        <>
          {deepOption && <DeepResearchToggle on={deepOn} onToggle={toggleDeep} />}
          <WorkModePicker modes={modeDefs} value={mode} onChange={setMode} />
          <OutputFormatPicker value={outputType} onChange={setOutputType} iconOnly />
        </>
      }
      rightTools={
        <>
          <ModelQualityPicker options={options} value={selection} onChange={setSelection} iconOnly align="right" />
          <SourceScopePicker value={scopeCollectionIds} onChange={setScopeCollectionIds} iconOnly align="right" />
        </>
      }
    />
  );

  // In-thread: a compact settings row above the pill composer. Pickers and
  // status chips wrap inside the left group; Evidence / Export keep a fixed
  // top-right column. Format + scope are icon-only here, as on the hero card.
  const toolbar = (
    <div className="mb-2 flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <WorkModePicker modes={modeDefs} value={mode} onChange={setMode} size="sm" />
        <ModelQualityPicker options={options} value={selection} onChange={setSelection} size="sm" />
        <OutputFormatPicker value={outputType} onChange={setOutputType} size="sm" iconOnly />
        <SourceScopePicker value={scopeCollectionIds} onChange={setScopeCollectionIds} size="sm" iconOnly />
        {deepOption && <DeepResearchToggle on={deepOn} onToggle={toggleDeep} size="sm" />}
        {selection.value === "smart" && activity.routedTier && (
          <span className="inline-flex h-7 items-center whitespace-nowrap rounded-full bg-surface-muted px-2.5 text-xs text-muted-foreground">
            Smart Route → {TIER_FRIENDLY[activity.routedTier] ?? activity.routedTier}
          </span>
        )}
        {mode === "auto" && activity.modeInfo && (
          <span
            className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent-soft px-2.5 text-xs font-medium text-accent-strong"
            title="The Brain picked this expert for your last message. Choose a mode to override."
          >
            <Sparkles size={14} className="shrink-0" aria-hidden /> Auto → {activity.modeInfo.label}
          </span>
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-0.5">
        {activity.sourcesCount ? (
          <button
            type="button"
            onClick={() => setEvidenceOpen((o) => !o)}
            className="hidden h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
          >
            <PanelRight size={14} aria-hidden />
            {evidenceOpen ? "Hide evidence" : `Evidence (${activity.sourcesCount})`}
          </button>
        ) : null}
        <ExportMenu onExport={exportAs} exporting={exporting} hasTables={hasTables} />
      </div>
    </div>
  );

  const suggestions: Suggestion[] = (MODE_SUGGESTIONS[mode] ?? SUGGESTIONS).slice(0, 3);

  return (
    <div className="flex h-full flex-col bg-background">
      {isCeoMode && <CeoMemoryModal open={memoryOpen} onClose={() => setMemoryOpen(false)} />}
      <ApprovalSubmitModal
        open={!!approvalFor}
        title={approvalTitle}
        onTitleChange={setApprovalTitle}
        busy={approvalBusy}
        error={approvalError}
        content={approvalFor ? parseOptions(approvalFor.message.content).text : ""}
        onSubmit={submitApproval}
        onClose={() => (approvalBusy ? undefined : setApprovalFor(null))}
      />
      <CompareDrafts
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        messages={compareMessages}
        mode={mode}
        panes={comparePanes}
      />
      <PromptLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} onInsert={prefill} />
      <ObjectDrawer refId={drawerRef} onClose={() => setDrawerRef(null)} onAsk={askAbout} />
      {empty ? (
        // -------- New chat (reference "Cortex"): orb, greeting, composer card,
        //          suggestion cards --------------------------------------------
        <div className="flex h-full flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 pb-10 pt-2 sm:px-6">
            <div className="flex flex-col items-center text-center">
              <BrainOrb size={112} active={input.trim().length > 0} className="-mb-2" />
              <h2 className="text-[26px] font-medium leading-[1.2] tracking-[-0.02em] sm:text-[30px]">
                <span className="text-greeting-gradient">Hello, {titleCase(firstName)}</span>
              </h2>
              <p className="text-[26px] font-semibold leading-[1.2] tracking-[-0.025em] text-foreground sm:text-[30px]">
                {isCeoMode ? "What needs your attention?" : "How can I assist you today?"}
              </p>
            </div>

            <div className="mt-6">{heroComposer}</div>

            {isCeoMode ? (
              <>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {CEO_ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      onClick={() => prefill(a.prompt)}
                      className="rounded-xl border border-border bg-surface p-3.5 text-left text-[13px] font-semibold leading-5 text-foreground transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <p className="mt-4 text-center text-xs text-subtle-foreground">
                  Private executive mode. Your context is stored privately and never appears in other users&apos; chats.
                </p>
              </>
            ) : (
              <>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
                  {suggestions.map((s) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => prefill(s.prompt)}
                      className="group flex flex-col rounded-xl border border-border bg-surface p-3.5 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <s.icon size={18} className="shrink-0 text-muted-foreground transition-colors group-hover:text-accent" aria-hidden />
                      <span className="mt-3 text-[13px] font-semibold leading-5 text-foreground">{s.title}</span>
                      <span className="mt-0.5 text-xs leading-4 text-muted-foreground">{s.hint}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-5 text-center text-xs text-subtle-foreground">
                  Answers are grounded in your PractiScale knowledge base, with sources you can trace.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        // -------- Active thread (reference "Qubi") + evidence rail -------------
        <div className="flex h-full min-h-0">
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
              <div className={cn(THREAD_COL, "pb-4 pt-3")}>
                {audits.length > 0 && (
                  <div className="mb-5 space-y-3">
                    {audits.map((a) => (
                      <JobProgress
                        key={a.id}
                        jobId={a.id}
                        title={a.title}
                        onDismiss={() => setAudits((prev) => prev.filter((x) => x.id !== a.id))}
                      />
                    ))}
                  </div>
                )}
                <ul className="space-y-4">
                  {messages.map((m, idx) => {
                    const time = hydrated ? messageTime(m) : null;
                    const streamingThis = idx === lastIndex && busy;

                    if (m.role === "user") {
                      return (
                        <li key={m.id}>
                          {editingId === m.id ? (
                            <div className="flex items-start justify-end gap-2.5">
                              <EditBox
                                initial={m.content}
                                onCancel={() => setEditingId(null)}
                                onSave={(text) => submitEdit(m.id, text)}
                              />
                              <UserAvatar name={firstName} />
                            </div>
                          ) : (
                            <div className="group flex items-start justify-end gap-2.5">
                              <div className="flex min-w-0 max-w-[80%] flex-col items-end">
                                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-accent-soft px-3.5 py-2 text-sm leading-6 text-foreground">
                                  {m.content}
                                  {time && <MessageTime label={time} className="float-right ml-3 mt-[7px]" />}
                                </div>
                                {!busy && (
                                  <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                                    <IconButton
                                      aria-label={copiedId === m.id ? "Copied" : "Copy message"}
                                      size="sm"
                                      onClick={() => copy(m.id, m.content)}
                                    >
                                      {copiedId === m.id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                                    </IconButton>
                                    <IconButton aria-label="Edit and resend" size="sm" onClick={() => setEditingId(m.id)}>
                                      <Pencil size={14} />
                                    </IconButton>
                                  </div>
                                )}
                              </div>
                              <UserAvatar name={firstName} />
                            </div>
                          )}
                        </li>
                      );
                    }

                    const { text, options: choices } = parseOptions(m.content);
                    const wide = text.length > 160 || text.includes("```") || text.includes("\n|");
                    const approved = approvedIds.has(m.id);
                    return (
                      <li key={m.id}>
                        <div className="group flex items-start gap-2.5">
                          <OrbAvatar size={28} active={streamingThis} className="mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div
                              className={cn(
                                "max-w-full rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-2.5 text-sm leading-6 text-foreground shadow-[0_1px_2px_rgb(17_19_21/0.03)]",
                                wide ? "w-full" : "w-fit"
                              )}
                            >
                              <StreamingMarkdown content={text} animate={streamingThis} />
                              {idx === lastIndex && !busy && choices.length > 0 && (
                                <OptionsPicker options={choices} onPick={pickOption} disabled={busy} />
                              )}
                              {time && !streamingThis && m.content.trim() && (
                                <div className="mt-1 flex justify-end">
                                  <MessageTime label={time} />
                                </div>
                              )}
                            </div>

                            {idx === lastIndex &&
                            !busy &&
                            typeof activity.confidence === "number" &&
                            activity.confidence < 0.34 &&
                            m.content.trim() ? (
                              <div className="mt-2 inline-flex min-h-7 items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs text-warning">
                                <AlertTriangle size={14} className="shrink-0" aria-hidden />
                                Limited supporting knowledge — verify before relying on this.
                              </div>
                            ) : null}
                            {idx === lastIndex && !busy && activity.sourcesCount ? (
                              <SourcesDisclosure count={activity.sourcesCount} sources={activity.sources} />
                            ) : null}
                            {idx === lastIndex &&
                            !busy &&
                            activity.learning &&
                            !(learningState.key === activity.learning.title && learningState.status === "ignored") ? (
                              <LearningCard
                                candidate={activity.learning}
                                state={
                                  learningState.key === activity.learning.title
                                    ? learningState
                                    : { key: activity.learning.title, status: "idle" }
                                }
                                onSave={(notes) => saveLearning(activity.learning!, notes)}
                                onIgnore={() => setLearningState({ key: activity.learning!.title, status: "ignored" })}
                              />
                            ) : null}
                            {manualLearning?.messageId === m.id ? (
                              <LearningCard
                                candidate={manualLearning.candidate}
                                state={
                                  learningState.key === manualLearning.candidate.title
                                    ? learningState
                                    : { key: manualLearning.candidate.title, status: "idle" }
                                }
                                onSave={(notes) => saveLearning(manualLearning.candidate, notes)}
                                onIgnore={() => setManualLearning(null)}
                              />
                            ) : null}

                            {/* Action row: regenerate · read aloud · copy · 👍 · 👎 · more */}
                            {!streamingThis && m.content.trim() && (
                              <div
                                className={cn(
                                  "mt-1 flex items-center gap-0.5 transition-opacity",
                                  idx === lastIndex
                                    ? "opacity-100"
                                    : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
                                )}
                              >
                                {idx === lastIndex && (
                                  <RegenerateMenu options={options} onRegenerate={regenerate} onRegenerateWith={regenerateWith} />
                                )}
                                {canSpeak && (
                                  <IconButton
                                    aria-label={speakingId === m.id ? "Stop reading aloud" : "Read aloud"}
                                    title={speakingId === m.id ? "Stop reading aloud" : "Read aloud"}
                                    size="sm"
                                    onClick={() => speak(m.id, m.content)}
                                    className={
                                      speakingId === m.id
                                        ? "bg-accent-soft text-accent-strong hover:bg-accent-soft hover:text-accent-strong"
                                        : undefined
                                    }
                                  >
                                    {speakingId === m.id ? <VolumeX size={14} /> : <Volume2 size={14} />}
                                  </IconButton>
                                )}
                                <IconButton
                                  aria-label={copiedId === m.id ? "Copied" : "Copy message"}
                                  title="Copy"
                                  size="sm"
                                  onClick={() => copy(m.id, m.content)}
                                >
                                  {copiedId === m.id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                                </IconButton>
                                <IconButton
                                  aria-label="Good response"
                                  title="Good response"
                                  size="sm"
                                  onClick={() => sendFeedback(m, idx, "up")}
                                  className={feedback[m.id] === "up" ? "text-accent-strong" : undefined}
                                >
                                  <ThumbsUp size={14} className={feedback[m.id] === "up" ? "fill-current" : ""} />
                                </IconButton>
                                <IconButton
                                  aria-label="Bad response"
                                  title="Bad response"
                                  size="sm"
                                  onClick={() => sendFeedback(m, idx, "down")}
                                  className={feedback[m.id] === "down" ? "text-danger" : undefined}
                                >
                                  <ThumbsDown size={14} className={feedback[m.id] === "down" ? "fill-current" : ""} />
                                </IconButton>
                                <PopoverMenu
                                  label="More actions"
                                  trigger={<MoreHorizontal size={14} />}
                                  triggerClassName="h-7 w-7"
                                  items={[
                                    {
                                      label: approved ? "Submitted for approval" : "Submit for approval",
                                      icon: approved ? Check : ClipboardCheck,
                                      onSelect: () => openApproval(m, idx),
                                      disabled: approved,
                                      active: approved,
                                    },
                                    {
                                      label: "Save as learning",
                                      icon: Lightbulb,
                                      active: manualLearning?.messageId === m.id,
                                      onSelect: () =>
                                        setManualLearning((cur) =>
                                          cur?.messageId === m.id
                                            ? null
                                            : { messageId: m.id, candidate: candidateFromAnswer(m, idx) }
                                        ),
                                    },
                                    { label: "Branch from here", icon: GitBranch, onSelect: () => branch(idx), disabled: branching },
                                    ...(idx === lastIndex && !busy
                                      ? [{ label: "Compare with another model", icon: Columns2, onSelect: () => setCompareOpen(true) }]
                                      : []),
                                  ]}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}

                  {/* Awaiting the first streamed token: the orb pulses beside a
                      typing indicator and the live pipeline stage. */}
                  {status === "submitted" && (
                    <li aria-live="polite" aria-label="Assistant is working" className="flex items-start gap-2.5">
                      <OrbAvatar size={28} active className="mt-0.5 shrink-0" />
                      <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft px-3" aria-hidden>
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent [animation-delay:150ms]" />
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent [animation-delay:300ms]" />
                        </span>
                        <span className="text-sm text-muted-foreground">{activity.label ?? "Thinking"}…</span>
                      </div>
                    </li>
                  )}
                </ul>

                {error && (
                  <div
                    role="alert"
                    className="mt-5 flex flex-col gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
                  >
                    <span className="font-medium">Couldn’t generate a response.</span>
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
                    className="mt-5 flex flex-col gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px] text-foreground"
                  >
                    <span className="font-medium">The model returned no output.</span>
                    <p className="text-muted-foreground">
                      This can happen with a specific model. Try again, or switch to the Recommended model.
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
            <div className="relative shrink-0 bg-background">
              {!atBottom && messages.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 -top-10 flex justify-center">
                  <button
                    type="button"
                    onClick={jumpToLatest}
                    className="pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-foreground shadow-soft-lg transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-fadeUp"
                  >
                    <ArrowDown size={14} aria-hidden />
                    Jump to latest
                  </button>
                </div>
              )}
              <div className={cn(THREAD_COL, "pb-3 pt-1")}>
                {toolbar}
                <Composer {...composerCore} variant="dock" />
              </div>
            </div>
          </div>
          {evidenceOpen && (
            <EvidencePanel
              count={activity.sourcesCount ?? 0}
              sources={activity.sources}
              confidence={activity.confidence}
              conflicts={activity.conflicts}
              performance={activity.performance}
              onOpenRef={setDrawerRef}
              onClose={() => setEvidenceOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Local "10:25" time for a message (client-only; see `hydrated`). */
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
function messageTime(m: Message): string | null {
  if (!m.createdAt) return null;
  const d = new Date(m.createdAt);
  return Number.isNaN(d.getTime()) ? null : TIME_FMT.format(d);
}

/** Timestamp + delivered ticks, as in the reference chat bubbles. */
function MessageTime({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center gap-1 whitespace-nowrap text-[11px] leading-none text-subtle-foreground",
        className
      )}
    >
      {label}
      <CheckCheck size={12} className="shrink-0 text-accent/80" aria-hidden />
    </span>
  );
}

/** The user's avatar: their initial on a dark disc. */
function UserAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#262626] text-[11px] font-semibold text-white"
    >
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}

/** Plain, speakable text from a markdown answer (for read-aloud). */
function speakableText(md: string): string {
  return parseOptions(md)
    .text.replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[[^\]\s]{1,40}\](?!\()/g, "")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, " ")
    .replace(/[|*_#>~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
}

/**
 * The prompt input, in two shapes that share the slash-template menu, the
 * attachments tray and drag-and-drop:
 *  - "hero" (new chat, reference "Cortex"): a roomy card — textarea, a tools
 *    row (left/right tool slots, mic, send) and a footer strip with Saved
 *    prompts + Attach file.
 *  - "dock" (in thread, reference "Qubi"): a pill with a dark round attach
 *    button, the textarea, saved prompts, mic and a tea-green send button.
 */
function Composer({
  variant,
  textareaRef,
  value,
  onChange,
  onKeyDown,
  onSubmit,
  busy,
  onStop,
  onSlashSelect,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onDictate,
  canSend,
  onOpenLibrary,
  leftTools,
  rightTools,
}: {
  variant: "hero" | "dock";
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  onStop: () => void;
  onSlashSelect: (text: string) => void;
  attachments: PendingAttachment[];
  onAttachFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onRetryAttachment: (id: string) => void;
  onDictate: (text: string) => void;
  canSend: boolean;
  onOpenLibrary: () => void;
  leftTools?: React.ReactNode;
  rightTools?: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const atMax = attachments.length >= MAX_FILES;

  function pickFiles() {
    fileInputRef.current?.click();
  }
  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length) onAttachFiles(e.target.files);
    e.target.value = ""; // allow re-selecting the same file
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length) onAttachFiles(e.dataTransfer.files);
  }

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

  const slashMenu = slashOpen ? (
    <div className="absolute bottom-full left-0 z-30 mb-2 max-h-[50vh] w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg motion-safe:animate-fadeUp">
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground">Templates</p>
      {matches.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => select(cmd)}
          onMouseMove={() => setActive(i)}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors",
            i === activeIdx ? "bg-accent-soft" : "hover:bg-surface-muted"
          )}
        >
          <span className="shrink-0 font-medium text-foreground">/{cmd.name}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{cmd.hint}</span>
        </button>
      ))}
    </div>
  ) : null;

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept={ACCEPTED_ACCEPT}
      onChange={onFilesChosen}
      className="hidden"
      aria-hidden="true"
      tabIndex={-1}
    />
  );

  const tray =
    attachments.length > 0 ? (
      <ul className={cn("flex flex-wrap gap-1.5", variant === "hero" ? "mb-2" : "mb-2 px-1")}>
        {attachments.map((a) => (
          <AttachmentChip
            key={a.id}
            att={a}
            onRemove={() => onRemoveAttachment(a.id)}
            onRetry={() => onRetryAttachment(a.id)}
          />
        ))}
      </ul>
    ) : null;

  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!dragging) setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Only clear when leaving the card, not when moving over a child.
      if (e.currentTarget === e.target) setDragging(false);
    },
    onDrop,
  };

  const textarea = (placeholder: string, className: string) => (
    <>
      <label htmlFor="chat-input" className="sr-only">
        Message the assistant
      </label>
      <textarea
        id="chat-input"
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={variant === "hero" ? 2 : 1}
        placeholder={placeholder}
        className={className}
      />
    </>
  );

  const stopButton = (className: string) => (
    <button
      type="button"
      aria-label="Stop generating"
      onClick={onStop}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-[#262626] text-white transition-transform duration-100 hover:bg-[#1a1a1a] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
    >
      <Square size={13} className="fill-current" />
    </button>
  );

  if (variant === "hero") {
    return (
      <form onSubmit={onSubmit} className="relative">
        {slashMenu}
        <div
          {...dragProps}
          className={cn(
            "rounded-2xl border bg-surface shadow-float transition-[border-color,box-shadow] duration-200",
            dragging
              ? "border-accent/60 ring-4 ring-accent/15"
              : "border-border focus-within:border-accent/40 focus-within:ring-4 focus-within:ring-accent/10"
          )}
        >
          {fileInput}
          <div className="px-4 pt-3">
            {tray}
            {textarea(
              "Ask me anything…  (type / for templates)",
              "block max-h-[200px] min-h-[44px] w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-subtle-foreground"
            )}
          </div>
          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">{leftTools}</div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {rightTools}
              <VoiceInput onText={onDictate} />
              {busy ? (
                stopButton("ml-1 h-8 w-8")
              ) : (
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={!canSend}
                  className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-[0_4px_12px_-4px_rgb(14_158_139/0.7)] transition-[transform,opacity,box-shadow] duration-150 hover:shadow-[0_6px_16px_-4px_rgb(14_158_139/0.9)] active:scale-95 disabled:opacity-40 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-b-2xl border-t border-border bg-accent-softer px-2.5 py-1.5">
            <button
              type="button"
              onClick={onOpenLibrary}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-accent-strong transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles size={14} className="shrink-0" aria-hidden />
              Saved prompts
            </button>
            <button
              type="button"
              onClick={pickFiles}
              disabled={atMax}
              title={atMax ? `Up to ${MAX_FILES} files` : `Attach files · ${ACCEPTED_LABEL}`}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Paperclip size={14} className="shrink-0" aria-hidden />
              Attach file
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="relative">
      {slashMenu}
      {tray}
      <div
        {...dragProps}
        className={cn(
          "flex items-end gap-1 rounded-[24px] border p-2 transition-[border-color,background-color,box-shadow] duration-200",
          dragging
            ? "border-accent/60 bg-surface ring-4 ring-accent/15"
            : "border-border bg-surface-muted focus-within:border-accent/35 focus-within:bg-surface focus-within:shadow-float"
        )}
      >
        {fileInput}
        <button
          type="button"
          onClick={pickFiles}
          disabled={atMax}
          aria-label={atMax ? `Attachment limit reached (${MAX_FILES})` : "Attach files"}
          title={atMax ? `Up to ${MAX_FILES} files` : `Attach files · ${ACCEPTED_LABEL}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#262626] text-white transition-[transform,background-color] duration-150 hover:bg-[#1a1a1a] active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Paperclip size={16} />
        </button>
        {textarea(
          "Type your prompt here…",
          "block max-h-[200px] min-h-[32px] flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 text-foreground outline-none placeholder:text-subtle-foreground"
        )}
        <div className="flex h-8 shrink-0 items-center gap-0.5">
          <IconButton
            type="button"
            aria-label="Saved prompts"
            title="Saved prompts"
            onClick={onOpenLibrary}
            className="hidden sm:inline-flex"
          >
            <Sparkles size={16} />
          </IconButton>
          <VoiceInput onText={onDictate} />
          {busy ? (
            stopButton("ml-0.5 h-8 w-8")
          ) : (
            <button
              type="submit"
              aria-label="Send message"
              disabled={!canSend}
              className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tea text-tea-foreground transition-[transform,background-color,opacity] duration-150 hover:bg-tea-hover active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

/** One attachment chip in the composer tray: name, size/status, remove/retry. */
function AttachmentChip({
  att,
  onRemove,
  onRetry,
}: {
  att: PendingAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const isError = att.status === "error";
  const isUploading = att.status === "uploading";
  // Icon + in-progress label by kind: voice notes transcribe, PDFs/images are read.
  const kind = attachmentKind(att.name);
  const KindIcon = kind === "audio" ? Mic : kind === "image" ? ImageIcon : FileText;
  return (
    <li
      className={cn(
        "group flex h-7 max-w-[240px] items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-xs",
        isError ? "border-danger/40 bg-danger/10 text-danger" : "border-border bg-surface text-foreground shadow-soft"
      )}
      title={isError ? att.error : att.truncated ? `${att.name} (trimmed to fit)` : att.name}
    >
      {isUploading ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
      ) : isError ? (
        <AlertTriangle size={14} className="shrink-0" />
      ) : (
        <KindIcon size={14} className="shrink-0 text-accent" />
      )}
      <span className={cn("truncate font-medium", isError ? "min-w-[2.5rem]" : "min-w-0")}>{att.name}</span>
      {/* The error string is long; it truncates (full text is in the chip title). */}
      <span className={cn(isError ? "min-w-0 truncate" : "shrink-0 text-muted-foreground")}>
        {isUploading ? statusLabelFor(att.name) : isError ? att.error : formatBytes(att.size)}
      </span>
      {isError && att.file && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`Retry ${att.name}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-surface-muted"
        >
          <RotateCw size={12} />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${att.name}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <X size={12} />
      </button>
    </li>
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
    <div className="w-full min-w-0 max-w-[80%] rounded-2xl border border-accent/40 bg-surface p-2 shadow-float">
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
        className="max-h-[240px] w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-foreground outline-none focus-visible:outline-none"
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
        className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {exporting ? (
          <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden />
        ) : (
          <Download size={14} className="shrink-0" aria-hidden />
        )}
        Export chat
        <ChevronDown size={12} className="shrink-0 opacity-60" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-30 mb-1.5 w-52 rounded-xl border border-border bg-surface p-1 shadow-soft-lg motion-safe:animate-fadeUp"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground">Export as</p>
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
              className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <span>{it.label}</span>
              {it.note && <span className="shrink-0 text-[11px] text-subtle-foreground">{it.note}</span>}
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
      <IconButton aria-label="Regenerate" title="Regenerate" size="sm" onClick={onRegenerate}>
        <RefreshCw size={14} />
      </IconButton>
      {available.length > 0 && (
        <button
          type="button"
          aria-label="Regenerate with a different model"
          title="Regenerate with…"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="-ml-1 inline-flex h-7 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown size={12} />
        </button>
      )}
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-1.5 max-h-[60vh] w-60 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg motion-safe:animate-fadeUp"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground">
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
              className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 truncate">{o.label}</span>
              {o.kind === "tier" && (
                <span className="shrink-0 text-[11px] text-subtle-foreground">preset</span>
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
    <div className="mt-2">
      <button
        type="button"
        onClick={() => has && setOpen((o) => !o)}
        aria-expanded={has ? open : undefined}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-xs font-medium text-muted-foreground transition-colors",
          has && "hover:text-accent-strong"
        )}
      >
        {has && (
          <ChevronRight
            size={12}
            className={cn("shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden
          />
        )}
        Grounded in {count} source{count === 1 ? "" : "s"}
      </button>
      {open && has && (
        <ul className="mt-1 space-y-1.5">
          {sources.map((s, i) => (
            <li
              key={s.id}
              className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs leading-5"
            >
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium capitalize leading-4 text-muted-foreground">
                <FileText size={12} className="shrink-0" aria-hidden />
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
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {options.map((o, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o)}
          className="min-h-8 rounded-full border border-border bg-surface px-3 py-1 text-left text-[13px] leading-5 text-foreground transition-colors hover:border-accent/40 hover:bg-accent-soft disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {o}
        </button>
      ))}
      {!otherOpen ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOtherOpen(true)}
          className="h-8 rounded-full border border-dashed border-border bg-transparent px-3 text-[13px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="flex h-8 items-center gap-1 rounded-full border border-accent/50 bg-surface pl-1.5 pr-0.5 shadow-soft"
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
            className="w-40 bg-transparent px-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <IconButton
            type="submit"
            aria-label="Send answer"
            size="sm"
            disabled={disabled || !other.trim()}
            className="h-6 w-6 bg-accent text-accent-foreground hover:bg-accent-hover hover:text-accent-foreground disabled:opacity-40"
          >
            <ArrowUp size={14} />
          </IconButton>
        </form>
      )}
    </div>
  );
}

/**
 * "Save as Organizational Learning?" — rendered under an answer when the Brain
 * detected a concrete decision / implementation / result / lesson in what the
 * user said. A human confirms before anything becomes institutional memory.
 */
function LearningCard({
  candidate,
  state,
  onSave,
  onIgnore,
}: {
  candidate: LearningCandidate;
  state: { status: "idle" | "saving" | "saved" | "ignored" | "error"; ref?: string; error?: string };
  onSave: (notes?: string) => void;
  onIgnore: () => void;
}) {
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [notes, setNotes] = useState("");
  const saved = state.status === "saved";
  return (
    <div className="mt-3 rounded-xl border border-accent/25 bg-accent-softer p-4 text-sm">
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tea text-tea-foreground" aria-hidden>
          <Lightbulb size={14} />
        </span>
        <div className="min-w-0 flex-1 pt-1">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-accent-strong">
            {saved ? "Saved as organizational learning" : "Possible organizational learning"}
            <span className="inline-flex h-5 items-center rounded-full border border-accent/30 bg-surface px-2 text-[11px] font-medium">{candidate.kind}</span>
          </p>
          <p className="mt-1 font-medium text-foreground">{candidate.title}</p>
          {candidate.change && <p className="mt-0.5 text-xs text-muted-foreground"><span className="font-medium text-foreground">Change:</span> {candidate.change}</p>}
          {candidate.observedResult && <p className="mt-0.5 text-xs text-muted-foreground"><span className="font-medium text-foreground">Observed result:</span> {candidate.observedResult}</p>}
          {(candidate.department || candidate.relatedRefs.length > 0) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {candidate.department && <>Department: <span className="text-foreground">{candidate.department}</span> · </>}
              {candidate.relatedRefs.length > 0 && <>Frameworks: <span className="text-foreground">{candidate.relatedRefs.join(", ")}</span></>}
            </p>
          )}
          {candidate.missingEvidence.length > 0 && !saved && (
            <p className="mt-1 text-xs text-warning">
              Missing evidence: {candidate.missingEvidence.join(" · ")}
            </p>
          )}
          {saved ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Recorded as <span className="font-mono text-accent-strong">{state.ref}</span>. Complete the evidence in the Brain&apos;s Learning Lab when you have the numbers.
            </p>
          ) : (
            <>
              {addingEvidence && (
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Add the evidence: date range, baseline number, new number, sample size…"
                  className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                />
              )}
              {state.status === "error" && <p className="mt-1 text-xs text-danger">{state.error}</p>}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="primary" disabled={state.status === "saving"} onClick={() => onSave(notes)}>
                  {state.status === "saving" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {addingEvidence ? "Save with evidence" : "Save as learning"}
                </Button>
                {!addingEvidence && (
                  <Button size="sm" variant="ghost" onClick={() => setAddingEvidence(true)}>
                    Add evidence
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={onIgnore}>
                  Ignore
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Right-hand evidence rail: the sources the Brain retrieved for the latest
 * answer, the verified numbers it used, and the disagreements it resolved.
 * Any knowledge ref opens the object drawer.
 */
function EvidencePanel({
  count,
  sources,
  confidence,
  conflicts = [],
  performance = [],
  onOpenRef,
  onClose,
}: {
  count: number;
  sources: SourceItem[];
  confidence?: number | null;
  conflicts?: ConflictPair[];
  performance?: PerformanceMetric[];
  onOpenRef?: (ref: string) => void;
  onClose: () => void;
}) {
  const conf = confidenceMeta(confidence);
  const refButton = (ref: string, label?: string | null) =>
    onOpenRef ? (
      <button
        type="button"
        onClick={() => onOpenRef(ref)}
        title={`Open ${ref}`}
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded font-mono text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="shrink-0">{ref}</span>
        {label ? <span className="min-w-0 truncate font-sans font-medium text-foreground">{label}</span> : null}
      </button>
    ) : (
      <span className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-accent-strong">
        <span className="shrink-0">{ref}</span>
        {label ? <span className="min-w-0 truncate font-sans font-medium text-foreground">{label}</span> : null}
      </span>
    );
  return (
    <aside
      aria-label="Evidence"
      className="hidden w-80 shrink-0 flex-col border-l border-border bg-accent-softer/60 lg:flex"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-2.5">
        <h2 className="text-sm font-semibold text-foreground">Evidence</h2>
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
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
            "flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-medium",
            conf.tone === "high" && "text-success",
            conf.tone === "medium" && "text-warning",
            conf.tone === "low" && "text-danger"
          )}
          title="How well the retrieved sources matched your question. Low confidence means the answer leaned on weaker matches — verify before relying on it."
        >
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              conf.tone === "high" && "bg-success",
              conf.tone === "medium" && "bg-warning",
              conf.tone === "low" && "bg-danger"
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
          <ul className="space-y-1.5">
            {sources.map((s, i) => (
              <li
                key={s.id}
                className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs leading-5 shadow-soft"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium capitalize leading-4 text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FileText size={12} className="shrink-0" aria-hidden />
                    <span className="truncate">
                      {i + 1}. {s.lane ? LANE_LABEL[s.lane] ?? s.lane : (s.source_type || "source").replace(/_/g, " ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 normal-case text-muted-foreground/70">
                    {s.authority && <span className="rounded-full border border-border px-1.5 leading-[14px]" title="Authority">{s.authority}</span>}
                    {s.endorsement === "practiscale_standard" && <span className="rounded-full border border-accent/40 bg-accent-soft px-1.5 leading-[14px] text-accent-strong" title="PractiScale Standard">Std</span>}
                    {s.current === false && <span className="rounded-full border border-warning/40 px-1.5 leading-[14px] text-warning" title="Historical or expired">past</span>}
                    {freshness(s.date) && <span className="whitespace-nowrap">{freshness(s.date)}</span>}
                  </span>
                </div>
                {s.ref && (
                  <p className="mb-0.5 flex min-w-0 items-center gap-1 text-xs font-medium text-foreground" title={`${s.ref} ${s.name ?? ""}`}>
                    {refButton(s.ref, s.name)}
                    {s.via === "relationship" && <span className="shrink-0 text-muted-foreground/70">· connected</span>}
                  </p>
                )}
                <p className="text-muted-foreground/90">{s.snippet || "(no preview)"}</p>
              </li>
            ))}
          </ul>
        )}

        {performance.length > 0 && (
          <section className="mt-4" aria-label="Verified numbers">
            <h3 className="px-1 text-[13px] font-semibold text-foreground">Verified numbers</h3>
            <p className="mb-1.5 px-1 text-[11px] text-muted-foreground/80">
              Structured results the Brain used as verified business data
            </p>
            <ul className="space-y-1.5">
              {performance.map((m) => {
                const period = formatPeriod(m.period_start, m.period_end);
                const dims = m.dimensions ? Object.entries(m.dimensions).filter(([, v]) => v != null && v !== "") : [];
                return (
                  <li key={m.key} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs shadow-soft">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-foreground" title={m.label}>{m.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-accent-strong">{formatMetricValue(m)}</span>
                    </div>
                    {(period || m.source) && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {period}
                        {period && m.source ? " · " : ""}
                        {m.source}
                      </p>
                    )}
                    {dims.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {dims.map(([k, v]) => (
                          <span key={k} className="rounded-full border border-border bg-surface-muted/60 px-1.5 py-px text-[11px] text-muted-foreground">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {conflicts.length > 0 && (
          <section className="mt-4" aria-label="Known disagreements">
            <h3 className="mb-1.5 px-1 text-[13px] font-semibold text-foreground">Known disagreements</h3>
            <ul className="space-y-1.5">
              {conflicts.map((p, i) => (
                <li key={`${p.a.ref}-${p.b.ref}-${i}`} className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs">
                  <p className="leading-5 text-foreground">
                    {refButton(p.a.ref)} disagrees with {refButton(p.b.ref)} — the Brain favoured the
                    higher-authority, current source
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground" title={conflictSentence(p)}>
                    {p.a.name ?? p.a.ref}{p.a.authority ? ` (${p.a.authority})` : ""} vs {p.b.name ?? p.b.ref}{p.b.authority ? ` (${p.b.authority})` : ""}
                  </p>
                  {p.note && <p className="mt-0.5 text-[11px] text-muted-foreground/90">{p.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}

/** Editor for the executive's private memory (super-admin only, /api/ceo/memory). */
/** Confirm + title an answer before submitting it to the approval queue. */
function ApprovalSubmitModal({
  open,
  title,
  onTitleChange,
  content,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  onTitleChange: (v: string) => void;
  content: string;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Submit for approval">
      <p className="text-[13px] text-muted-foreground">
        Send this answer to your workspace reviewers. You&apos;ll be notified when
        it&apos;s approved or sent back.
      </p>

      <label className="mt-3 block text-xs font-medium text-muted-foreground">
        Title
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Short label for reviewers"
          maxLength={120}
          className="mt-1.5 h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </label>

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Preview</p>
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-surface-muted/60 p-3 text-xs text-foreground/90">
          {content.slice(0, 2000) || "(empty)"}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={busy || !content.trim()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
          Submit
        </Button>
      </div>
    </Modal>
  );
}

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
        <p className="text-[13px] text-muted-foreground">
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
          className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-subtle-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={loading || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Minimum time between two reveal commits while streaming. Each commit re-renders
// the message (the last Markdown block re-parses), so ~25 commits/s keeps the
// glide smooth while capping the render work — a 60/s cadence on a long answer
// starved the main thread and, with the whole document re-parsing, ran the tab
// out of memory.
const REVEAL_INTERVAL_MS = 40;

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
    let lastCommit = 0;
    const tick = (now: number) => {
      const full = textRef.current;
      // requestAnimationFrame is paused/throttled while the tab is hidden, so if
      // a tick does run while hidden (or the text shrank on a new turn), snap to
      // the full text — the streamed answer must never freeze or blank out on a
      // tab/window switch.
      if ((typeof document !== "undefined" && document.hidden) || posRef.current > full.length) {
        posRef.current = full.length;
        setShown(full);
        lastCommit = now;
      } else if (posRef.current < full.length && now - lastCommit >= REVEAL_INTERVAL_MS) {
        // Reveal proportional to the backlog so it glides and always catches up.
        const step = Math.max(3, Math.ceil((full.length - posRef.current) / 5));
        posRef.current = Math.min(full.length, posRef.current + step);
        setShown(full.slice(0, posRef.current));
        lastCommit = now;
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
