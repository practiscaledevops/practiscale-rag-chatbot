// Message timestamps, shared by the save paths and the Brain client.
//
// A conversation is saved by replacing all of its rows, and the thread is
// rebuilt ordered by created_at. Each row keeps the time its message was
// actually sent (the client's createdAt), forced strictly increasing so the
// order is always the thread order, and never later than now. Those times also
// travel to the Brain, which anchors relative dates ("yesterday's calls") in a
// reopened chat to the day the message was sent, not to today.

/** A usable ISO timestamp from an untrusted value (≤ 64 chars, parseable), else undefined. */
export function isoOrUndefined(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/**
 * created_at values for a thread about to be (re)written, in order: each
 * message's own time when known, else just after the previous row; strictly
 * increasing and never in the future.
 */
export function rowTimestamps(messages: readonly { createdAt?: unknown }[], now: number = Date.now()): string[] {
  const out: string[] = [];
  // Unknown times are placed at the end of the thread, just before `now`.
  let prev = -Infinity;
  const fallbackStart = now - messages.length;
  messages.forEach((m, i) => {
    const iso = isoOrUndefined(m.createdAt);
    let t = iso ? Date.parse(iso) : fallbackStart + i;
    if (t > now) t = now;
    if (t <= prev) t = prev + 1;
    prev = t;
    out.push(new Date(t).toISOString());
  });
  return out;
}
