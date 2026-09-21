// Server-side client for the Brain's public API.
//
// SECURITY: BRAIN_API_KEY is a scoped secret. It is read from the server
// environment and used only here (server components / route handlers). It must
// NEVER be imported into a client component or exposed to the browser. The
// browser talks to THIS app's /api/chat, which forwards to the Brain with the key.

const BRAIN_URL = process.env.BRAIN_API_URL ?? "http://localhost:3000";
const BRAIN_KEY = process.env.BRAIN_API_KEY ?? "";

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

/** Raw retrieval (no generation) — for features that show sources directly. */
export async function brainRetrieve(query: string, matchCount = 8) {
  const res = await fetch(`${BRAIN_URL}/api/v1/retrieve`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ query, matchCount, expandParents: true }),
  });
  if (!res.ok) throw new Error(`Brain retrieve failed: ${res.status}`);
  return res.json();
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
