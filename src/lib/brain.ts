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
export async function brainChat(
  messages: BrainMessage[],
  model?: ModelSelection
): Promise<Response> {
  return fetch(`${BRAIN_URL}/api/v1/chat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messages,
      model: model ?? process.env.DEFAULT_MODEL_TIER ?? "recommended",
    }),
  });
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
