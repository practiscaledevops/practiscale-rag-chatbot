// Server-side client for the Brain's public API.
//
// SECURITY: BRAIN_API_KEY is a scoped secret. It is read from the server
// environment and used only here (server components / route handlers). It must
// NEVER be imported into a client component or exposed to the browser. The
// browser talks to THIS app's /api/chat, which forwards to the Brain with the key.

import type {
  ExtractResponse,
  KnowledgeDetailResponse,
  KnowledgeListParams,
  KnowledgeListResponse,
  LearningListParams,
  LearningListResponse,
} from "@/lib/brain-types";
import {
  BUILTIN_KNOWLEDGE_SCOPES,
  DEFAULT_KNOWLEDGE_SCOPE,
  normalizeKnowledgeScopes,
  type KnowledgeScope,
} from "@/lib/knowledge-scopes";
import { isCapabilityId } from "@/lib/capabilities-shared";
import { BRAIN_MAX_ATTACHMENTS } from "@/lib/attachments-shared";

const BRAIN_URL = resolveBrainUrl();
const BRAIN_KEY = process.env.BRAIN_API_KEY ?? "";

/**
 * The Brain's base URL. Defaults to the local dev Brain, but in production a
 * missing BRAIN_API_URL is a deployment mistake (every Brain call would silently
 * go to localhost), so fail fast at module load instead.
 */
function resolveBrainUrl(): string {
  const url = process.env.BRAIN_API_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BRAIN_API_URL must be set in production");
  }
  return "http://localhost:3000";
}

/**
 * A user-safe message for a failed Brain call. Upstream error BODIES are never
 * echoed to the browser (they can carry internal detail); routes log them
 * server-side and return this instead. The scope/quota hints are actionable
 * and safe to show.
 */
export function safeBrainError(status: number): string {
  switch (status) {
    case 401:
      return "The Brain rejected this app's key. Ask an admin to check the Brain configuration.";
    case 403:
      return "This app's Brain key is not permitted to perform that request.";
    case 429:
      return "The Brain is rate-limiting requests right now. Try again shortly.";
    default:
      return "Brain request failed";
  }
}

/**
 * safeBrainError for a CHAT turn: the Brain's 400 / 413 there mean the turn
 * didn't fit its contract (too many or too large attachments, an oversized
 * turn), which the user can act on.
 */
export function safeBrainChatError(status: number): string {
  switch (status) {
    case 400:
      return "The Brain couldn't accept this message. Try attaching fewer files, or start a new conversation.";
    case 413:
      return "This message and its attachments are too large for one turn. Attach fewer or smaller files, or start a new conversation.";
    default:
      return safeBrainError(status);
  }
}

export type ModelTier = "fast" | "recommended" | "max";

/**
 * What the Brain's `model` field accepts: a tier alias ("fast" | "recommended"
 * | "max") OR a concrete model id ("claude-opus-4-8", "gpt-4o", …). The Brain
 * resolves either to a real model and reports it back in the x-model header.
 */
export type ModelSelection = ModelTier | (string & {});

export interface BrainMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** When the message was sent (ISO). The Brain anchors relative dates to it. */
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Long-chat safety net (pure — no I/O)
// ---------------------------------------------------------------------------

/**
 * Most turns sent to the Brain's /api/v1/chat: the leading summary + the 40
 * user/assistant turns the Brain actually KEEPS for the model (it accepts up to
 * 200 messages but keeps only the last 40 turns within 120k chars — see
 * lib/compaction BRAIN_MODEL_TURNS / BRAIN_TURN_CHARS). Sending more only
 * wastes the request.
 */
export const BRAIN_MAX_MESSAGES = 41;
/** Longest single message the Brain accepts (characters). */
export const BRAIN_MAX_MESSAGE_CHARS = 40_000;
/** Marker that opens a compacted-history system message (the Brain honors these). */
export const CONVERSATION_SUMMARY_PREFIX = "[Conversation summary]";

/** Whether a turn is a compacted-history summary (a system message with the marker). */
export function isConversationSummary(m: { role: string; content: string }): boolean {
  return m.role === "system" && m.content.trimStart().startsWith(CONVERSATION_SUMMARY_PREFIX);
}

/**
 * Shape a conversation so the Brain will accept it, however long the chat is:
 *   • "[Conversation summary]" system turns are kept (the Brain uses them as the
 *     compacted history); any OTHER system turn is dropped — the Brain discards
 *     caller-supplied system turns anyway, so they'd only waste the window;
 *   • the LATEST summary leads: turns before it are already folded into it, so
 *     they are dropped (the same "effective history" the composer meters);
 *   • above `maxMessages`, the summary (if any) stays first and only the most
 *     recent turns are kept after it; the kept window never opens on an
 *     assistant turn;
 *   • every turn is clipped to `maxChars`.
 * Returns new objects (the input is not mutated). Used ONLY for the upstream
 * call — the persisted history always keeps the full conversation.
 */
export function fitMessagesForBrain(
  messages: BrainMessage[],
  maxMessages: number = BRAIN_MAX_MESSAGES,
  maxChars: number = BRAIN_MAX_MESSAGE_CHARS
): BrainMessage[] {
  const kept = messages.filter((m) => m.role !== "system" || isConversationSummary(m));
  const clip = (m: BrainMessage): BrainMessage => ({
    role: m.role,
    content: m.content.length > maxChars ? m.content.slice(0, maxChars) : m.content,
    ...(m.createdAt ? { createdAt: m.createdAt } : {}),
  });

  // Start from the latest summary: it stands in for everything before it.
  let summaryIdx = -1;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (isConversationSummary(kept[i])) {
      summaryIdx = i;
      break;
    }
  }
  const turns = summaryIdx > 0 ? kept.slice(summaryIdx) : kept;

  const limit = Math.max(1, Math.floor(maxMessages));
  if (turns.length <= limit) return turns.map(clip);

  // Too many: keep the leading summary, then the most recent turns.
  const lead = limit > 1 && summaryIdx >= 0 ? turns[0] : null;
  const tail = turns.slice(turns.length - (lead ? limit - 1 : limit));
  // Start the kept window on a user turn (never leave an orphaned answer first).
  while (tail.length > 1 && tail[0].role === "assistant") tail.shift();
  return (lead ? [lead, ...tail] : tail).map(clip);
}

/** Longest single attachment text forwarded to the Brain (characters). */
export const BRAIN_MAX_ATTACHMENT_CHARS = 40_000;
/** The Brain's cap on a compaction summary it folds into a turn (characters). */
const BRAIN_MAX_SUMMARY_CHARS = 16_000;
/** Room for the Brain's own framing around the summary + a safety margin. */
const TURN_HEADROOM_CHARS = 3_000;

/**
 * Characters left for attachments in one Brain turn: the Brain's per-turn cap
 * (BRAIN_TURN_CHARS) counts the latest user message, every attachment, the
 * directives and the summary block, and answers 413 when the current turn alone
 * is over it (older turns are dropped first). Never negative.
 */
export function attachmentCharBudget(
  messages: readonly BrainMessage[],
  directives: string | undefined,
  turnChars: number
): number {
  let lastUser = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUser = messages[i].content;
      break;
    }
  }
  const summary = messages.find(isConversationSummary);
  const summaryChars = summary ? Math.min(summary.content.length, BRAIN_MAX_SUMMARY_CHARS) : 0;
  return Math.max(0, turnChars - lastUser.length - (directives?.length ?? 0) - summaryChars - TURN_HEADROOM_CHARS);
}

export interface NamedText {
  name: string;
  text: string;
}

/**
 * Fit a turn's attachments to the Brain's contract: at most
 * BRAIN_MAX_ATTACHMENTS entries and `budgetChars` characters in total (see
 * attachmentCharBudget). The user's own attachments come first and are never
 * cut silently — `tooLarge` when they alone don't fit. Every project file is
 * folded into ONE "Project files" entry, so a project with many files uses a
 * single slot; it fills whatever slot and characters remain.
 */
export function fitAttachmentsForBrain(
  own: readonly NamedText[],
  projectFiles: readonly NamedText[],
  budgetChars: number
): { attachments: NamedText[]; tooLarge: boolean } {
  const mine = own
    .filter((a) => a.text.trim())
    .map((a) => ({ name: a.name.slice(0, 200), text: a.text.slice(0, BRAIN_MAX_ATTACHMENT_CHARS) }));
  const used = mine.reduce((n, a) => n + a.text.length, 0);
  if (mine.length > BRAIN_MAX_ATTACHMENTS || used > budgetChars) return { attachments: [], tooLarge: true };

  const out = [...mine];
  const room = Math.min(BRAIN_MAX_ATTACHMENT_CHARS, budgetChars - used);
  const files = projectFiles.filter((f) => f.text.trim());
  if (files.length > 0 && out.length < BRAIN_MAX_ATTACHMENTS && room > 0) {
    const text = files
      .map((f) => `## ${f.name}\n${f.text}`)
      .join("\n\n")
      .slice(0, room);
    if (text.trim()) out.push({ name: "Project files", text });
  }
  return { attachments: out, tooLarge: false };
}

/** Provider + resolved model id the Brain reports on the chat response. */
export interface BrainModelHeaders {
  /** resolved concrete model id (x-model), or null if the header is absent */
  model: string | null;
  /** provider family (x-provider): "anthropic" | "openai" | null */
  provider: string | null;
}

function authHeaders(): Record<string, string> {
  if (!BRAIN_KEY) throw new Error("BRAIN_API_KEY is not set");
  return { authorization: `Bearer ${BRAIN_KEY}`, "content-type": "application/json" };
}

/** A background job's live progress (deep audit). */
export interface JobProgress {
  job: {
    id: string;
    title: string;
    status: string;
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    result: unknown;
    finished_at: string | null;
  };
  tasks: { idx: number; label: string; status: string }[];
}

/**
 * Start a deep-audit background job in the Brain (scoped key, server-side).
 *
 * @param history optional recent conversation turns (already validated + bounded
 *                by the caller) so the Brain can resolve follow-ups like "audit
 *                those calls" — sent as `history` only when non-empty. The Brain
 *                treats them as data, never instructions.
 */
export async function brainStartAudit(
  query: string,
  history?: BrainMessage[]
): Promise<{ id: string; title: string; status: string; total_tasks: number }> {
  const res = await fetch(`${BRAIN_URL}/api/v1/jobs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      query,
      ...(history && history.length
        ? {
            history: history.map((m) => ({
              role: m.role,
              content: m.content,
              ...(m.createdAt ? { createdAt: m.createdAt } : {}),
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    job?: { id: string; title: string; status: string; total_tasks: number };
    error?: string;
  };
  if (!res.ok || !json.job) {
    throw new BrainRequestError(res.status, json.error ?? "Could not start the audit");
  }
  return json.job;
}

/** Poll a job's progress (scoped key, server-side). */
export async function brainJobProgress(id: string): Promise<JobProgress> {
  const res = await fetch(`${BRAIN_URL}/api/v1/jobs/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as JobProgress & { error?: string };
  if (!res.ok || !json.job) {
    throw new BrainRequestError(res.status, json.error ?? "Could not read job progress");
  }
  return json;
}

/** Upper bound for one compaction (a model call over up to 200 turns). */
export const COMPACT_TIMEOUT_MS = 110_000;

/**
 * POST /api/v1/compact — summarize a long conversation into a compact recap the
 * chat can carry forward as a "[Conversation summary]" system turn. Server-side
 * only (scoped key). The caller validates + bounds `messages`; the Brain treats
 * their content as data, never instructions.
 *
 * @returns the summary text (trimmed, non-empty)
 * @throws  {BrainRequestError} on a non-2xx answer or an empty summary
 */
export async function brainCompact(
  messages: { role: "user" | "assistant" | "system"; content: string }[]
): Promise<string> {
  const res = await fetch(`${BRAIN_URL}/api/v1/compact`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(COMPACT_TIMEOUT_MS),
  });
  if (!res.ok) throw new BrainRequestError(res.status, await readError(res, "Brain compaction failed"));
  const json = (await res.json().catch(() => null)) as { summary?: unknown } | null;
  const summary = typeof json?.summary === "string" ? json.summary.trim() : "";
  if (!summary) throw new BrainRequestError(502, "The Brain returned an empty summary");
  return summary;
}

/**
 * Grounded chat against the Brain. Returns the raw streamed Response so the
 * caller can pipe it straight back to the browser (AI SDK data stream).
 *
 * @param messages conversation so far
 * @param model    a tier alias OR a concrete model id, forwarded verbatim as the
 *                 Brain's `model` field (defaults to the configured tier).
 */
/** Optional knowledge-scope narrowing (role-based partitioning). Restrict only. */
export interface BrainScope {
  sourceTypes?: string[];
  collectionIds?: string[];
  /**
   * "Search in" (lib/knowledge-scopes id, resolved + access-checked in /api/chat).
   * Picks the Brain's intelligence lanes; omitted = "auto".
   */
  knowledgeScope?: string;
}

/** A file the user attached to THIS message, already extracted to plain text. */
export interface BrainAttachment {
  name: string;
  text: string;
}

/** Most capability ids forwarded on one chat request (the manifest holds ~50 today). */
export const BRAIN_MAX_CAPABILITIES = 200;
/**
 * The Brain validates every forwarded id against /^[a-z0-9_.:-]{1,80}$/ and
 * rejects the WHOLE request on a mismatch, so anything it would refuse (e.g. a
 * very long connector id) is dropped here — which only narrows.
 */
const BRAIN_CAPABILITY_ID_RE = /^[a-z0-9_.:-]{1,80}$/;

/**
 * The capability ids to forward to the Brain: well-formed ids only, de-duplicated
 * and capped. Dropping an id only ever narrows what the Brain does for the user.
 */
function capabilityList(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => isCapabilityId(id) && BRAIN_CAPABILITY_ID_RE.test(id)))).slice(
    0,
    BRAIN_MAX_CAPABILITIES
  );
}

export async function brainChat(
  messages: BrainMessage[],
  model?: ModelSelection,
  mode?: string,
  scope?: BrainScope,
  directives?: string,
  outputType?: string,
  attachments?: BrainAttachment[],
  /** Modes this user may use — constrains the Brain's Auto detection (never widens). */
  allowedModes?: string[],
  /**
   * The user's resolved capability ids (SessionProfile.capabilities, resolved
   * server-side). The Brain uses them to NARROW only — e.g. no call reviews
   * without "chat.call_review", no performance block without
   * "knowledge.performance" — never to widen the key's scope. Omitted = no
   * narrowing (sent as-is when given, even when empty).
   */
  capabilities?: readonly string[]
): Promise<Response> {
  return fetch(`${BRAIN_URL}/api/v1/chat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messages,
      model: model ?? process.env.DEFAULT_MODEL_TIER ?? "recommended",
      // Persona overlay + knowledge scope (both resolved + gated server-side in
      // this app's /api/chat; the Brain re-checks and can only narrow the scope).
      ...(mode ? { mode } : {}),
      ...(allowedModes && allowedModes.length ? { allowedModes } : {}),
      ...(scope?.sourceTypes ? { sourceTypes: scope.sourceTypes } : {}),
      ...(scope?.collectionIds ? { collectionIds: scope.collectionIds } : {}),
      ...(scope?.knowledgeScope && scope.knowledgeScope !== DEFAULT_KNOWLEDGE_SCOPE ? { knowledgeScope: scope.knowledgeScope } : {}),
      // Trusted private operator context (e.g. the executive's own memory).
      ...(directives ? { directives } : {}),
      // Response format (table/memo/email/…); the Brain validates + enforces it.
      ...(outputType && outputType !== "answer" ? { outputType } : {}),
      // Per-message attached files (extracted text). The Brain treats their
      // CONTENT as data, never as instructions.
      ...(attachments && attachments.length ? { attachments } : {}),
      // The user's capabilities (narrow-only; see the parameter doc).
      ...(capabilities ? { capabilities: capabilityList(capabilities) } : {}),
    }),
  });
}

/** A confirmed piece of Organizational Learning to record in the Brain. */
export interface BrainLearningInput {
  kind: "decision" | "implementation" | "experiment" | "result" | "learning";
  title: string;
  change: string;
  observedResult?: string;
  department?: string;
  relatedRefs?: string[];
  missingEvidence?: string[];
  notes?: string;
  createdBy?: string;
  source?: "chat" | "manual";
}

/** POST /api/v1/learning — save a learning record (server-side only). */
export async function brainSaveLearning(input: BrainLearningInput): Promise<Response> {
  return fetch(`${BRAIN_URL}/api/v1/learning`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

/** A knowledge collection the scoped key may search (for the source-scope UI). */
export interface BrainCollection {
  id: string;
  name: string;
}

/** What the "Search in" picker can offer: knowledge scopes + collections. */
export interface BrainSearchOptions {
  collections: BrainCollection[];
  /** The Brain's scope catalogue for this key (BUILTIN_KNOWLEDGE_SCOPES when unavailable). */
  scopes: KnowledgeScope[];
}

/**
 * The knowledge scopes and collections this app's scoped key may search
 * (GET /api/v1/collections → { collections, scopes }). Server-side only (holds
 * the key). Best-effort: any failure returns no collections and the built-in
 * scopes (Auto, All Brain, Reality, Playbooks, Learnings: never a sensitive
 * one), which is also what an older Brain without `scopes` yields. Cached
 * briefly since the sets change rarely. Callers filter the scopes per user
 * (lib/knowledge-scopes scopesForAccess).
 */
export async function fetchBrainSearchOptions(): Promise<BrainSearchOptions> {
  const fallback = (): BrainSearchOptions => ({ collections: [], scopes: [...BUILTIN_KNOWLEDGE_SCOPES] });
  if (!BRAIN_KEY) return fallback();
  try {
    const res = await fetch(`${BRAIN_URL}/api/v1/collections`, {
      method: "GET",
      headers: authHeaders(),
      next: { revalidate: 300 },
    });
    if (!res.ok) return fallback();
    const json = (await res.json().catch(() => null)) as { collections?: unknown; scopes?: unknown } | null;
    const list = Array.isArray(json?.collections) ? json!.collections : [];
    const collections = (list as Record<string, unknown>[])
      .filter((c) => c && typeof c === "object")
      .map((c) => ({ id: String(c.id ?? ""), name: String(c.name ?? "Untitled") }))
      .filter((c) => c.id);
    return { collections, scopes: normalizeKnowledgeScopes(json?.scopes) ?? [...BUILTIN_KNOWLEDGE_SCOPES] };
  } catch {
    return fallback();
  }
}

/** The collections this app's scoped key may search (see fetchBrainSearchOptions). */
export async function fetchBrainCollections(): Promise<BrainCollection[]> {
  return (await fetchBrainSearchOptions()).collections;
}

/** The Brain's knowledge scopes for this app's key, unfiltered per user (see fetchBrainSearchOptions). */
export async function fetchBrainKnowledgeScopes(): Promise<KnowledgeScope[]> {
  return (await fetchBrainSearchOptions()).scopes;
}

/**
 * Read the Brain's resolution headers off a chat Response: the concrete model
 * it actually used (x-model) and the provider (x-provider). Both are null when
 * the Brain omits them, so callers must tolerate missing values.
 */
export function brainModelHeaders(res: Response): BrainModelHeaders {
  return {
    model: res.headers.get("x-model"),
    provider: res.headers.get("x-provider"),
  };
}

// ---------------------------------------------------------------------------
// Operating Intelligence: knowledge objects, learning records, extraction
// ---------------------------------------------------------------------------

/** Thrown by the knowledge / learning / extract helpers on a non-2xx Brain answer. */
export class BrainRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BrainRequestError";
    this.status = status;
  }
}

/** Bearer header only — for multipart bodies, where fetch must set the content-type itself. */
function bearerHeader(): Record<string, string> {
  if (!BRAIN_KEY) throw new Error("BRAIN_API_KEY is not set");
  return { authorization: `Bearer ${BRAIN_KEY}` };
}

/** Query string from defined, non-empty params (booleans as 1/0). */
function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** The Brain's `{ error }` message when present, else a fallback. */
async function readError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof json?.error === "string" && json.error ? json.error : `${fallback} (${res.status})`;
}

/**
 * GET /api/v1/knowledge — browse the org's knowledge objects with counts.
 * `sensitive` MUST be decided server-side from the user's profile
 * (canAccessSensitive); it is never read from the browser.
 */
export async function brainListKnowledge(
  params: KnowledgeListParams,
  sensitive: boolean
): Promise<KnowledgeListResponse> {
  const res = await fetch(
    `${BRAIN_URL}/api/v1/knowledge${qs({
      class: params.class,
      domain: params.domain,
      type: params.type,
      q: params.q,
      sensitive,
      includeArchive: params.includeArchive ? 1 : 0,
      limit: params.limit,
      offset: params.offset,
    })}`,
    { method: "GET", headers: authHeaders(), cache: "no-store" }
  );
  if (!res.ok) throw new BrainRequestError(res.status, await readError(res, "Brain knowledge request failed"));
  return (await res.json()) as KnowledgeListResponse;
}

/** GET /api/v1/knowledge/{ref} — one object with relationships + linked learning. `null` on 404. */
export async function brainGetKnowledge(
  ref: string,
  sensitive: boolean
): Promise<KnowledgeDetailResponse | null> {
  const res = await fetch(
    `${BRAIN_URL}/api/v1/knowledge/${encodeURIComponent(ref)}${qs({ sensitive })}`,
    { method: "GET", headers: authHeaders(), cache: "no-store" }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new BrainRequestError(res.status, await readError(res, "Brain knowledge request failed"));
  return (await res.json()) as KnowledgeDetailResponse;
}

/** GET /api/v1/learning — the org's learning records (decisions, experiments, results…). */
export async function brainListLearning(params: LearningListParams): Promise<LearningListResponse> {
  const res = await fetch(
    `${BRAIN_URL}/api/v1/learning${qs({
      status: params.status,
      type: params.type,
      limit: params.limit,
      offset: params.offset,
    })}`,
    { method: "GET", headers: authHeaders(), cache: "no-store" }
  );
  if (!res.ok) throw new BrainRequestError(res.status, await readError(res, "Brain learning request failed"));
  return (await res.json()) as LearningListResponse;
}

/** Upper bound for one extraction (audio transcription is the slow case). */
const EXTRACT_TIMEOUT_MS = 120_000;

/**
 * POST /api/v1/extract — turn a PDF / image / audio file (multipart) or a URL
 * (JSON) into plain text. The file is forwarded as-is; the Brain does the
 * parsing / OCR / transcription. Times out after 120s.
 *
 * @param name  the (bounded, validated) filename the Brain should see — lets the
 *              caller pass its sanitized name without re-wrapping the File.
 */
export async function brainExtract(
  input: File | { url: string },
  name?: string
): Promise<ExtractResponse> {
  const signal = AbortSignal.timeout(EXTRACT_TIMEOUT_MS);
  let res: Response;
  if (input instanceof File) {
    const fd = new FormData();
    fd.append("file", input, name ?? input.name);
    res = await fetch(`${BRAIN_URL}/api/v1/extract`, {
      method: "POST",
      headers: bearerHeader(),
      body: fd,
      signal,
    });
  } else {
    res = await fetch(`${BRAIN_URL}/api/v1/extract`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url: input.url }),
      signal,
    });
  }
  if (!res.ok) throw new BrainRequestError(res.status, await readError(res, "Brain extraction failed"));
  return (await res.json()) as ExtractResponse;
}

/** One retrieved chunk as the RAG debugger renders it. */
export interface DebugRetrievedItem {
  id: string;
  content: string;
  source_type: string | null;
  document_id: string;
  score: number | null;
  metadata?: Record<string, unknown>;
}

export interface DebugRetrieveResult {
  ok: boolean;
  status: number;
  /** Effective (possibly rewritten) query the Brain searched. */
  query?: string;
  rewritten?: boolean;
  confidence?: number | null;
  results: DebugRetrievedItem[];
  /** Set when ok is false — a human-readable reason (e.g. missing capability). */
  error?: string;
}

/**
 * Retrieval for the admin RAG debugger — never throws; returns the status and a
 * readable error so the UI can explain (e.g. the scoped key lacks the "retrieve"
 * capability). Requests NO parent expansion so the reranker scores survive.
 *
 * `sourceTypes` is the caller's data.* narrowing (lib/access allowedSourceTypes,
 * resolved server-side): `undefined` = no narrowing. It is sent to the Brain
 * (which intersects it with the key scope) AND enforced here on the results, so
 * a Brain that ignores the field still never returns a denied source type.
 */
export async function brainRetrieveDebug(
  query: string,
  matchCount = 12,
  sourceTypes?: readonly string[]
): Promise<DebugRetrieveResult> {
  let res: Response;
  try {
    res = await fetch(`${BRAIN_URL}/api/v1/retrieve`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        query,
        matchCount,
        expandParents: false,
        ...(sourceTypes ? { sourceTypes } : {}),
      }),
    });
  } catch (e) {
    return { ok: false, status: 0, results: [], error: (e as Error).message };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const error =
      res.status === 403
        ? "The Brain API key isn't allowed to use retrieval (needs the 'retrieve' capability)."
        : `Brain retrieve failed (${res.status}). ${detail}`.trim();
    return { ok: false, status: res.status, results: [], error };
  }

  const json = (await res.json().catch(() => ({}))) as {
    query?: string;
    rewritten?: boolean;
    confidence?: number | null;
    results?: DebugRetrievedItem[];
  };
  const all = Array.isArray(json.results) ? json.results : [];
  // Chatbot-side enforcement of the narrowing (an older Brain drops the field):
  // with a narrowing, a chunk survives only when its source type is allowed.
  const results = sourceTypes
    ? all.filter((r) => typeof r?.source_type === "string" && sourceTypes.includes(r.source_type))
    : all;
  return {
    ok: true,
    status: res.status,
    query: json.query,
    rewritten: json.rewritten,
    confidence: json.confidence ?? null,
    results,
  };
}
