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
  Clock,
  Columns2,
  Copy,
  Crown,
  GitBranch,
  Database,
  Gauge,
  Layers,
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
  Pause,
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
  FloatingMenu,
  useMenu,
  type SearchScopeValue,
} from "./ComposerControls";
import { DEFAULT_KNOWLEDGE_SCOPE, isKnowledgeScopeId } from "@/lib/knowledge-scopes";
import { PromptLibrary } from "./PromptLibrary";
import { BrainOrb } from "@/components/BrainOrb";
import { OrbAvatar } from "@/components/OrbAvatar";
import { PopoverMenu } from "@/components/PopoverMenu";
import { PREFS_EVENT, effectiveTimeZone, readPrefs, type ChatPrefs } from "@/lib/prefs";
import { UserAvatar } from "@/components/UserAvatar";
import { copyMarkdown } from "@/lib/copy-format";
import { cleanClipboard, type CopyNode } from "@/lib/clean-copy";
import { isoOrUndefined } from "@/lib/message-times";
import { useChatLimits } from "@/lib/chat-limits";
import {
  QUEUE_SETTLE_MS,
  abortChat,
  bindConversation,
  chatKeyFor,
  claimChat,
  clearQueue,
  dequeueTurn,
  enqueueTurn,
  finishedContent,
  getChatSession,
  handoffChat,
  hasUnsavedLocalWork,
  isKnownThread,
  leaveChat,
  markDone,
  markInflight,
  newChatId,
  noteSavedThread,
  queuedTurnBody,
  recordFinished,
  removeQueuedTurn,
  setChatTitle,
  setPreparing,
  setQueuePaused,
  takeComposerFocus,
  touchChat,
  trackedFetch,
  turnUsage,
  useChatSession,
  type QueuedTurn,
} from "@/lib/chat-sessions";
import { prepareUpload } from "@/lib/image-compress";
import {
  BRAIN_MODEL_TURNS,
  contextUsagePct,
  effectiveMessages,
  estimateTokens,
  isSummaryMessage,
  makeSummaryContent,
  planCompaction,
  recentHistory,
  shouldAutoCompact,
  summaryBody,
  turnCount,
  windowBudget,
} from "@/lib/compaction";
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
  MB,
  attachmentKind,
  isSupportedName,
  maxBytesFor,
  statusLabelFor,
  type ChatAttachment,
} from "@/lib/attachments-shared";
import {
  UI_CAPABILITY,
  acceptForKinds,
  acceptedLabelForKinds,
  capabilitySet,
  grantedAttachmentKinds,
  isAllowedAttachmentName,
} from "@/lib/capabilities-client";
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

/** The column the thread, its toolbar and the docked composer share. */
const THREAD_COL = "mx-auto w-full max-w-[58rem] px-4 sm:px-6";

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
 *
 * Chats run independently (lib/chat-sessions): each has its own key in
 * useChat's cache, so several can generate at once and leaving a chat never
 * stops its answer — a background runner (components/BackgroundChats) carries
 * it on, and re-opening the chat re-attaches to the live stream. Messages sent
 * while an answer streams are queued and sent in order after it.
 */
export function ChatView({
  conversationId = null,
  title = null,
  initialTier,
  initialMessages,
  initialInput,
}: ChatViewProps) {
  const { selection, setSelection, options, addUsage, firstName, avatarUrl, mode, setMode, modeDefs, outputType, setOutputType, capabilities, hasCap } =
    useAppShell();
  const router = useRouter();

  // What this user's capabilities allow. A control for a capability they don't
  // hold is HIDDEN (not disabled); every route enforces the same checks.
  const canScope = hasCap(UI_CAPABILITY.sourceScope);
  const canCompact = hasCap(UI_CAPABILITY.compaction);
  const canDeepAudit = hasCap(UI_CAPABILITY.deepAudit);
  const canSaveLearning = hasCap(UI_CAPABILITY.learningWrite);
  const canSeeConflicts = hasCap(UI_CAPABILITY.conflicts);
  const canSeePerformance = hasCap(UI_CAPABILITY.performance);
  const canDictate = hasCap(UI_CAPABILITY.dictation);
  // File kinds this user may attach (extract.*): the picker only offers these,
  // and the attach control is hidden when there are none.
  const attachKinds = useMemo(() => grantedAttachmentKinds(capabilitySet(capabilities)), [capabilities]);
  const attachAccept = useMemo(() => acceptForKinds(attachKinds), [attachKinds]);
  const attachLabel = useMemo(() => acceptedLabelForKinds(attachKinds), [attachKinds]);
  const canAttach = attachKinds.length > 0;

  // Workspace chat limits (admin Settings → Chat & context): context budget,
  // compaction threshold, upload sizes.
  const limits = useChatLimits();
  const limitsRef = useRef(limits);
  useEffect(() => {
    limitsRef.current = limits;
  }, [limits]);

  // Answer typeface (Settings → Appearance): a Claude-style serif by default.
  // Time zone (Settings → Appearance, default this device's): the Brain resolves
  // "today", "yesterday" and call dates in it — the CEO in the US and the team in
  // Pakistan each get their own calendar day. Undefined = the Brain's default.
  const [responseFont, setResponseFont] = useState<"serif" | "sans">("serif");
  const [timeZone, setTimeZone] = useState<string | undefined>(undefined);
  useEffect(() => {
    const apply = (p: ChatPrefs) => {
      setResponseFont(p.responseFont === "sans" ? "sans" : "serif");
      setTimeZone(effectiveTimeZone(p));
    };
    apply(readPrefs());
    const onPrefs = (e: Event) => apply((e as CustomEvent<ChatPrefs>).detail ?? readPrefs());
    window.addEventListener(PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_EVENT, onPrefs);
  }, []);
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
  // "Search in" knowledge scope (Auto / All Brain / Reality / Playbooks / …),
  // forwarded as `knowledgeScope`; access-checked server-side in /api/chat.
  const [knowledgeScope, setKnowledgeScope] = useState<string>(() => {
    const s = readPrefs().knowledgeScope;
    return isKnowledgeScopeId(s) ? s : DEFAULT_KNOWLEDGE_SCOPE;
  });
  const searchScope = useMemo<SearchScopeValue>(
    () => ({ scope: knowledgeScope, collectionIds: scopeCollectionIds }),
    [knowledgeScope, scopeCollectionIds]
  );
  const setSearchScope = useCallback((v: SearchScopeValue) => {
    setKnowledgeScope(v.scope);
    setScopeCollectionIds(v.collectionIds);
  }, []);
  // The scope fields every /api/chat call carries. Without "chat.source_scope"
  // the picker is hidden and nothing narrows the search: a scope saved in the
  // user's preferences earlier doesn't ride along (the route ignores it anyway).
  const scopeBody = useMemo(
    () =>
      canScope
        ? { knowledgeScope, ...(scopeCollectionIds.length ? { collectionIds: scopeCollectionIds } : {}) }
        : { knowledgeScope: DEFAULT_KNOWLEDGE_SCOPE },
    [canScope, knowledgeScope, scopeCollectionIds]
  );

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
      // Photos and screenshots are downscaled + re-encoded in the browser first,
      // so a large image still fits the upload limit (and uploads faster).
      const prepared = await prepareUpload(file, limitsRef.current);
      if ("error" in prepared) throw new Error(prepared.error);
      const upload = prepared.file;
      if (upload !== file) {
        setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, size: upload.size } : a)));
      }
      const fd = new FormData();
      fd.append("file", upload);
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
      // No file kind granted: the attach control is hidden, and a drop is ignored.
      if (list.length === 0 || attachKinds.length === 0) return;
      const lim = limitsRef.current;
      let room = lim.maxFiles - attachmentsRef.current.length;
      const additions: PendingAttachment[] = [];
      for (const file of list) {
        if (room <= 0) break;
        const id = `att-${attachIdRef.current++}`;
        if (!isSupportedName(file.name)) {
          additions.push({ id, name: file.name, size: file.size, status: "error", error: `Unsupported type · accepts ${attachLabel}` });
          continue;
        }
        // A supported type this user's capabilities don't cover (/api/attachments re-checks).
        if (!isAllowedAttachmentName(file.name, attachKinds)) {
          additions.push({ id, name: file.name, size: file.size, status: "error", error: `That file type isn't enabled for your account · accepts ${attachLabel}` });
          continue;
        }
        // Images may be larger: they're optimised before upload. Everything
        // else must fit the workspace file limit (and the kind's own cap).
        const maxBytes =
          attachmentKind(file.name) === "image"
            ? lim.maxImageMb * MB
            : Math.min(maxBytesFor(file.name), lim.maxFileMb * MB);
        if (file.size > maxBytes) {
          additions.push({ id, name: file.name, size: file.size, status: "error", error: `Too large · max ${Math.round(maxBytes / MB)} MB` });
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
    [uploadAttachment, attachKinds, attachLabel]
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
      ...scopeBody,
      ...(timeZone ? { timeZone } : {}),
    }),
    [selection.value, mode, activeConversationId, scopeBody, outputType, timeZone]
  );

  // The chat's key for useChat's cache and the session store (lib/chat-sessions):
  // the saved thread's id, or — a brand-new chat — an id minted for this mount,
  // which the pre-create in submit() asks the server to give the new row. A
  // stream keeps writing under this key after navigation, so re-opening the
  // chat re-attaches to it live (same message, still streaming, Stop works).
  const [chatId] = useState(() => (conversationId ? chatKeyFor(conversationId) : newChatId()));

  // useChat throttles message-state updates (experimental_throttle below) but
  // flips `status` synchronously, so the last rendered assistant turn can lag
  // the finished one by a chunk. onFinish hands over the COMPLETE message; it's
  // kept per chat (recordFinished) so persistence never saves a truncated
  // answer — whichever instance (this view, an earlier one, a background
  // runner) started the request.

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
    id: chatId,
    api: "/api/chat",
    // Registers each request's abort handle under the chat, so Stop works on a
    // stream this view re-attached to (started by an earlier view or a runner).
    fetch: trackedFetch(chatId),
    body: chatBody,
    initialMessages: initialMessages ?? [],
    // Seeded from `/?prompt=` (only read on mount; a later prompt on the same
    // mounted page is applied by the effect below).
    initialInput: initialInput ?? "",
    // Coalesce stream chunks into at most ~20 state updates/s: a fast model can
    // deliver 60+ chunks/s and each one re-rendered this whole view. The reveal
    // effect below smooths the visible text between updates anyway.
    experimental_throttle: 50,
    // Captured when a request starts, so it runs (once) even if this view has
    // unmounted by the time the answer finishes: usage is metered exactly once.
    onFinish: (message, { usage: u }) => {
      recordFinished(chatId, message.id, message.content ?? "");
      // Prefer the exact token counts from the stream's finish part; fall back
      // to a rough estimate only when the stream omitted usage.
      addUsage(turnUsage(message.content, u));
    },
  });

  const busy = status === "submitted" || status === "streaming";
  // `busy` for callbacks that must not go stale: compaction must never splice a
  // summary into a list while an answer streams (useChat's next chunk would
  // drop it). Declared before the status effect below so it's current there.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // The latest messages, for callbacks that must not go stale (saves, compaction).
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // --- Ownership (lib/chat-sessions) ---------------------------------------
  // On screen, this view owns the chat: a background runner for it steps aside
  // (the live stream keeps writing to the same cache entry, so nothing is lost).
  // Leaving with work pending — an answer streaming, a send being prepared,
  // turns queued — hands the chat to a runner that finishes it off screen.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    claimChat(chatId);
    return () => {
      mountedRef.current = false;
      leaveChat(chatId);
    };
  }, [chatId]);

  // Re-opened while this tab still holds the chat in useChat's cache (it was
  // generating, or sending queued turns, in the background). Which copy wins:
  //   - saved rows this tab has already seen (loaded before, or saved itself)
  //     aren't news — e.g. a back/forward navigation renders the page from
  //     Next's router cache — so the cached thread stays;
  //   - while this tab may hold turns the server doesn't have yet (generating,
  //     or inside the server-save window), the cached thread stays unless the
  //     saved one has more turns;
  //   - otherwise the saved rows win whenever they differ: another tab or
  //     device regenerated, edited or added turns.
  // Never mid-answer.
  useEffect(() => {
    const s = getChatSession(chatId);
    const saved = initialMessages ?? [];
    const savedRows = saved.map((m) => ({ role: m.role, content: m.content }));
    const news = !isKnownThread(chatId, savedRows);
    noteSavedThread(chatId, savedRows);
    if (!news || busyRef.current || s.inflight || s.preparing) return;
    const cur = messagesRef.current;
    if (hasUnsavedLocalWork(chatId)) {
      if (cur.length < saved.length) setMessages(saved);
      return;
    }
    const mine = cur.filter((m) => ROLES_TO_PERSIST.has(m.role));
    const same =
      mine.length === saved.length &&
      mine.every((m, i) => m.role === saved[i].role && m.content === saved[i].content);
    if (!same) setMessages(saved);
    // Mount-only: a later server render never overwrites the live thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The chat's saved id + title, for the sidebar spinner and the "answer
  // ready" notice when it finishes off screen.
  useEffect(() => {
    if (conversationId) bindConversation(chatId, conversationId);
  }, [chatId, conversationId]);
  const firstUserText = useMemo(() => messages.find((m) => m.role === "user")?.content ?? null, [messages]);
  useEffect(() => {
    setChatTitle(chatId, title ?? firstUserText);
  }, [chatId, title, firstUserText]);

  // Re-opened mid-answer: that answer continues on screen from where it is
  // (StreamingMarkdown `resume`) instead of re-typing from the start.
  const [resumedId] = useState<string | null>(() => {
    const last = messages[messages.length - 1];
    return busy && last?.role === "assistant" ? last.id : null;
  });

  // Turns the user sent while an answer was streaming (sent in order after it).
  const session = useChatSession(chatId);
  const queue = session.queue;
  const queuePaused = session.paused;

  // Live activity from the Brain's status/sources data events (see /api/v1/chat).
  // `data` is reset at the start of each send, so it only reflects the current turn.
  // Events for a capability the user doesn't hold (source disagreements,
  // performance numbers, learning candidates) are dropped here, so they never
  // render (hiding only; withholding them is the server's job).
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
      const pairs = canSeeConflicts ? parseConflictsEvent(it) : null;
      if (pairs) conflicts = pairs;
      const metrics = canSeePerformance ? parsePerformanceEvent(it) : null;
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
      if (canSaveLearning && it?.type === "learning_candidate" && typeof it.title === "string") {
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
  }, [data, canSeeConflicts, canSeePerformance, canSaveLearning]);

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
  const fullContent = useCallback(
    (m: Message): string => {
      const fin = finishedContent(chatId, m.id);
      return fin !== null && fin.length > m.content.length ? fin : m.content;
    },
    [chatId]
  );

  // --- Persist a turn once streaming settles -----------------------------
  // Saves are chained, so a compaction save can't race (or be dropped by) the
  // end-of-turn save; each writes the full list it was handed. A failed save is
  // shown (never swallowed); the next save retries with the full list.
  const [saveError, setSaveError] = useState<string | null>(null);
  // A deep audit that couldn't start while an answer was streaming.
  const [auditError, setAuditError] = useState<string | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const persistMessages = useCallback(
    (list: Message[]) => {
      const run = () => saveList(list);
      const next = saveChainRef.current.then(run, run);
      saveChainRef.current = next;
      return next;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection.tier, fullContent]
  );

  async function saveList(list: Message[]) {
    const toSave = list.filter((m) => ROLES_TO_PERSIST.has(m.role));
    if (toSave.length === 0) return;

    const wasNew = conversationIdRef.current === null;
    const rows = toSave.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: fullContent(m),
      createdAt: isoOrUndefined(m.createdAt),
    }));
    try {
      const result = await saveConversationTurn({
        conversationId: conversationIdRef.current,
        // Persist the tier bucket (a checked enum), derived from the selection.
        tier: selection.tier,
        messages: rows,
      });
      if (!result.ok) {
        setSaveError("This conversation couldn't be saved. Your latest messages may be missing if you reload.");
        return;
      }
      // What the server now holds: not news when this chat is re-opened.
      noteSavedThread(chatId, rows);
      setSaveError(null);
      conversationIdRef.current = result.conversationId;
      setActiveConversationId(result.conversationId);
      bindConversation(chatId, result.conversationId);
      // Tell the shell to add (or re-title) this thread in the sidebar now,
      // without a router refresh that would remount and flash the stream.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("chat:saved", {
            detail: { id: result.conversationId, title: result.title, created: wasNew },
          })
        );
      }
      // (Only while this view is on screen: a save that resolves after the
      // user navigated away must not rewrite the URL of the page they're on.)
      if (wasNew && mountedRef.current) {
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
      // The conversation still works if persistence fails, but say so (e.g. a
      // body over the Server Action limit) instead of losing turns silently.
      setSaveError("This conversation couldn't be saved. Your latest messages may be missing if you reload.");
    } finally {
      // Starts the window in which this tab's copy may be ahead of the saved rows.
      touchChat(chatId);
    }
  }

  const persistTurn = useCallback(() => persistMessages(messagesRef.current), [persistMessages]);

  // --- Context window: compaction ------------------------------------------
  // Folds the earlier turns into one summary message placed where the chat was
  // compacted. The thread still shows everything; /api/chat only forwards the
  // latest summary + the turns after it (lib/compaction).
  const [compacting, setCompacting] = useState(false);
  const compactingRef = useRef(false);
  const [compactNote, setCompactNote] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [compactDismissedAt, setCompactDismissedAt] = useState<number | null>(null);

  const compact = useCallback(
    async (trigger: "manual" | "auto") => {
      // Every trigger is hidden without "chat.compaction" (/api/compact re-checks).
      // Never while an answer streams: the splice would be lost (see busyRef).
      if (compactingRef.current || busyRef.current || !canCompact) return;
      const list = messagesRef.current;
      const plan = planCompaction(list);
      if (!plan) {
        if (trigger === "manual") {
          setCompactNote({ tone: "info", text: "Nothing to compact yet. The conversation is still short." });
        }
        return;
      }
      compactingRef.current = true;
      setCompacting(true);
      setCompactNote(null);
      try {
        const res = await fetch("/api/compact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Bounded well under the ~4.5 MB request limit: at most 200 turns
          // (an earlier summary always kept), each clipped head + tail.
          body: JSON.stringify({
            timeZone: effectiveTimeZone(readPrefs()),
            messages: boundForCompaction(plan.summarize).map((m) => ({
              role: m.role,
              content: clipMiddle(fullContent(m), 12_000),
            })),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { summary?: string; error?: string };
        const summary = typeof json.summary === "string" ? json.summary.trim() : "";
        if (!res.ok || !summary) throw new Error(json.error || "The summary came back empty.");
        // Sending is blocked while compacting, so the list should be unchanged;
        // if it moved anyway (e.g. a regenerate), or an answer is streaming (its
        // next chunk would drop the summary), don't splice into a stale copy.
        // Nor once this view has left: its refs stopped following the chat, and
        // a runner may have sent queued turns on the shared cache entry since.
        const cur = messagesRef.current;
        if (
          !mountedRef.current ||
          busyRef.current ||
          cur.length !== list.length ||
          cur[plan.insertAt - 1]?.id !== list[plan.insertAt - 1]?.id
        ) {
          return;
        }
        const summaryMsg: Message = {
          id: `summary-${Date.now().toString(36)}`,
          role: "system",
          content: makeSummaryContent(summary),
          createdAt: new Date(),
        };
        const next = [...cur.slice(0, plan.insertAt), summaryMsg, ...cur.slice(plan.insertAt)];
        messagesRef.current = next;
        setMessages(next);
        setCompactDismissedAt(null);
        void persistMessages(next);
      } catch (e) {
        setCompactNote({
          tone: "error",
          text: `Couldn't compact the conversation. ${e instanceof Error ? e.message : ""}`.trim(),
        });
      } finally {
        compactingRef.current = false;
        setCompacting(false);
      }
    },
    [fullContent, persistMessages, setMessages, canCompact]
  );

  // Clear an informational note after a moment.
  useEffect(() => {
    if (compactNote?.tone !== "info") return;
    const t = window.setTimeout(() => setCompactNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [compactNote]);

  // An answer settled (streaming -> ready / error; covers Stop too): mirror it
  // into the session store, persist a real answer, and hold the queue after a
  // failure. "Was in flight" also comes from the store: a queued send can fail
  // before it ever renders as busy, and an answer can settle while no view
  // was mounted (this chat re-opened right after).
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    const wasInflight = getChatSession(chatId).inflight;
    if (busy) {
      markInflight(chatId);
      return;
    }
    markDone(chatId);
    if (!(was === "streaming" || was === "submitted" || wasInflight)) return;
    if (status === "error") {
      // The queued turns wait for the user ("Send now" / "Clear").
      setQueuePaused(chatId, true);
      return;
    }
    if (status !== "ready") return;
    const last = messages[messages.length - 1];
    // Only persist a real answer. An empty assistant turn (upstream 200 that
    // errored mid-stream and yielded no tokens) must NOT be saved, or the thread
    // would reload blank forever.
    if (last?.role === "assistant" && fullContent(last).trim()) {
      void persistTurn();
      // Auto-compact once the chat crosses the workspace threshold of the
      // window the Brain actually keeps (tokens or turns), and only when folding
      // frees a meaningful share of it — never a summary of a summary per
      // answer (only for users with "chat.compaction").
      const lim = limitsRef.current;
      if (
        canCompact &&
        lim.autoCompact &&
        shouldAutoCompact(messagesRef.current, lim.contextWindowTokens, lim.compactAtPct)
      ) {
        void compact("auto");
      }
    }
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
  // For controls that unmount (or disable) themselves when pressed — Queue,
  // Stop, the paused bar, a chip: focus moves on to the composer instead of
  // falling to <body>.
  const focusComposer = useCallback(() => requestAnimationFrame(() => taRef.current?.focus()), []);

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
    // Attachments finish uploading first; compaction splices the list, so
    // nothing is sent (or queued) under it.
    if (uploading || compactingRef.current) return;
    if (!hasText && ready.length === 0) return;
    setAuditError(null);
    const t = input.trim().toLowerCase();
    // An audit phrase starts a background job only for users with
    // "jobs.deep_audit"; anyone else's message is sent as a normal chat turn.
    const isDeepAudit =
      canDeepAudit &&
      hasText &&
      (t.includes("deep audit") ||
        t.includes("full audit") ||
        t.includes("thorough audit") ||
        t.includes("detailed audit") ||
        t.includes("audit all") ||
        t.includes("audit every") ||
        t.includes("audit each") ||
        ((t.includes("all") || t.includes("every")) && t.includes("read") && t.includes("transcript")));
    // Deep-audit phrases start their background job right away — never queued,
    // even while an answer streams.
    if (isDeepAudit) {
      const query = input.trim();
      setInput("");
      const auditFailed = (text: string) => {
        // Never from a view that has left: its hook's messages are stale and
        // share the chat's cache entry (an append would overwrite the thread).
        if (!mountedRef.current) return;
        // Mid-answer, an assistant note appended now would start a second
        // request in this chat; say it beside the composer instead.
        if (busyRef.current) setAuditError(text);
        else void append({ role: "assistant", content: text }, { body: chatBody });
      };
      void (async () => {
        try {
          const res = await fetch("/api/jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            // Recent turns (and any compaction summary) so "audit them" inherits
            // the filters discussed earlier, e.g. "yesterday's calls".
            body: JSON.stringify({
              query,
              history: recentHistory(messagesRef.current),
              timeZone: effectiveTimeZone(readPrefs()),
            }),
          });
          const json = (await res.json().catch(() => ({}))) as { job?: { id: string; title: string }; error?: string };
          const jb = json.job;
          if (res.ok && jb) setAudits((prev) => [{ id: jb.id, title: jb.title, startedAt: Date.now() }, ...prev]);
          else auditFailed(json.error ? `I couldn't start that audit: ${json.error}` : "I couldn't start that audit.");
        } catch {
          auditFailed("I couldn't start that audit (network error).");
        }
      })();
      return;
    }
    const payload: ChatAttachment[] = ready.map((a) => ({ name: a.name, text: a.text as string }));
    // The user message this turn sends (a default naming the files when there's
    // no question), reused as the title/first turn when pre-creating a new thread.
    const firstText = hasText
      ? input.trim()
      : `Please review the attached file${ready.length > 1 ? "s" : ""}: ${ready.map((a) => a.name).join(", ")}`;

    // An answer is streaming: queue this turn (with the settings chosen now and
    // its uploaded attachments). It's sent, in order, once the current answer
    // finishes — by this view, or by a background runner if the user has left
    // the chat by then. Likewise while earlier queued turns are still waiting
    // to go out (the settle gap between answers), so turns keep the order they
    // were typed in. (A queue held after Stop or an error keeps waiting for
    // "Send now"; a message typed then is sent right away.)
    const pending = getChatSession(chatId);
    if (busy || (pending.queue.length > 0 && !pending.paused)) {
      enqueueTurn(chatId, { text: firstText, attachments: payload, body: chatBody });
      setInput("");
      setAttachments([]);
      attachStartedRef.current.clear();
      stickRef.current = true;
      focusComposer(); // the Queue button disables once the input clears
      return;
    }
    stickRef.current = true;
    setData(undefined); // clear last turn's status/sources so `activity` is per-turn

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
    //
    // The row is created with THIS chat's id (chatId), so the saved thread and
    // the in-browser stream share one key: /c/[id] re-attaches to the stream.
    // The server may answer with another id (the requested one was taken); the
    // chat keeps working under its key and the store maps the two.
    let convId = conversationIdRef.current;
    if (convId === null) {
      if (preCreatingRef.current) return; // a create is already in flight
      preCreatingRef.current = true;
      setPreparing(chatId, true);
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: chatId, tier: selection.tier, messages: [{ role: "user", content: firstText }] }),
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
          bindConversation(chatId, id);
          noteSavedThread(chatId, [{ role: "user", content: firstText }]);
          window.dispatchEvent(
            new CustomEvent("chat:saved", {
              detail: { id, title: json.conversation?.title ?? firstText.slice(0, 80), created: true },
            })
          );
          // Not after the user navigated away: that page's URL isn't ours.
          if (mountedRef.current) window.history.replaceState(null, "", `/c/${id}`);
        }
      } catch {
        // Pre-create failed — fall back to an unscoped turn. The client's own
        // onFinish save still persists it in the normal (no-navigation) case.
      } finally {
        preCreatingRef.current = false;
      }
      if (!mountedRef.current) {
        // The user left while the thread was being created: the background
        // runner sends this first turn (ahead of anything queued since).
        enqueueTurn(
          chatId,
          { text: firstText, attachments: payload, body: { ...chatBody, conversationId: convId } },
          { front: true }
        );
        handoffChat(chatId);
        setPreparing(chatId, false);
        return;
      }
    }

    const withId = convId === chatBody.conversationId ? chatBody : { ...chatBody, conversationId: convId };
    const body = payload.length ? { ...withId, attachments: payload } : withId;
    // In flight from now (the sidebar spinner, and a hand-off if the user
    // leaves before useChat reports the request as submitted).
    markInflight(chatId);
    setPreparing(chatId, false);
    if (hasText) {
      handleSubmit(undefined, { body });
    } else {
      void append({ role: "user", content: firstText }, { body });
    }
    setAttachments([]);
    attachStartedRef.current.clear();
  }, [input, busy, handleSubmit, append, chatBody, setData, setInput, selection.tier, canDeepAudit, chatId, focusComposer]);

  // --- Queued turns -----------------------------------------------------------
  // useChat's callbacks change identity every render; the flush timer reads these.
  const appendRef = useRef(append);
  useEffect(() => {
    appendRef.current = append;
  }, [append]);

  /** Send the next queued turn, if this chat is idle and the queue isn't held. */
  const flushNext = useCallback(() => {
    if (busyRef.current || compactingRef.current || preCreatingRef.current) return;
    const s = getChatSession(chatId);
    if (s.paused || s.inflight || s.preparing) return;
    const turn = dequeueTurn(chatId);
    if (!turn) return;
    markInflight(chatId);
    stickRef.current = true;
    setData(undefined);
    void appendRef.current(
      { role: "user", content: turn.text },
      { body: queuedTurnBody(turn, conversationIdRef.current) }
    );
  }, [chatId, setData]);
  const flushNextRef = useRef(flushNext);
  useEffect(() => {
    flushNextRef.current = flushNext;
  }, [flushNext]);

  // The reload/resend paths below wait for a running compaction: a new stream
  // started now would race its splice (and drop the summary).
  const regenerate = useCallback(() => {
    if (compactingRef.current) return;
    stickRef.current = true;
    setData(undefined);
    reload({ body: chatBody });
  }, [reload, chatBody, setData]);

  // Regenerate the last answer with a DIFFERENT model (also makes it the
  // selection going forward, like the top-bar switcher).
  const regenerateWith = useCallback(
    (value: string, tier: ModelTier) => {
      if (compactingRef.current) return;
      const opt = options.find((o) => o.value === value) ?? tierPreset(tier);
      setSelection(opt);
      stickRef.current = true;
      setData(undefined);
      reload({ body: { model: value, tier: value, mode, ...scopeBody, ...(timeZone ? { timeZone } : {}) } });
    },
    [options, setSelection, reload, setData, mode, scopeBody, timeZone]
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
        else setSaveError("Couldn't create the branch. Try again.");
      } catch {
        setSaveError("Couldn't create the branch. Try again.");
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
    // Exactly what the main thread sent for that question: the latest summary
    // (a compacted chat's earlier context) plus every turn after it.
    return effectiveMessages(messages.slice(0, lastUser + 1))
      .filter((m) => m.role === "user" || m.role === "assistant" || isSummaryMessage(m))
      .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));
  }, [messages]);

  // Recovery path: switch to the Recommended tier (always available, Brain-
  // resolved) and retry. Useful when a specific model failed for this turn.
  const retryWithRecommended = useCallback(() => {
    if (compactingRef.current) return;
    const rec = tierPreset("recommended");
    setSelection(rec);
    stickRef.current = true;
    setData(undefined);
    reload({ body: { model: rec.value, tier: rec.value, mode, ...scopeBody, ...(timeZone ? { timeZone } : {}) } });
  }, [setSelection, reload, setData, mode, scopeBody, timeZone]);

  // Send a picked option (or an "Other" answer) as the next user message.
  const pickOption = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || busy || compactingRef.current) return;
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
      // Don't truncate under a running compaction (it splices into this list).
      if (idx === -1 || !text || compactingRef.current) return;
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
    // Waits for a running compaction to finish (re-runs when `compacting` flips).
    if (pendingSend == null || status !== "ready" || compacting) return;
    const content = pendingSend;
    setPendingSend(null);
    void append({ role: "user", content }, { body: chatBody });
  }, [pendingSend, status, compacting, append, chatBody]);

  // Send the next queued turn once the chat is idle: the answer settled (and
  // its save started), no compaction or edit-resend is pending, and the queue
  // isn't held. The settle delay lets useChat's last throttled update land
  // first, so the next request carries the full answer.
  useEffect(() => {
    if (busy || compacting || pendingSend != null || queuePaused || queue.length === 0) return;
    if (session.inflight || session.preparing) return;
    const timer = window.setTimeout(() => flushNextRef.current(), QUEUE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [busy, compacting, pendingSend, queuePaused, queue.length, session.inflight, session.preparing]);

  // Stop the answer — whichever instance started it (this view, an earlier
  // one, or a background runner) — and hold any queued turns for the user.
  const stopAnswer = useCallback(() => {
    stop();
    abortChat(chatId);
    setQueuePaused(chatId, true);
    focusComposer(); // Stop unmounts once the answer settles
  }, [stop, chatId, focusComposer]);
  // Each of these unmounts the control it was pressed on (the paused bar, a
  // chip), so focus moves on to the composer (focusComposer).
  const sendQueuedNow = useCallback(() => {
    setQueuePaused(chatId, false);
    focusComposer();
  }, [chatId, focusComposer]);
  const clearQueued = useCallback(() => {
    clearQueue(chatId);
    focusComposer();
  }, [chatId, focusComposer]);
  const removeQueued = useCallback(
    (turnId: string) => {
      removeQueuedTurn(chatId, turnId);
      focusComposer();
    },
    [chatId, focusComposer]
  );
  // Opened from an "Answer ready" notice: its button unmounted, so focus lands
  // in this chat's composer.
  useEffect(() => {
    if (takeComposerFocus(conversationId)) focusComposer();
  }, [conversationId, focusComposer]);

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

  // --- Clean copy for selected text ------------------------------------------
  // A selection copied with Ctrl+C would otherwise carry the page theme
  // (light text on a dark block in dark mode). Rebuild the clipboard from the
  // selected structure instead: clean HTML + plain text with tables as TSV.
  const onThreadCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('textarea, input, [contenteditable="true"]')) return;
    try {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < sel.rangeCount; i++) frag.appendChild(sel.getRangeAt(i).cloneContents());
      const anchor = sel.getRangeAt(0).commonAncestorContainer;
      const el = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
      // Inside a code block or a user's multi-line prompt: copy verbatim.
      const context = el?.closest("pre")
        ? "pre"
        : el?.closest('[class*="whitespace-pre"]')
          ? "pre-wrap"
          : el?.closest("tr")
            ? "table-row"
            : el?.closest("table")
              ? "table"
              : el?.closest("ol")
                ? "ol"
                : el?.closest("ul")
                  ? "ul"
                  : null;
      const { html, text } = cleanClipboard(frag as unknown as CopyNode, context);
      if (!text.trim()) return;
      e.clipboardData.setData("text/html", html);
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
    } catch {
      // Fall back to the browser's own copy.
    }
  }, []);

  // --- Copy-to-clipboard for assistant messages --------------------------
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Answers copy as clean text + real tables (HTML for Docs/Word/Gmail, TSV for
  // Sheets/Excel), never raw markdown; the user's own messages copy verbatim.
  const copy = useCallback(async (id: string, text: string, rich = false) => {
    let ok = false;
    if (rich) {
      ok = await copyMarkdown(text);
    } else {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        // Clipboard may be unavailable (e.g. insecure context) — ignore.
      }
    }
    if (!ok) return;
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
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
      const turns = messages.filter((m) => !isSummaryMessage(m)) as unknown as ExportMessage[];
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

  // Context window usage: what the model will see (latest summary onward),
  // measured against the window the Brain actually keeps — tokens (capped at
  // its ~30k) or its 40-turn cap, whichever is fuller (lib/compaction).
  const { contextTokens, contextTurns } = useMemo(() => {
    const eff = effectiveMessages(messages);
    return { contextTokens: estimateTokens(eff), contextTurns: turnCount(eff) };
  }, [messages]);
  const contextBudget = windowBudget(limits.contextWindowTokens);
  const contextPct = useMemo(
    () => contextUsagePct(messages, limits.contextWindowTokens),
    [messages, limits.contextWindowTokens]
  );
  const showCompactBanner =
    canCompact &&
    !empty &&
    !compacting &&
    contextPct >= limits.compactAtPct &&
    (!limits.autoCompact || compactNote?.tone === "error") &&
    (compactDismissedAt === null || contextPct >= compactDismissedAt + 10);

  const attachUploading = attachments.some((a) => a.status === "uploading");
  const attachReadyCount = attachments.filter((a) => a.status === "ready").length;
  const canSend = (input.trim().length > 0 || attachReadyCount > 0) && !attachUploading && !compacting;

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
    onStop: stopAnswer,
    onSlashSelect: prefill,
    attachments,
    onAttachFiles: addFiles,
    onRemoveAttachment: removeAttachment,
    onRetryAttachment: retryAttachment,
    // null hides the attach control (no extract.* file kind granted).
    attachAccept: canAttach ? attachAccept : null,
    attachLabel,
    onDictate: canDictate ? insertDictation : null,
    canSend,
    maxFiles: limits.maxFiles,
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
          {canScope && <SourceScopePicker value={searchScope} onChange={setSearchScope} iconOnly align="right" />}
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
        {canScope && <SourceScopePicker value={searchScope} onChange={setSearchScope} size="sm" iconOnly />}
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
        <ContextMeter
          used={contextTokens}
          budget={contextBudget}
          pct={contextPct}
          turns={contextTurns}
          maxTurns={BRAIN_MODEL_TURNS}
          threshold={limits.compactAtPct}
          autoCompact={limits.autoCompact}
          compacting={compacting}
          disabled={busy}
          onCompact={canCompact ? () => void compact("manual") : null}
        />
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
              <BrainOrb size={140} active={input.trim().length > 0} className="-mb-3" />
              <h2 className="font-serif text-[28px] font-normal leading-[1.2] tracking-[-0.01em] sm:text-[34px]">
                <span className="text-greeting-gradient">Hello, {titleCase(firstName)}</span>
              </h2>
              <p className="font-serif text-[28px] font-medium leading-[1.2] tracking-[-0.015em] text-foreground sm:text-[34px]">
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
            <div ref={scrollRef} onScroll={onScroll} onCopy={onThreadCopy} className="flex-1 overflow-y-auto">
              <div className={cn(THREAD_COL, "pb-6 pt-5")}>
                {/* Remembered audit cards poll /api/jobs/[id], which needs the same capability. */}
                {canDeepAudit && audits.length > 0 && (
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
                <ul className="space-y-6">
                  {messages.map((m, idx) => {
                    const time = hydrated ? messageTime(m) : null;
                    const streamingThis = idx === lastIndex && busy;

                    if (isSummaryMessage(m)) {
                      let folded = 0;
                      for (let j = idx - 1; j >= 0 && !isSummaryMessage(messages[j]); j--) {
                        if (messages[j].role === "user" || messages[j].role === "assistant") folded++;
                      }
                      return (
                        <li key={m.id}>
                          <CompactionDivider summary={summaryBody(m)} count={folded} />
                        </li>
                      );
                    }

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
                              <UserAvatar name={firstName} avatarUrl={avatarUrl} size={28} className="mt-0.5" />
                            </div>
                          ) : (
                            <div className="group flex items-start justify-end gap-2.5">
                              <div className="flex min-w-0 max-w-[80%] flex-col items-end">
                                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-accent-soft px-4 py-2.5 text-[15px] leading-[1.6] text-foreground">
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
                              <UserAvatar name={firstName} avatarUrl={avatarUrl} size={28} className="mt-0.5" />
                            </div>
                          )}
                        </li>
                      );
                    }

                    const { text, options: choices } = parseOptions(m.content);
                    const approved = approvedIds.has(m.id);
                    // Answers read as plain, full-width text (no bubble), in the
                    // chosen answer typeface; tables/code bring their own sans/mono.
                    return (
                      <li key={m.id}>
                        <div className="group">
                          <div className="min-w-0">
                            <div
                              className={cn(
                                "min-w-0 text-[15px] leading-[1.7] text-foreground",
                                responseFont === "sans" ? "font-sans" : "font-serif"
                              )}
                            >
                              <StreamingMarkdown content={text} animate={streamingThis} resume={m.id === resumedId} />
                              {idx === lastIndex && !busy && choices.length > 0 && (
                                <div className="font-sans text-sm leading-6">
                                  <OptionsPicker options={choices} onPick={pickOption} disabled={busy} />
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
                            {canSaveLearning && manualLearning?.messageId === m.id ? (
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
                                  "-ml-1.5 mt-1.5 flex items-center gap-0.5 transition-opacity",
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
                                  onClick={() => copy(m.id, fullContent(m), true)}
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
                                    ...(canSaveLearning
                                      ? [
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
                                        ]
                                      : []),
                                    { label: "Branch from here", icon: GitBranch, onSelect: () => branch(idx), disabled: branching },
                                    ...(idx === lastIndex && !busy
                                      ? [{ label: "Compare with another model", icon: Columns2, onSelect: () => setCompareOpen(true) }]
                                      : []),
                                  ]}
                                />
                                {time && <MessageTime label={time} className="ml-1.5" />}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}

                  {/* Awaiting the first streamed token: the orb pulses beside a
                      typing indicator and the live pipeline stage. */}
                  {compacting && (
                    <li aria-live="polite" className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Loader2 size={14} className="shrink-0 animate-spin text-accent" aria-hidden />
                      Compacting earlier messages into a summary…
                    </li>
                  )}

                  {status === "submitted" && (
                    <li aria-live="polite" aria-label="Assistant is working" className="flex items-start gap-2.5">
                      <OrbAvatar size={24} active className="mt-0.5 shrink-0" />
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
                {showCompactBanner && (
                  <div
                    role="status"
                    className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-foreground"
                  >
                    <Gauge size={14} className="shrink-0 text-warning" aria-hidden />
                    <span className="min-w-0 flex-1">
                      This chat is using {contextPct}% of its context window. Compacting summarizes the earlier
                      messages so answers stay sharp.
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {/* Both actions unmount this banner, so focus moves on to
                          the composer instead of falling to <body>. Compacting
                          waits while an answer streams (see compact()). */}
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          void compact("manual");
                          requestAnimationFrame(() => taRef.current?.focus());
                        }}
                      >
                        Compact now
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCompactDismissedAt(contextPct);
                          requestAnimationFrame(() => taRef.current?.focus());
                        }}
                      >
                        Not now
                      </Button>
                    </span>
                  </div>
                )}
                {saveError && (
                  <p role="alert" className="mb-2 px-1 text-[12px] text-danger">
                    {saveError}
                  </p>
                )}
                {auditError && (
                  <p role="alert" className="mb-2 px-1 text-[12px] text-danger">
                    {auditError}
                  </p>
                )}
                {compactNote && (
                  <p
                    role={compactNote.tone === "error" ? "alert" : "status"}
                    className={cn(
                      "mb-2 px-1 text-[12px]",
                      compactNote.tone === "error" ? "text-danger" : "text-muted-foreground"
                    )}
                  >
                    {compactNote.text}
                  </p>
                )}
                {toolbar}
                <QueuedTurns
                  items={queue}
                  paused={queuePaused}
                  onRemove={removeQueued}
                  onSendNow={sendQueuedNow}
                  onClear={clearQueued}
                />
                <Composer {...composerCore} variant="dock" />
                <p className="mt-1.5 hidden text-center text-[11px] text-subtle-foreground sm:block">
                  Grounded in your knowledge base · Enter to send, Shift+Enter for a new line
                </p>
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

/** At most 200 turns for /api/compact, keeping a leading earlier summary. */
function boundForCompaction<T extends { role: string; content: string }>(list: T[]): T[] {
  if (list.length <= 200) return list;
  return isSummaryMessage(list[0]) ? [list[0], ...list.slice(-199)] : list.slice(-200);
}

/** Keep the start and end of a very long message (the middle matters least). */
function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.66);
  return `${text.slice(0, head)}
…
${text.slice(text.length - (max - head))}`;
}

/** "12.3k" style token counts. */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
}

/**
 * Context-window meter for the thread toolbar: a small ring + percentage that
 * opens the details (tokens used of the budget, the auto-compact setting) and
 * a "Compact now" action. `onCompact: null` (no "chat.compaction") keeps the
 * meter but drops the compaction line and action.
 */
function ContextMeter({
  used,
  budget,
  pct,
  turns,
  maxTurns,
  threshold,
  autoCompact,
  compacting,
  disabled,
  onCompact,
}: {
  used: number;
  budget: number;
  /** Share of the window used (lib/compaction contextUsagePct: tokens or turns, whichever is higher). */
  pct: number;
  turns: number;
  maxTurns: number;
  threshold: number;
  autoCompact: boolean;
  compacting: boolean;
  disabled: boolean;
  onCompact: (() => void) | null;
}) {
  const { open, setOpen, ref, triggerRef, itemsRef, menuRef, close } = useMenu();
  const hot = pct >= threshold;
  const R = 6;
  const C = 2 * Math.PI * R;

  // Focus moves INTO the popover: the action when there is one, else the
  // (focusable) popover itself — so Escape and screen readers always reach it.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(
      () => (itemsRef.current[0] ?? menuRef.current)?.focus({ preventScroll: true }),
      0
    );
    return () => window.clearTimeout(t);
  }, [open, itemsRef, menuRef]);

  const actionDisabled = compacting || disabled;

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Context window: ${pct}% used`}
        title={`Context window: ${formatTokens(used)} of ${formatTokens(budget)} tokens · ${turns} of ${maxTurns} turns`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            close();
          }
        }}
        className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {compacting ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-accent" aria-hidden />
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 -rotate-90" aria-hidden>
            <circle cx="8" cy="8" r={R} fill="none" strokeWidth="2.25" className="stroke-border" />
            <circle
              cx="8"
              cy="8"
              r={R}
              fill="none"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - Math.max(pct, 2) / 100)}
              className={hot ? "stroke-warning" : "stroke-accent"}
            />
          </svg>
        )}
        <span className="tabular-nums">{pct}%</span>
      </button>
      <FloatingMenu
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        onClose={close}
        width={288}
        align="right"
        label="Context window"
        role="dialog"
        className="focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="text-[13px] font-semibold text-foreground">Context window</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className={cn("h-full rounded-full", hot ? "bg-warning" : "bg-accent")}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
            ~{formatTokens(used)} of {formatTokens(budget)} tokens · {turns} of {maxTurns} turns ({pct}%)
          </p>
          {onCompact && (
            <p className="mt-1 text-xs text-muted-foreground">
              {autoCompact
                ? `Auto-compacts at ${threshold}%: earlier messages are summarized so the chat can keep going.`
                : `Suggests compacting at ${threshold}%. Auto-compact is off in workspace settings.`}
            </p>
          )}
        </div>
        {onCompact && (
          <button
            ref={(el) => {
              itemsRef.current[0] = el;
            }}
            type="button"
            // aria-disabled (not disabled) keeps it focusable while an answer
            // streams or a compaction runs; the click is guarded instead.
            aria-disabled={actionDisabled || undefined}
            onClick={() => {
              if (actionDisabled) return;
              // Back to the trigger: the popover (and this button) unmounts.
              close();
              onCompact();
            }}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            <Layers size={14} className="shrink-0 text-accent" aria-hidden />
            {compacting ? "Compacting…" : "Compact now"}
          </button>
        )}
      </FloatingMenu>
    </div>
  );
}

/** Where a chat was compacted: a quiet divider that expands to the summary. */
function CompactionDivider({ summary, count }: { summary: string; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-muted/50 px-3.5 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Layers size={14} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground">Context compacted</span>
          {count > 0 && ` · ${count} earlier message${count === 1 ? "" : "s"} summarized`}
        </span>
        <ChevronDown size={14} className={cn("shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 border-t border-border pt-2 text-[13px] leading-6 text-foreground">
          <Markdown content={summary} />
        </div>
      )}
    </div>
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
 * The attach controls and the mic only render when the user's capabilities
 * allow them (see `attachAccept` / `onDictate`).
 *
 * While an answer streams (`busy`) the composer stays usable: Stop appears to
 * the left of the send button, which keeps its rightmost slot and queues the
 * message for when the answer finishes (disabled until there's text).
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
  attachAccept,
  attachLabel,
  onDictate,
  canSend,
  maxFiles,
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
  /** The file picker's `accept` (the granted kinds); null hides attaching (button, picker, drop). */
  attachAccept: string | null;
  /** Human-readable list of the accepted types, for the attach tooltip. */
  attachLabel: string;
  /** Dictation target; null hides the mic (no "extract.audio"). */
  onDictate: ((text: string) => void) | null;
  canSend: boolean;
  maxFiles: number;
  onOpenLibrary: () => void;
  leftTools?: React.ReactNode;
  rightTools?: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const atMax = attachments.length >= maxFiles;
  const canAttach = attachAccept !== null;

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
    if (canAttach && e.dataTransfer.files && e.dataTransfer.files.length) onAttachFiles(e.dataTransfer.files);
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
    <div className="absolute bottom-full left-0 z-30 mb-2 max-h-[50vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg motion-safe:animate-fadeUp">
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground">Templates</p>
      <div className="columns-1 gap-1 sm:columns-2">
      {matches.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => select(cmd)}
          onMouseMove={() => setActive(i)}
          className={cn(
            "flex h-8 w-full break-inside-avoid items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors",
            i === activeIdx ? "bg-accent-soft" : "hover:bg-surface-muted"
          )}
        >
          <span className="shrink-0 font-medium text-foreground">/{cmd.name}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{cmd.hint}</span>
        </button>
      ))}
      </div>
    </div>
  ) : null;

  const fileInput = canAttach ? (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept={attachAccept}
      onChange={onFilesChosen}
      className="hidden"
      aria-hidden="true"
      tabIndex={-1}
    />
  ) : null;
  const mic = onDictate ? <VoiceInput onText={onDictate} /> : null;

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

  // Drag-and-drop attaching. Without any attachable kind a drop is still
  // swallowed (so the browser doesn't open the file over the chat) but ignored.
  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (canAttach && !dragging) setDragging(true);
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

  // Mid-answer, Send queues the message (it goes out when the answer finishes).
  const sendLabel = busy ? "Queue message" : "Send message";
  const sendTitle = busy ? "Queue: sends when the current answer finishes" : undefined;

  const stopButton = (className: string) => (
    <button
      type="button"
      aria-label="Stop generating"
      title="Stop generating"
      onClick={onStop}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-ink text-ink-foreground transition-transform duration-100 hover:bg-ink-hover active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
              {mic}
              {/* Stop sits LEFT of Send/Queue, which keeps the rightmost slot. */}
              {busy && stopButton("ml-1 mr-1.5 h-8 w-8")}
              <button
                type="submit"
                aria-label={sendLabel}
                title={sendTitle}
                disabled={!canSend}
                className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-[0_4px_12px_-4px_rgb(14_158_139/0.7)] transition-[transform,opacity,box-shadow] duration-150 hover:shadow-[0_6px_16px_-4px_rgb(14_158_139/0.9)] active:scale-95 disabled:opacity-40 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ArrowUp size={16} />
              </button>
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
            {canAttach && (
              <button
                type="button"
                onClick={pickFiles}
                disabled={atMax}
                title={atMax ? `Up to ${maxFiles} files` : `Attach files · ${attachLabel}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Paperclip size={14} className="shrink-0" aria-hidden />
                Attach file
              </button>
            )}
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
        {canAttach && (
          <button
            type="button"
            onClick={pickFiles}
            disabled={atMax}
            aria-label={atMax ? `Attachment limit reached (${maxFiles})` : "Attach files"}
            title={atMax ? `Up to ${maxFiles} files` : `Attach files · ${attachLabel}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-ink-foreground transition-[transform,background-color] duration-150 hover:bg-ink-hover active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Paperclip size={16} />
          </button>
        )}
        {textarea(
          busy ? "Queue a follow-up…" : "Type your prompt here…",
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
          {mic}
          {/* Stable slots: Send (Queue while an answer streams) always holds the
              rightmost spot, so typing never moves it; Stop sits to its left. */}
          {busy && stopButton("ml-0.5 mr-1.5 h-8 w-8")}
          <button
            type="submit"
            aria-label={sendLabel}
            title={sendTitle}
            disabled={!canSend}
            className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tea text-tea-foreground transition-[transform,background-color,opacity] duration-150 hover:bg-tea-hover active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Turns queued while an answer streams, above the docked composer: a compact
 * chip each ("Queued · text", × drops it) and a count, sent in order once the
 * answer finishes. After a failed or stopped answer the queue is held until
 * "Send now" resumes it or "Clear" drops it.
 */
function QueuedTurns({
  items,
  paused,
  onRemove,
  onSendNow,
  onClear,
}: {
  items: readonly QueuedTurn[];
  paused: boolean;
  onRemove: (turnId: string) => void;
  onSendNow: () => void;
  onClear: () => void;
}) {
  const count = items.length;
  const announcement =
    count === 0 ? "" : `${count} message${count === 1 ? "" : "s"} queued${paused ? ", paused" : ""}`;
  return (
    <>
      {/* The chips aren't a live region; this line announces the queue as it changes. */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {count > 0 && (
        <div className="mb-2 space-y-1.5 px-1">
          {paused && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-foreground">
              <Pause size={14} className="shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1">Queued messages paused</span>
              <span className="flex shrink-0 items-center gap-1">
                <Button size="sm" onClick={onSendNow}>
                  Send now
                </Button>
                <Button size="sm" variant="ghost" onClick={onClear}>
                  Clear
                </Button>
              </span>
            </div>
          )}
          {/* At most two rows of chips (2 × h-7 + gap), scrolling beyond. */}
          <ul aria-label="Queued messages" className="flex max-h-[62px] flex-wrap items-center gap-1.5 overflow-y-auto">
            {/* Visual only: the live line above announces the count, and the
                list's item count stays the number of queued messages. */}
            {count > 1 && (
              <li
                aria-hidden="true"
                className="inline-flex h-7 items-center px-1 text-xs font-medium tabular-nums text-muted-foreground"
              >
                {count} queued
              </li>
            )}
            {items.map((q) => (
              <li
                key={q.id}
                title={q.text}
                className="flex h-7 max-w-[280px] items-center gap-1.5 rounded-full border border-border bg-surface pl-2.5 pr-1 text-xs text-foreground shadow-soft"
              >
                <Clock size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="shrink-0 text-muted-foreground">Queued ·</span>
                <span className="min-w-0 truncate font-medium">{q.text}</span>
                {q.attachments.length > 0 && (
                  <>
                    <Paperclip size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                    <span className="sr-only">
                      with {q.attachments.length} attachment{q.attachments.length === 1 ? "" : "s"}
                    </span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(q.id)}
                  aria-label={`Remove queued message: ${q.text.length > 60 ? `${q.text.slice(0, 60)}…` : q.text}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
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
  const { open, setOpen, ref, triggerRef, itemsRef, menuRef, close } = useMenu();
  const available = options.filter((o) => o.available);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => itemsRef.current[0]?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
  }, [open, itemsRef]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = itemsRef.current.filter((b): b is HTMLButtonElement => !!b);
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  return (
    <div className="relative flex items-center" ref={ref}>
      <IconButton aria-label="Regenerate" title="Regenerate" size="sm" onClick={onRegenerate}>
        <RefreshCw size={14} />
      </IconButton>
      {available.length > 0 && (
        <button
          ref={triggerRef}
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
      <FloatingMenu
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        onClose={close}
        width={480}
        align="left"
        label="Regenerate with"
        onKeyDown={onMenuKeyDown}
      >
        <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-subtle-foreground">Regenerate with</p>
        <div className="columns-1 gap-1 sm:columns-2">
          {available.map((o, i) => (
            <button
              key={`${o.kind}-${o.value}`}
              ref={(el) => {
                itemsRef.current[i] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => {
                close(false);
                onRegenerateWith(o.value, o.tier);
              }}
              className="flex h-8 w-full break-inside-avoid items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
            >
              <span className="min-w-0 truncate">{o.label}</span>
              {o.kind === "tier" && <span className="shrink-0 text-[11px] text-subtle-foreground">preset</span>}
            </button>
          ))}
        </div>
      </FloatingMenu>
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

/**
 * Progressive character reveal for a smooth typewriter effect while streaming.
 * `resume`: the answer was already under way when the view mounted (a chat
 * re-opened mid-answer) — keep what's there and glide on from it, rather than
 * re-typing it from the start.
 */
function useSmoothText(text: string, active: boolean, resume = false): string {
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
    // Reveal this turn from the start (or, resumed, from what's already shown).
    posRef.current = resume ? textRef.current.length : 0;
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
    // `resume` only matters when streaming starts (it's fixed per message).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return active ? shown : text;
}

// Memoized so that when one message streams, the other (settled) messages don't
// re-parse their markdown on every animation frame.
const MemoMarkdown = memo(Markdown);

/** Markdown that reveals smoothly while streaming, then renders in full. */
function StreamingMarkdown({
  content,
  animate,
  resume = false,
}: {
  content: string;
  animate: boolean;
  /** Already streaming when the view mounted: continue, don't re-type (see useSmoothText). */
  resume?: boolean;
}) {
  const shown = useSmoothText(content, animate, resume);
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
