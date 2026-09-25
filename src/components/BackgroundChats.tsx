"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useAppShell } from "@/components/AppShell";
import {
  QUEUE_SETTLE_MS,
  bindChatSessionsOwner,
  dequeueTurn,
  getChatSession,
  markDone,
  markInflight,
  notifyChatFinished,
  onChatFinished,
  queuedTurnBody,
  recordFinished,
  releaseChat,
  requestComposerFocus,
  setQueuePaused,
  trackedFetch,
  turnUsage,
  useChatSession,
  useHandedOffChats,
  useViewingChat,
  type ChatFinishedEvent,
} from "@/lib/chat-sessions";

/** How long an "answer ready" notice stays (paused while hovered, focused, or the tab is hidden). */
const TOAST_MS = 6000;
/** At most this many notices at once (the oldest goes first). */
const MAX_TOASTS = 3;

/**
 * Keeps one chat going while no ChatView shows it: the user navigated away
 * mid-answer, or with turns still queued. Headless. Its useChat shares the
 * chat's cache entry (same `id`), so it observes the stream its view started,
 * then sends the queued turns in order as each answer settles. Turns that
 * finish here are saved server-side by /api/chat (captureAndSaveTurn); usage
 * is metered by the onFinish of whichever instance started each request.
 * Releases itself once idle; the chat's ChatView takes it back on mount.
 */
export function BackgroundChatRunner({ id }: { id: string }) {
  const { addUsage } = useAppShell();
  const session = useChatSession(id);
  const { status, append, setData } = useChat({
    id,
    api: "/api/chat",
    fetch: trackedFetch(id),
    experimental_throttle: 100,
    onFinish: (message, { usage }) => {
      recordFinished(id, message.id, message.content ?? "");
      addUsage(turnUsage(message.content, usage));
    },
  });
  const busy = status === "submitted" || status === "streaming";

  // useChat's callbacks change identity every render; the timers read these.
  const appendRef = useRef(append);
  const setDataRef = useRef(setData);
  const busyRef = useRef(busy);
  useEffect(() => {
    appendRef.current = append;
    setDataRef.current = setData;
    busyRef.current = busy;
  });

  // Mirror the answer's state into the store and act when it settles —
  // including an answer that settled between the view unmounting and this
  // runner mounting, or a send that failed before it ever showed as busy (the
  // store still says in flight in both cases).
  const wasBusyRef = useRef(false);
  useEffect(() => {
    const was = wasBusyRef.current || getChatSession(id).inflight;
    wasBusyRef.current = busy;
    if (busy) {
      markInflight(id);
      return;
    }
    markDone(id);
    if (!was) return;
    const failed = status === "error";
    // A failed answer holds the rest of the queue for the user (no-op when empty).
    if (failed) setQueuePaused(id, true);
    const s = getChatSession(id);
    if (s.queue.length === 0 || s.paused) notifyChatFinished(id, !failed);
  }, [busy, status, id]);

  // Send the next queued turn once the chat is idle. The settle delay lets the
  // finished answer's last throttled update land first.
  useEffect(() => {
    if (busy || !session.handedOff || session.inflight || session.preparing) return;
    if (session.paused || session.queue.length === 0) return;
    const timer = window.setTimeout(() => {
      const s = getChatSession(id);
      if (busyRef.current || !s.handedOff || s.inflight || s.preparing || s.paused) return;
      const turn = dequeueTurn(id);
      if (!turn) return;
      // In flight from now: keeps this runner (and the sidebar spinner) until
      // the request settles, even before useChat reports it as submitted.
      markInflight(id);
      setDataRef.current(undefined);
      void appendRef.current({ role: "user", content: turn.text }, { body: queuedTurnBody(turn, s.conversationId) });
    }, QUEUE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [busy, id, session.handedOff, session.inflight, session.preparing, session.paused, session.queue.length]);

  // Idle (nothing in flight, nothing left to send): let the chat go.
  useEffect(() => {
    if (!session.handedOff || busy || session.inflight || session.preparing) return;
    if (session.queue.length > 0 && !session.paused) return;
    releaseChat(id);
  }, [busy, id, session.handedOff, session.inflight, session.preparing, session.paused, session.queue.length]);

  return null;
}

interface Toast extends ChatFinishedEvent {
  key: string;
}

/**
 * The background side of multi-chat generation, rendered once by the app
 * chrome: a runner per chat that is generating with no view on screen, and
 * the "Answer ready in …" notices for chats that finish there.
 */
export function BackgroundChats({
  owner,
  titles,
  onOpen,
}: {
  /** A stable per-user key: sessions never outlive a change of signed-in user. */
  owner: string;
  /** Conversation id → title (the sidebar's), for the notices. */
  titles: ReadonlyMap<string, string>;
  /** Open a conversation (/c/[id]). */
  onOpen: (conversationId: string) => void;
}) {
  const handedOff = useHandedOffChats();
  const viewing = useViewingChat();

  // Runners start only once the store is known to belong to this user.
  const [boundOwner, setBoundOwner] = useState<string | null>(null);
  useEffect(() => {
    bindChatSessionsOwner(owner);
    setBoundOwner(owner);
  }, [owner]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(
    () =>
      onChatFinished((e) =>
        setToasts((prev) =>
          [...prev.filter((t) => t.id !== e.id), { ...e, key: `${e.id}:${Date.now()}` }].slice(-MAX_TOASTS)
        )
      ),
    []
  );
  const dismiss = useCallback((key: string) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }, []);

  // Opening the chat (from here or the sidebar) makes its notice moot.
  useEffect(() => {
    if (viewing) setToasts((prev) => (prev.some((t) => t.id === viewing) ? prev.filter((t) => t.id !== viewing) : prev));
  }, [viewing]);

  return (
    <>
      {boundOwner === owner && handedOff.map((id) => <BackgroundChatRunner key={id} id={id} />)}
      {/* z-[35]: above the mobile scrim (z-30), below the drawer, popovers,
          notifications panel and modals (z-40+), whose backdrops then cover it.
          7rem clears the top bar (56px) and the Evidence panel's header (48px). */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 top-[calc(var(--titlebar-h)_+_7rem)] z-[35] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <ChatToast
            key={t.key}
            toast={t}
            title={(t.conversationId && titles.get(t.conversationId)) || t.title}
            onOpen={onOpen}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </>
  );
}

/** One "Answer ready in “…”" notice: auto-dismisses, held while hovered, focused, or the tab is hidden. */
function ChatToast({
  toast,
  title,
  onOpen,
  onDismiss,
}: {
  toast: Toast;
  title: string | null;
  onOpen: (conversationId: string) => void;
  onDismiss: (key: string) => void;
}) {
  const [held, setHeld] = useState(false);
  // A hidden tab can't show the notice: hold the countdown until the user is
  // back (it then starts again from the full TOAST_MS).
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    onVisibility(); // pick up a change between render and effect
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (held || hidden) return;
    const timer = window.setTimeout(() => onDismiss(toast.key), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [held, hidden, toast.key, onDismiss]);

  // Dismiss unmounts the focused button: from the keyboard (a click with
  // detail 0), hand focus to a neighbouring notice, else the composer. Runs
  // before React removes this notice. Not for a tap or a mouse click, which
  // would pop the on-screen keyboard or hold the neighbour open.
  const rootRef = useRef<HTMLDivElement>(null);
  const dismiss = (e: React.MouseEvent) => {
    if (e.detail === 0) {
      const el = rootRef.current;
      const next = (el?.nextElementSibling ?? el?.previousElementSibling)?.querySelector<HTMLElement>("button");
      if (next) next.focus();
      else document.getElementById("chat-input")?.focus({ preventScroll: true });
    }
    onDismiss(toast.key);
  };

  // Quotes only around a real title, never around the fallback.
  const name = title?.trim() || null;
  const conversationId = toast.conversationId;
  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border bg-surface py-2 pl-3 pr-1.5 text-[13px] text-foreground shadow-soft-lg motion-safe:animate-fadeUp"
    >
      {toast.ok ? (
        <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
      ) : (
        <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      )}
      <p className="line-clamp-2 min-w-0 flex-1 break-words py-px leading-5">
        {toast.ok ? "Answer ready in " : "Couldn’t finish the answer in "}
        {name ? <span className="font-medium">“{name}”</span> : "a background chat"}
      </p>
      {conversationId && (
        <button
          type="button"
          onClick={(e) => {
            // This button unmounts: from the keyboard, the opened chat's
            // composer takes focus (see dismiss for why not on a tap).
            if (e.detail === 0) requestComposerFocus(conversationId);
            onDismiss(toast.key);
            onOpen(conversationId);
          }}
          className="inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium text-accent-strong transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={14} />
      </button>
    </div>
  );
}
