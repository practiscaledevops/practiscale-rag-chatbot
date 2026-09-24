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

/** Start a deep-audit background job in the Brain (scoped key, server-side). */
export async function brainStartAudit(
  query: string
): Promise<{ id: string; title: string; status: string; total_tasks: number }> {
  const res = await fetch(`${BRAIN_URL}/api/v1/jobs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ query }),
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
}

/** A file the user attached to THIS message, already extracted to plain text. */
export interface BrainAttachment {
  name: string;
  text: string;
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
  allowedModes?: string[]
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
      // Trusted private operator context (e.g. the executive's own memory).
      ...(directives ? { directives } : {}),
      // Response format (table/memo/email/…); the Brain validates + enforces it.
      ...(outputType && outputType !== "answer" ? { outputType } : {}),
      // Per-message attached files (extracted text). The Brain treats their
      // CONTENT as data, never as instructions.
      ...(attachments && attachments.length ? { attachments } : {}),
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

/**
 * List the collections this app's scoped key may search (GET /api/v1/collections).
 * Server-side only (holds the key). Best-effort: any failure returns []. Cached
 * briefly since the set changes rarely.
 */
export async function fetchBrainCollections(): Promise<BrainCollection[]> {
  if (!BRAIN_KEY) return [];
  try {
    const res = await fetch(`${BRAIN_URL}/api/v1/collections`, {
      method: "GET",
      headers: authHeaders(),
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const json = (await res.json().catch(() => null)) as { collections?: unknown } | null;
    const list = Array.isArray(json?.collections) ? json!.collections : [];
    return (list as Record<string, unknown>[])
      .map((c) => ({ id: String(c.id ?? ""), name: String(c.name ?? "Untitled") }))
      .filter((c) => c.id);
  } catch {
    return [];
  }
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
 */
export async function brainRetrieveDebug(
  query: string,
  matchCount = 12
): Promise<DebugRetrieveResult> {
  let res: Response;
  try {
    res = await fetch(`${BRAIN_URL}/api/v1/retrieve`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query, matchCount, expandParents: false }),
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
  return {
    ok: true,
    status: res.status,
    query: json.query,
    rewritten: json.rewritten,
    confidence: json.confidence ?? null,
    results: Array.isArray(json.results) ? json.results : [],
  };
}
