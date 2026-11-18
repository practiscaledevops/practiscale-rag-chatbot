const kinds = ["decision", "implementation", "experiment", "result", "learning"] as const;
export const DEFERRED_LEARNING_HEADER = "x-brain-deferred-learning";

export interface LearningCandidate {
  kind: (typeof kinds)[number];
  title: string;
  change: string;
  observedResult: string | null;
  department: string | null;
  relatedRefs: string[];
  missingEvidence: string[];
  confidence: number;
}

export function parseLearningCandidate(value: unknown): LearningCandidate | null {
  if (typeof value !== "object" || !value) return null;
  const event = value as Record<string, unknown>;
  if (event.type !== "learning_candidate" || typeof event.title !== "string") return null;
  const strings = (list: unknown) => Array.isArray(list)
    ? list.filter((item): item is string => typeof item === "string")
    : [];
  return {
    kind: kinds.find(kind => kind === event.kind) ?? "learning",
    title: event.title,
    change: typeof event.change === "string" ? event.change : "",
    observedResult: typeof event.observedResult === "string" ? event.observedResult : null,
    department: typeof event.department === "string" ? event.department : null,
    relatedRefs: strings(event.relatedRefs),
    missingEvidence: strings(event.missingEvidence),
    confidence: typeof event.confidence === "number" ? event.confidence : 0,
  };
}

/**
 * AI SDK v4 waits for EOF even after a finish-message part. For a stream
 * which advertises deferred learning, give the SDK EOF at the finish part
 * and continue reading the optional suggestion with the same network reader.
 */
export function separateLearningTail(
  response: Response,
  onCandidate: (candidate: LearningCandidate) => void,
  onClosed: () => void,
): Response {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let ended = false;

  async function readLine(): Promise<string | null> {
    let newline = buffer.indexOf("\n");
    while (!ended && newline === -1) {
      const next = await reader.read();
      ended = next.done;
      buffer += decoder.decode(next.value, { stream: !ended });
      newline = buffer.indexOf("\n");
    }
    if (!buffer) return null;
    const length = newline === -1 ? buffer.length : newline + 1;
    const line = buffer.slice(0, length);
    buffer = buffer.slice(length);
    return line;
  }

  async function readLearning() {
    try {
      for (let line = await readLine(); line !== null; line = await readLine()) {
        if (!line.startsWith("2:")) continue;
        const events: unknown = JSON.parse(line.slice(2));
        if (!Array.isArray(events)) continue;
        for (const event of events) {
          const candidate = parseLearningCandidate(event);
          if (candidate) onCandidate(candidate);
        }
      }
    } catch {
      // A failed optional suggestion cannot fail a completed answer.
      void reader.cancel().catch(() => {});
    } finally {
      onClosed();
    }
  }

  const answer = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const line = await readLine();
        if (line === null) {
          controller.close();
          onClosed();
          return;
        }
        controller.enqueue(encoder.encode(line));
        if (line.startsWith("d:")) {
          controller.close();
          void readLearning();
        }
      } catch (error) {
        onClosed();
        controller.error(error);
      }
    },
    cancel(reason) {
      onClosed();
      return reader.cancel(reason);
    },
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(answer, { status: response.status, statusText: response.statusText, headers });
}
