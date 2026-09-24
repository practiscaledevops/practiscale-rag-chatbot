// Workspace chat limits for the browser: the context-window budget, the
// compaction threshold and the upload limits an admin sets in /admin/settings.
//
// Client-safe: no server imports. The pure shape/defaults/normalizer live in
// lib/attachments-shared (dependency-free) so server code (lib/settings) can use
// the SAME defaults and bounds without importing this module — it imports React
// hooks, which Next forbids in the server graph.
//
// useChatLimits() fetches GET /api/chat-limits once per page load: a SUCCESSFUL
// answer is cached at module level and shared by every caller. A failure (a
// network blip, a 401 during a session refresh) returns the defaults but is NOT
// cached — the next caller retries, and a mounted hook retries with backoff and
// when the window regains focus or goes back online.

import { useEffect, useState } from "react";
import {
  DEFAULT_CHAT_LIMITS,
  normalizeChatLimits,
  type ChatLimits,
} from "@/lib/attachments-shared";

export type { ChatLimits };
export { DEFAULT_CHAT_LIMITS, normalizeChatLimits };

/** The workspace's limits once a request SUCCEEDED (never set from a failure). */
let resolved: ChatLimits | null = null;
/** The single in-flight request shared by every caller on this page. */
let pending: Promise<ChatLimits> | null = null;

/** Retry delays (ms) for a mounted hook while the limits haven't loaded. */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/**
 * Load the workspace chat limits (a success is cached for the page's
 * lifetime). Never rejects: a network error, a non-2xx answer (e.g. signed
 * out) or a malformed body resolve to DEFAULT_CHAT_LIMITS — uncached, so a
 * later call tries again.
 */
export function loadChatLimits(): Promise<ChatLimits> {
  // Browser-only: never cache a (relative-URL) failure in a server module.
  if (typeof window === "undefined") return Promise.resolve(DEFAULT_CHAT_LIMITS);
  if (resolved) return Promise.resolve(resolved);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch("/api/chat-limits", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (res.ok) {
          const limits = normalizeChatLimits(await res.json());
          resolved = limits; // cache ONLY a real answer
          return limits;
        }
      } catch {
        /* fall through to the defaults — limits are a convenience, never a blocker */
      }
      pending = null; // failure: let the next caller retry
      return DEFAULT_CHAT_LIMITS;
    })();
  }
  return pending;
}

/**
 * The workspace chat limits. Returns DEFAULT_CHAT_LIMITS until the shared
 * GET /api/chat-limits request succeeds, then the workspace values. Never throws.
 */
export function useChatLimits(): ChatLimits {
  // Only the first render of the page starts from the defaults; components that
  // mount after the request settled read the cached value straight away.
  const [limits, setLimits] = useState<ChatLimits>(() => resolved ?? DEFAULT_CHAT_LIMITS);

  useEffect(() => {
    let alive = true;
    let attempt = 0;
    let timer: number | undefined;
    const load = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      loadChatLimits().then(
        (next) => {
          if (!alive) return;
          setLimits((cur) => (sameLimits(cur, next) ? cur : next));
          // Not loaded yet (the request failed): retry with backoff.
          if (!resolved && attempt < RETRY_DELAYS_MS.length) {
            timer = window.setTimeout(load, RETRY_DELAYS_MS[attempt++]);
          }
        },
        () => {
          /* loadChatLimits never rejects; guard anyway */
        }
      );
    };
    // Also retry when the page comes back (network restored, tab refocused).
    const retry = () => {
      if (!resolved) load();
    };
    load();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, []);

  return limits;
}

function sameLimits(a: ChatLimits, b: ChatLimits): boolean {
  return (
    a.contextWindowTokens === b.contextWindowTokens &&
    a.compactAtPct === b.compactAtPct &&
    a.autoCompact === b.autoCompact &&
    a.maxImageMb === b.maxImageMb &&
    a.maxFileMb === b.maxFileMb &&
    a.maxFiles === b.maxFiles
  );
}
