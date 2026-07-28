// Server-side client for the Brain's public API.
//
// SECURITY: BRAIN_API_KEY is a scoped secret. It is read from the server
// environment and used only here (server components / route handlers). It must
// NEVER be imported into a client component or exposed to the browser. The
// browser talks to THIS app's /api/chat, which forwards to the Brain with the key.

const BRAIN_URL = process.env.BRAIN_API_URL ?? "http://localhost:3000";
const BRAIN_KEY = process.env.BRAIN_API_KEY ?? "";

export type ModelTier = "fast" | "recommended" | "max";

export interface BrainMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

function authHeaders(): Record<string, string> {
  if (!BRAIN_KEY) throw new Error("BRAIN_API_KEY is not set");
  return { authorization: `Bearer ${BRAIN_KEY}`, "content-type": "application/json" };
}

/**
 * Grounded chat against the Brain. Returns the raw streamed Response so the
 * caller can pipe it straight back to the browser (AI SDK data stream).
 */
export async function brainChat(messages: BrainMessage[], tier?: ModelTier): Promise<Response> {
  return fetch(`${BRAIN_URL}/api/v1/chat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messages,
      model: tier ?? process.env.DEFAULT_MODEL_TIER ?? "recommended",
    }),
  });
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
