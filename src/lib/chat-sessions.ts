// Chat sessions in this tab: what lets several chats generate at once, and a
// chat keep going (and keep sending queued turns) after the user navigates
// away — the ChatGPT / Claude behaviour.
//
// useChat (@ai-sdk/react) keeps each chat's messages / status / stream data in
// the global SWR cache keyed by its `id`, and its request loop keeps running
// (and writing to that cache) after the component that started it unmounts. So
// a stream already survives navigation; what it lacks is an OWNER once its
// ChatView is gone. This module is that bookkeeping, per chat key:
//   - inflight   an answer is generating (synced from useChat's status by the
//                chat's owner);
//   - preparing  a send is being prepared (a new chat's row is being created);
//   - queue      turns sent while an answer streamed, sent in order after it;
//   - paused     the queue waits for the user (after an error or Stop);
//   - handedOff  a headless <BackgroundChatRunner> owns the chat (its ChatView
//                unmounted with work pending);
//   - conversationId / title  the saved thread the key belongs to;
//   - the abort handle of the chat's latest request (trackedFetch), so Stop
//     works whichever hook instance started the stream;
//   - when this tab last changed the chat and which saved threads it has seen,
//     so a re-opened chat can tell newer saved rows from its own copy.
//
// Ownership: the chat's mounted ChatView owns it; otherwise its runner does
// (claimChat / leaveChat / releaseChat move it). dequeueTurn is atomic, so two
// owners racing for one ready transition can never send the same turn twice.
//
// Client state only (module level, one per tab): nothing here is sent anywhere
// or read on the server. Hooks read it through useSyncExternalStore.

import { useSyncExternalStore } from "react";
import type { ChatAttachment } from "@/lib/attachments-shared";

/**
 * How long a chat waits after an answer settles before sending its next queued
 * turn. useChat throttles message updates (≤ 100 ms here), so the last chunk of
 * the finished answer lands in the cache first and the next request is built on
 * the full answer, not a truncated copy.
 */
export const QUEUE_SETTLE_MS = 250;

/** A turn the user sent while an answer was streaming. */
export interface QueuedTurn {
  id: string;
  /** The user message (a default naming the files for an attachments-only turn). */
  text: string;
  /** Extracted attachment text, already uploaded when the turn was queued. */
  attachments: readonly ChatAttachment[];
  /** The /api/chat body fields (model, mode, scope, …) chosen when it was queued. */
  body: Readonly<Record<string, unknown>>;
  queuedAt: number;
}

export interface ChatSession {
  /** The chat's key (useChat `id`): its conversation id, or a new chat's minted id. */
  id: string;
  inflight: boolean;
  preparing: boolean;
  queue: readonly QueuedTurn[];
  paused: boolean;
  handedOff: boolean;
  /** The saved conversation this chat writes to, once known. */
  conversationId: string | null;
  title: string | null;
}

/** Fired when a chat that is NOT on screen finishes generating. */
export interface ChatFinishedEvent {
  id: string;
  conversationId: string | null;
  title: string | null;
  /** false when the answer failed. */
  ok: boolean;
}

interface State {
  sessions: Readonly<Record<string, ChatSession>>;
  /** The chat key currently on screen (a mounted ChatView), if any. */
  viewing: string | null;
}

const NO_SESSIONS: Readonly<Record<string, ChatSession>> = Object.freeze({});
const EMPTY_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_LIST: readonly string[] = [];
const INITIAL: State = { sessions: NO_SESSIONS, viewing: null };

let state: State = INITIAL;
/** Owner after an explicit sign-out: matches no user, so the next bind always resets. */
const SIGNED_OUT = "\u0000signed-out";
/** Who the sessions belong to (see bindChatSessionsOwner); null until the first bind on a page load. */
let owner: string | null = null;
const listeners = new Set<() => void>();
const finishedListeners = new Set<(e: ChatFinishedEvent) => void>();
/** Latest request's abort handle per chat (see trackedFetch). */
const controllers = new Map<string, AbortController>();
/** One stable fetch wrapper per chat (useChat re-creates its callbacks when `fetch` changes). */
const fetchers = new Map<string, typeof globalThis.fetch>();
/** The complete text of each chat's last finished answer (see recordFinished). */
const finished = new Map<string, { messageId: string; content: string }>();
/** When this tab last changed a chat locally (an answer settled, a save finished). */
const touched = new Map<string, number>();
/** Fingerprints of the saved threads this tab has seen per chat (loaded on open, or saved by it). */
const knownThreads = new Map<string, Set<number>>();
/** conversation id → chat key, when a new chat's row got a different id than its key. */
const aliases = new Map<string, string>();
/** Stable empty sessions, so a hook reading an unknown chat gets the same object each time. */
const blanks = new Map<string, ChatSession>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function blankFor(id: string): ChatSession {
  let b = blanks.get(id);
  if (!b) {
    b = Object.freeze({
      id,
      inflight: false,
      preparing: false,
      queue: [],
      paused: false,
      handedOff: false,
      conversationId: null,
      title: null,
    });
    blanks.set(id, b);
  }
  return b;
}

/** Apply `fn` to one chat's session; a no-op (no emit) when it returns the same object. */
function update(id: string, fn: (s: ChatSession) => ChatSession): void {
  const cur = state.sessions[id] ?? blankFor(id);
  const next = fn(cur);
  if (next === cur) return;
  state = { ...state, sessions: { ...state.sessions, [id]: next } };
  emit();
}

function patch(id: string, fields: Partial<Omit<ChatSession, "id">>): void {
  update(id, (s) => {
    for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
      if (s[k] !== fields[k]) return { ...s, ...fields };
    }
    return s;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The chat's current session (a stable blank one for a chat never touched). */
export function getChatSession(id: string): ChatSession {
  return state.sessions[id] ?? blankFor(id);
}

/** The chat key on screen, or null. */
export function getViewingChat(): string | null {
  return state.viewing;
}

/** A chat counts as generating while it streams, prepares a send, or has turns waiting to go. */
export function isGenerating(s: ChatSession): boolean {
  return s.inflight || s.preparing || (s.queue.length > 0 && !s.paused);
}

/** Work a background runner would carry on with if the chat's view went away. */
function hasPendingWork(s: ChatSession): boolean {
  return isGenerating(s);
}

let inflightMemo: { from: State["sessions"]; value: ReadonlySet<string> } = { from: NO_SESSIONS, value: EMPTY_SET };

/**
 * Conversation ids (the chat key for a chat not saved yet) of every chat that
 * is generating — for the sidebar's spinners. Same Set until the membership
 * changes, so consumers only re-render when a chat starts or stops.
 */
export function getInflightChats(): ReadonlySet<string> {
  if (inflightMemo.from === state.sessions) return inflightMemo.value;
  const next = new Set<string>();
  for (const s of Object.values(state.sessions)) {
    if (isGenerating(s)) next.add(s.conversationId ?? s.id);
  }
  const prev = inflightMemo.value;
  const same = next.size === prev.size && [...next].every((x) => prev.has(x));
  inflightMemo = { from: state.sessions, value: same ? prev : next };
  return inflightMemo.value;
}

let backgroundMemo: { from: State["sessions"]; viewing: string | null; value: number } = {
  from: NO_SESSIONS,
  viewing: null,
  value: 0,
};

/** How many chats are generating while NOT on screen (for the collapsed-rail indicator). */
export function getBackgroundGeneratingCount(): number {
  if (backgroundMemo.from === state.sessions && backgroundMemo.viewing === state.viewing) return backgroundMemo.value;
  let n = 0;
  for (const s of Object.values(state.sessions)) if (s.id !== state.viewing && isGenerating(s)) n++;
  backgroundMemo = { from: state.sessions, viewing: state.viewing, value: n };
  return n;
}

let handedOffMemo: { from: State["sessions"]; value: readonly string[] } = { from: NO_SESSIONS, value: EMPTY_LIST };

/** Chat keys a background runner owns, in a stable order (same array until it changes). */
export function getHandedOffChats(): readonly string[] {
  if (handedOffMemo.from === state.sessions) return handedOffMemo.value;
  const next = Object.values(state.sessions)
    .filter((s) => s.handedOff)
    .map((s) => s.id)
    .sort();
  const prev = handedOffMemo.value;
  const same = next.length === prev.length && next.every((x, i) => x === prev[i]);
  handedOffMemo = { from: state.sessions, value: same ? prev : next };
  return handedOffMemo.value;
}

/** The chat key to open a saved conversation under (normally the id itself). */
export function chatKeyFor(conversationId: string): string {
  return aliases.get(conversationId) ?? conversationId;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** The server render's snapshot: no sessions exist there (and nothing is cached per id). */
const SERVER_SESSION: ChatSession = Object.freeze({
  id: "",
  inflight: false,
  preparing: false,
  queue: [],
  paused: false,
  handedOff: false,
  conversationId: null,
  title: null,
});

/** One chat's session (queue, paused, inflight, …), live. */
export function useChatSession(id: string): ChatSession {
  return useSyncExternalStore(
    subscribe,
    () => getChatSession(id),
    () => SERVER_SESSION
  );
}

/** Ids of the chats generating right now (see getInflightChats). */
export function useInflightChats(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getInflightChats, () => EMPTY_SET);
}

/** Chat keys owned by a background runner (see getHandedOffChats). */
export function useHandedOffChats(): readonly string[] {
  return useSyncExternalStore(subscribe, getHandedOffChats, () => EMPTY_LIST);
}

/** The chat key on screen, live. */
export function useViewingChat(): string | null {
  return useSyncExternalStore(subscribe, getViewingChat, () => null);
}

/** Chats generating off screen, live (see getBackgroundGeneratingCount). */
export function useBackgroundGeneratingCount(): number {
  return useSyncExternalStore(subscribe, getBackgroundGeneratingCount, () => 0);
}

// ---------------------------------------------------------------------------
// Lifecycle + ownership
// ---------------------------------------------------------------------------

/** An answer started generating in this chat. */
export function markInflight(id: string): void {
  patch(id, { inflight: true });
}

/** The chat's answer settled (finished, failed or stopped). */
export function markDone(id: string): void {
  if (getChatSession(id).inflight) touchChat(id);
  patch(id, { inflight: false });
}

/** A send is being prepared (e.g. a new chat's conversation row is being created). */
export function setPreparing(id: string, preparing: boolean): void {
  patch(id, { preparing });
}

/** The chat's ChatView mounted: it's on screen and owns the chat (a runner steps aside). */
export function claimChat(id: string): void {
  const s = getChatSession(id);
  if (state.viewing === id && !s.handedOff) return;
  state = {
    viewing: id,
    sessions: s.handedOff ? { ...state.sessions, [id]: { ...s, handedOff: false } } : state.sessions,
  };
  emit();
}

/**
 * The chat's ChatView unmounted. With work pending (streaming, preparing a
 * send, or turns queued) the chat is handed to a background runner.
 */
export function leaveChat(id: string): void {
  const s = state.sessions[id];
  const handOff = !!s && !s.handedOff && hasPendingWork(s);
  const viewing = state.viewing === id ? null : state.viewing;
  if (!handOff && viewing === state.viewing) return;
  state = {
    viewing,
    sessions: handOff ? { ...state.sessions, [id]: { ...s, handedOff: true } } : state.sessions,
  };
  emit();
}

/** Give the chat to a background runner explicitly (e.g. a send that resolved after its view left). */
export function handoffChat(id: string): void {
  if (state.viewing === id) return;
  patch(id, { handedOff: true });
}

/** The runner is done with the chat (idle), or its view took it back. */
export function releaseChat(id: string): void {
  patch(id, { handedOff: false });
}

/** Remember which saved conversation a chat key writes to (and the alias, if the ids differ). */
export function bindConversation(id: string, conversationId: string): void {
  if (conversationId !== id) aliases.set(conversationId, id);
  patch(id, { conversationId });
}

/** The chat's display title (for the "answer ready" notice). */
export function setChatTitle(id: string, title: string | null): void {
  const t = title?.trim() ? title.trim().slice(0, 200) : null;
  if (!t) return;
  patch(id, { title: t });
}

// ---------------------------------------------------------------------------
// Saved copy vs this tab's copy
// ---------------------------------------------------------------------------

/**
 * How long the saved rows may lag this tab's copy of a chat: /api/chat's 2.5 s
 * server-save grace plus the write.
 */
export const SAVE_LAG_MS = 10_000;

/** This tab just changed the chat (an answer settled, a save finished). */
export function touchChat(id: string): void {
  touched.set(id, Date.now());
}

/** True while this tab may hold turns the server doesn't have yet. */
export function hasUnsavedLocalWork(id: string): boolean {
  return isGenerating(getChatSession(id)) || Date.now() - (touched.get(id) ?? Number.NEGATIVE_INFINITY) < SAVE_LAG_MS;
}

/** A thread's fingerprint: its rows' roles and text, in order (53-bit hash). */
export function threadFingerprint(rows: readonly { role: string; content: string }[]): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const mix = (code: number) => {
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  };
  for (const r of rows) {
    for (let i = 0; i < r.role.length; i++) mix(r.role.charCodeAt(i));
    mix(0);
    for (let i = 0; i < r.content.length; i++) mix(r.content.charCodeAt(i));
    mix(1);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** This tab has seen `rows` saved for the chat: it loaded them, or saved them itself. */
export function noteSavedThread(id: string, rows: readonly { role: string; content: string }[]): void {
  let known = knownThreads.get(id);
  if (!known) knownThreads.set(id, (known = new Set()));
  known.add(threadFingerprint(rows));
}

/**
 * Whether this tab has seen `rows` saved for the chat before. Rows it has seen
 * aren't news: a back/forward navigation renders a chat from Next's router
 * cache, not the database, so they can be older than this tab's own copy.
 */
export function isKnownThread(id: string, rows: readonly { role: string; content: string }[]): boolean {
  return knownThreads.get(id)?.has(threadFingerprint(rows)) ?? false;
}

// ---------------------------------------------------------------------------
// Composer focus (a chat opened from an "answer ready" notice)
// ---------------------------------------------------------------------------

/** A conversation whose next ChatView should focus its composer on mount. */
let composerFocusFor: string | null = null;

/** Ask the next ChatView for this conversation to focus its composer (opened from a notice). */
export function requestComposerFocus(conversationId: string): void {
  composerFocusFor = conversationId;
}

/** Whether this conversation's view should focus its composer now (a one-shot request). */
export function takeComposerFocus(conversationId: string | null): boolean {
  if (!conversationId || composerFocusFor !== conversationId) return false;
  composerFocusFor = null;
  return true;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

let turnSeq = 0;

/** Queue a turn to send after the current answer. `front` puts it ahead of the others. */
export function enqueueTurn(
  id: string,
  turn: { text: string; attachments?: readonly ChatAttachment[]; body?: Readonly<Record<string, unknown>> },
  opts: { front?: boolean } = {}
): QueuedTurn {
  const queued: QueuedTurn = {
    id: `q-${Date.now().toString(36)}-${(turnSeq++).toString(36)}`,
    text: turn.text,
    attachments: turn.attachments ?? [],
    body: turn.body ?? {},
    queuedAt: Date.now(),
  };
  update(id, (s) => ({ ...s, queue: opts.front ? [queued, ...s.queue] : [...s.queue, queued] }));
  return queued;
}

/** Take the next queued turn (atomically: a turn is only ever handed out once). */
export function dequeueTurn(id: string): QueuedTurn | null {
  const s = state.sessions[id];
  if (!s || s.queue.length === 0) return null;
  const [next, ...rest] = s.queue;
  update(id, (cur) => ({ ...cur, queue: rest, paused: rest.length === 0 ? false : cur.paused }));
  return next;
}

/** Drop one queued turn (the chip's ×). */
export function removeQueuedTurn(id: string, turnId: string): void {
  update(id, (s) => {
    const queue = s.queue.filter((q) => q.id !== turnId);
    if (queue.length === s.queue.length) return s;
    return { ...s, queue, paused: queue.length === 0 ? false : s.paused };
  });
}

/** Drop every queued turn. */
export function clearQueue(id: string): void {
  const s = getChatSession(id);
  if (s.queue.length === 0 && !s.paused) return;
  patch(id, { queue: [], paused: false });
}

/** Hold (true) or resume (false) sending the queued turns. */
export function setQueuePaused(id: string, paused: boolean): void {
  const s = getChatSession(id);
  if (paused && s.queue.length === 0) return;
  patch(id, { paused });
}

/**
 * The /api/chat body for a queued turn: the settings chosen when it was queued,
 * the chat's conversation id as known NOW (a new chat's row may have been
 * created since), and its own attachments. useChat spreads this over the
 * view's current body, so the optional fields are always present (undefined
 * drops out of the JSON) and never inherit a newer setting or another turn's files.
 */
export function queuedTurnBody(turn: QueuedTurn, conversationId: string | null): Record<string, unknown> {
  const queuedId = typeof turn.body.conversationId === "string" ? turn.body.conversationId : null;
  return {
    collectionIds: undefined,
    ...turn.body,
    conversationId: conversationId ?? queuedId,
    attachments: turn.attachments.length > 0 ? turn.attachments : undefined,
  };
}

// ---------------------------------------------------------------------------
// Finished answers + background notices
// ---------------------------------------------------------------------------

/**
 * Token usage to meter for a finished answer: the stream's exact counts, else
 * (the stream reported none) a rough estimate from the answer's length.
 * Called from the onFinish of the hook instance that STARTED the request, so
 * each turn is counted exactly once wherever it finishes.
 */
export function turnUsage(
  content: string | undefined,
  usage: { promptTokens?: number; completionTokens?: number } | undefined
): { promptTokens: number; completionTokens: number } {
  const prompt = usage?.promptTokens;
  const completion = usage?.completionTokens;
  if (Number.isFinite(prompt) || Number.isFinite(completion)) {
    return {
      promptTokens: Number.isFinite(prompt) ? (prompt as number) : 0,
      completionTokens: Number.isFinite(completion) ? (completion as number) : 0,
    };
  }
  return { promptTokens: 0, completionTokens: Math.ceil((content?.length ?? 0) / 4) };
}

/**
 * Keep the COMPLETE text of the chat's last finished answer (useChat's onFinish
 * message). Its throttled state can lag the finish by a chunk, and whichever
 * hook instance started the request is the one that receives onFinish.
 */
export function recordFinished(id: string, messageId: string, content: string): void {
  finished.set(id, { messageId, content });
}

/** The recorded full text of `messageId` in this chat, or null. */
export function finishedContent(id: string, messageId: string): string | null {
  const f = finished.get(id);
  return f && f.messageId === messageId ? f.content : null;
}

/** Listen for chats finishing in the background. Returns the unsubscribe. */
export function onChatFinished(listener: (e: ChatFinishedEvent) => void): () => void {
  finishedListeners.add(listener);
  return () => {
    finishedListeners.delete(listener);
  };
}

/** Announce that a chat finished — only when it's NOT the one on screen. Returns whether it fired. */
export function notifyChatFinished(id: string, ok: boolean): boolean {
  if (state.viewing === id) return false;
  const s = getChatSession(id);
  const event: ChatFinishedEvent = { id, conversationId: s.conversationId, title: s.title, ok };
  for (const l of finishedListeners) l(event);
  return true;
}

// ---------------------------------------------------------------------------
// Abort wiring
// ---------------------------------------------------------------------------

/**
 * A fetch for useChat's `fetch` option. Each request gets its own
 * AbortController — linked to the signal useChat passes, so the starting
 * instance's own stop() still works — registered under the chat, so
 * abortChat(id) stops the stream from ANY instance (a re-mounted ChatView
 * re-attached to a stream its predecessor or a runner started).
 */
export function trackedFetch(id: string): typeof globalThis.fetch {
  // Server render (ChatView calls this while rendering): nothing to track, and
  // caching per (random, per-request) chat id would only grow the server's heap.
  if (typeof window === "undefined") return (input, init) => globalThis.fetch(input, init);
  let f = fetchers.get(id);
  if (!f) {
    f = (input, init) => {
      const ctrl = new AbortController();
      const outer = init?.signal;
      if (outer) {
        if (outer.aborted) ctrl.abort(outer.reason);
        else outer.addEventListener("abort", () => ctrl.abort(outer.reason), { once: true });
      }
      controllers.set(id, ctrl);
      return globalThis.fetch(input, { ...init, signal: ctrl.signal });
    };
    fetchers.set(id, f);
  }
  return f;
}

/** Stop the chat's current request, whoever started it. Returns whether there was one to stop. */
export function abortChat(id: string): boolean {
  const ctrl = controllers.get(id);
  if (!ctrl) return false;
  controllers.delete(id);
  if (ctrl.signal.aborted) return false;
  ctrl.abort();
  return true;
}

/**
 * Forget a chat that was deleted: stop its stream, drop its queue and let its
 * runner go (a deleted thread must not keep generating or sending).
 */
export function discardChat(conversationId: string): void {
  const id = chatKeyFor(conversationId);
  abortChat(id);
  touched.delete(id);
  knownThreads.delete(id);
  if (!state.sessions[id]) return;
  patch(id, { queue: [], paused: false, handedOff: false, inflight: false, preparing: false });
}

// ---------------------------------------------------------------------------
// Tab-wide
// ---------------------------------------------------------------------------

/**
 * Stop every stream and forget every session (sign-out, or another user signed
 * in). The owner becomes one that matches no user, so whatever is written to
 * the store after an explicit sign-out (e.g. a new chat's send resolving while
 * the app is still unmounting) is dropped by the next sign-in's bind.
 */
export function resetChatSessions(): void {
  for (const ctrl of controllers.values()) ctrl.abort();
  controllers.clear();
  finished.clear();
  aliases.clear();
  touched.clear();
  knownThreads.clear();
  composerFocusFor = null;
  owner = SIGNED_OUT;
  if (state === INITIAL) return;
  state = INITIAL;
  emit();
}

/**
 * Tie the sessions to the signed-in user (any stable per-user key). When a
 * different user is now signed in on this tab — or anyone signs in after an
 * explicit sign-out — everything left over is dropped first: queued turns must
 * never be sent as someone else. Returns true when it reset.
 */
export function bindChatSessionsOwner(user: string): boolean {
  if (owner === user) return false;
  const reset = owner !== null;
  if (reset) resetChatSessions();
  owner = user;
  return reset;
}

/** A new chat's key: a v4 UUID, which the conversation row is then created with. */
export function newChatId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Insecure contexts (plain http on a LAN address) have getRandomValues only.
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
