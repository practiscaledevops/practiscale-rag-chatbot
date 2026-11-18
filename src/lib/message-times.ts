// Message timestamps, shared by the save paths and the Brain client.
//
// A conversation is saved by replacing all of its rows, and the thread is
// rebuilt ordered by created_at. Each row keeps the time its message was
// actually sent (the client's createdAt), forced strictly increasing so the
// order is always the thread order, and never later than now. Those times also
// travel to the Brain, which anchors relative dates ("yesterday's calls") in a
// reopened chat to the day the message was sent, not to today.

const EARLIEST_DATE_MS = -8.64e15;

/** A usable ISO timestamp from an untrusted value (≤ 64 chars, parseable), else undefined. */
export function isoOrUndefined(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Send the chat fields Brain needs, including the original date of each turn. */
export function chatMessageFields<Role extends string>(
  { role, content, createdAt }: { role: Role; content: string; createdAt?: unknown }
) {
  return { role, content, createdAt: isoOrUndefined(createdAt) };
}

/** useChat's default serializer omits createdAt from saved messages. */
export function prepareChatRequest(
  { id, messages, requestData, requestBody }: {
    id: string;
    messages: { id?: string; role: string; content: string; createdAt?: unknown }[];
    requestData?: unknown;
    requestBody?: object;
  },
  defaults?: object
) {
  const userTurn = [...messages].reverse().find((message) => message.role === "user");
  return {
    id, data: requestData, ...defaults, ...requestBody,
    learningTurnId: userTurn?.id,
    messages: messages.map(chatMessageFields),
  };
}

/**
 * created_at values for a thread about to be (re)written, in order: each
 * message's own time when known, else just before the next known time; strictly
 * increasing and never in the future.
 */
export function rowTimestamps(messages: readonly { createdAt?: unknown }[], now: number = Date.now()): string[] {
  const recorded = messages.map(({ createdAt }) => {
    const iso = isoOrUndefined(createdAt);
    return iso ? Date.parse(iso) : undefined;
  });
  // A row with no time must not move a later historical row to the save date.
  // Place a run of unknown rows before the next recorded time or before now.
  const fallback: number[] = [];
  let next = now;
  for (let i = recorded.length - 1; i >= 0; i--) {
    fallback[i] = Math.max(EARLIEST_DATE_MS, next - 1);
    next = Math.min(recorded[i] ?? fallback[i], fallback[i]);
  }

  let prev = -Infinity;
  return recorded.map((time, i) => {
    // Reserve one millisecond for each following row so ties can never move a
    // message past now.
    let t = Math.min(time ?? fallback[i], now - (messages.length - i - 1));
    if (t <= prev) t = prev + 1;
    prev = t;
    return new Date(t).toISOString();
  });
}
