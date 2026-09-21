// In-memory sliding-window rate limiter for the chatbot's API routes.
//
// PER-INSTANCE: state lives in this process's memory. On Vercel every serverless
// instance keeps its own counters and a cold start resets them, so the limits
// below are a per-instance ceiling that blunts a runaway client / script — not a
// globally exact quota. Good enough for abuse control on authenticated routes;
// move to a shared store (Redis / Upstash) if precise global limits are needed.
//
// Pure module: no secrets, no I/O. Safe to import from any route handler.

export interface RateLimitResult {
  /** whether this request may proceed */
  ok: boolean;
  /** requests left in the current window (0 when rejected) */
  remaining: number;
  /** epoch ms when the oldest counted request leaves the window */
  resetAt: number;
}

/** key → timestamps (epoch ms) of the requests still inside the window. */
const buckets = new Map<string, number[]>();

/** Above this many live keys, expired ones are swept on the next check. */
const SWEEP_AT = 5_000;

/** Drop keys whose every hit is older than `windowMs` — keeps memory bounded. */
function sweep(now: number, windowMs: number): void {
  for (const [key, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] <= now - windowMs) buckets.delete(key);
  }
}

/**
 * Count one request against `key` and decide whether it fits within `limit`
 * requests per `windowMs` (sliding window: only hits newer than now − windowMs
 * count). A rejected request is NOT counted, so a client that keeps retrying
 * does not push its own reset further out.
 */
export function check(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  if (buckets.size > SWEEP_AT) sweep(now, windowMs);

  const since = now - windowMs;
  let hits = buckets.get(key);
  if (!hits) {
    hits = [];
    buckets.set(key, hits);
  }
  // Timestamps are appended in order, so expired ones are a prefix.
  let expired = 0;
  while (expired < hits.length && hits[expired] <= since) expired++;
  if (expired > 0) hits.splice(0, expired);

  if (hits.length >= limit) {
    return { ok: false, remaining: 0, resetAt: hits[0] + windowMs };
  }
  hits.push(now);
  return { ok: true, remaining: limit - hits.length, resetAt: hits[0] + windowMs };
}

/**
 * Route-handler helper: returns a ready-to-send 429 when `key` is over its
 * limit, else null. Usage: `const limited = rateLimit(...); if (limited) return limited;`
 */
export function rateLimit(key: string, limit: number, windowMs: number): Response | null {
  const r = check(key, limit, windowMs);
  if (r.ok) return null;
  const retryAfterSec = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
  return Response.json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "retry-after": String(retryAfterSec) } }
  );
}

/** Test hook: clear all counters. */
export function resetRateLimits(): void {
  buckets.clear();
}
