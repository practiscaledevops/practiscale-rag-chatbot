// Per-user chat defaults set on the Settings page: which model, work mode,
// response format and knowledge scope a NEW message starts with. A per-viewer
// convenience, so it lives in this browser's localStorage (every read/write is
// guarded — storage can be unavailable in private windows). The composer can
// still override any of these per message.

import type { OutputType } from "@/lib/output-types";
import type { WorkMode } from "@/lib/work-modes";

export interface ChatPrefs {
  /** A model option value (tier token or concrete model id). */
  model?: string;
  mode?: WorkMode;
  outputType?: OutputType;
  collectionIds?: string[];
}

const KEY = "practiscale:prefs";
export const PREFS_EVENT = "prefs:changed";

export function readPrefs(): ChatPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as ChatPrefs) : {};
  } catch {
    return {};
  }
}

export function writePrefs(prefs: ChatPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — the defaults just won't persist */
  }
  window.dispatchEvent(new CustomEvent<ChatPrefs>(PREFS_EVENT, { detail: prefs }));
}
