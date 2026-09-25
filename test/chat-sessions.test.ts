import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortChat,
  bindChatSessionsOwner,
  bindConversation,
  chatKeyFor,
  claimChat,
  clearQueue,
  dequeueTurn,
  discardChat,
  enqueueTurn,
  finishedContent,
  getChatSession,
  SAVE_LAG_MS,
  getBackgroundGeneratingCount,
  getHandedOffChats,
  getInflightChats,
  getViewingChat,
  handoffChat,
  hasUnsavedLocalWork,
  isKnownThread,
  noteSavedThread,
  requestComposerFocus,
  takeComposerFocus,
  touchChat,
  leaveChat,
  markDone,
  markInflight,
  newChatId,
  notifyChatFinished,
  onChatFinished,
  queuedTurnBody,
  recordFinished,
  releaseChat,
  removeQueuedTurn,
  resetChatSessions,
  setChatTitle,
  setPreparing,
  setQueuePaused,
  trackedFetch,
  turnUsage,
  type ChatFinishedEvent,
} from "@/lib/chat-sessions";

// The per-tab chat session store behind background generation + queued turns
// (lib/chat-sessions): queue order, in-flight tracking, hand-off between a
// ChatView and a background runner, "finished in background" events, and the
// abort wiring that lets Stop reach a stream any hook instance started.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A fetch stub that records each call's signal and never resolves. */
function stubFetch() {
  const signals: AbortSignal[] = [];
  const fetchStub = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fetchStub);
  return { fetchStub, signals };
}

beforeEach(() => {
  resetChatSessions();
  // A browser tab (the store only tracks requests in the browser; see the server test below).
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queue", () => {
  it("dequeues in the order turns were queued; `front` jumps ahead", () => {
    enqueueTurn("a", { text: "one" });
    enqueueTurn("a", { text: "two" });
    enqueueTurn("a", { text: "zero" }, { front: true });
    expect(getChatSession("a").queue.map((q) => q.text)).toEqual(["zero", "one", "two"]);
    expect(dequeueTurn("a")?.text).toBe("zero");
    expect(dequeueTurn("a")?.text).toBe("one");
    expect(dequeueTurn("a")?.text).toBe("two");
    expect(dequeueTurn("a")).toBeNull();
  });

  it("hands each turn out once, and keeps chats' queues apart", () => {
    enqueueTurn("a", { text: "for a" });
    enqueueTurn("b", { text: "for b" });
    const first = dequeueTurn("a");
    const second = dequeueTurn("a");
    expect(first?.text).toBe("for a");
    expect(second).toBeNull();
    expect(getChatSession("b").queue.map((q) => q.text)).toEqual(["for b"]);
  });

  it("gives every turn a unique id and keeps its attachments + body", () => {
    const a = enqueueTurn("a", {
      text: "with files",
      attachments: [{ name: "notes.txt", text: "hello" }],
      body: { model: "fast", mode: "general" },
    });
    const b = enqueueTurn("a", { text: "plain" });
    expect(a.id).not.toBe(b.id);
    expect(a.attachments).toEqual([{ name: "notes.txt", text: "hello" }]);
    expect(a.body).toEqual({ model: "fast", mode: "general" });
    expect(b.attachments).toEqual([]);
  });

  it("removes one queued turn by id; clearing empties the queue and un-pauses it", () => {
    const keep = enqueueTurn("a", { text: "keep" });
    const drop = enqueueTurn("a", { text: "drop" });
    removeQueuedTurn("a", drop.id);
    expect(getChatSession("a").queue.map((q) => q.id)).toEqual([keep.id]);

    setQueuePaused("a", true);
    expect(getChatSession("a").paused).toBe(true);
    clearQueue("a");
    expect(getChatSession("a").queue).toEqual([]);
    expect(getChatSession("a").paused).toBe(false);
  });

  it("only pauses a queue that has turns, and an emptied queue is never left paused", () => {
    setQueuePaused("a", true);
    expect(getChatSession("a").paused).toBe(false);

    const only = enqueueTurn("a", { text: "only" });
    setQueuePaused("a", true);
    removeQueuedTurn("a", only.id);
    expect(getChatSession("a").paused).toBe(false);

    enqueueTurn("a", { text: "x" });
    setQueuePaused("a", true);
    dequeueTurn("a");
    expect(getChatSession("a").paused).toBe(false);
  });
});

describe("queuedTurnBody", () => {
  it("uses the settings from queue time, the conversation id known now, and its own attachments", () => {
    const turn = enqueueTurn("a", {
      text: "q",
      attachments: [{ name: "a.txt", text: "A" }],
      body: { model: "max", mode: "sales_coach", conversationId: null, knowledgeScope: "auto" },
    });
    expect(queuedTurnBody(turn, "11111111-1111-4111-8111-111111111111")).toEqual({
      collectionIds: undefined,
      model: "max",
      mode: "sales_coach",
      knowledgeScope: "auto",
      conversationId: "11111111-1111-4111-8111-111111111111",
      attachments: [{ name: "a.txt", text: "A" }],
    });
  });

  it("falls back to the queued conversation id, and never inherits attachments or collections", () => {
    const turn = enqueueTurn("a", { text: "q", body: { conversationId: "c-1", model: "fast" } });
    const body = queuedTurnBody(turn, null);
    expect(body.conversationId).toBe("c-1");
    // Present-but-undefined, so they override (and drop out of) the view's current body.
    expect("attachments" in body && body.attachments === undefined).toBe(true);
    expect("collectionIds" in body && body.collectionIds === undefined).toBe(true);
    const scoped = enqueueTurn("a", { text: "q", body: { collectionIds: ["x"] } });
    expect(queuedTurnBody(scoped, null).collectionIds).toEqual(["x"]);
  });
});

describe("in-flight tracking", () => {
  it("tracks generating chats by conversation id (the key until one is bound)", () => {
    markInflight("key-1");
    expect([...getInflightChats()]).toEqual(["key-1"]);
    bindConversation("key-1", "conv-1");
    expect([...getInflightChats()]).toEqual(["conv-1"]);
    markDone("key-1");
    expect(getInflightChats().size).toBe(0);
  });

  it("counts a send being prepared and turns waiting to go, but not a paused queue", () => {
    setPreparing("a", true);
    expect(getInflightChats().has("a")).toBe(true);
    setPreparing("a", false);
    enqueueTurn("a", { text: "next" });
    expect(getInflightChats().has("a")).toBe(true);
    setQueuePaused("a", true);
    expect(getInflightChats().has("a")).toBe(false);
  });

  it("returns the same Set until membership changes (no re-render per update)", () => {
    markInflight("a");
    const first = getInflightChats();
    setChatTitle("a", "A title");
    markInflight("a");
    expect(getInflightChats()).toBe(first);
    markInflight("b");
    expect(getInflightChats()).not.toBe(first);
  });

  it("keeps several chats generating at once", () => {
    markInflight("a");
    markInflight("b");
    markInflight("c");
    markDone("b");
    expect([...getInflightChats()].sort()).toEqual(["a", "c"]);
  });
});

describe("ownership: view ↔ background runner", () => {
  it("hands a chat with work pending to a runner when its view leaves", () => {
    claimChat("a");
    expect(getViewingChat()).toBe("a");
    markInflight("a");
    leaveChat("a");
    expect(getViewingChat()).toBeNull();
    expect(getChatSession("a").handedOff).toBe(true);
    expect(getHandedOffChats()).toEqual(["a"]);
  });

  it("hands off for a queue or a send being prepared too, but not an idle chat", () => {
    claimChat("q");
    enqueueTurn("q", { text: "later" });
    leaveChat("q");
    claimChat("p");
    setPreparing("p", true);
    leaveChat("p");
    claimChat("idle");
    leaveChat("idle");
    expect(getHandedOffChats()).toEqual(["p", "q"]);
    expect(getChatSession("idle").handedOff).toBe(false);
  });

  it("doesn't hand off a chat whose only work is a paused queue", () => {
    claimChat("a");
    enqueueTurn("a", { text: "held" });
    setQueuePaused("a", true);
    leaveChat("a");
    expect(getChatSession("a").handedOff).toBe(false);
  });

  it("takes the chat back from the runner when its view mounts again", () => {
    claimChat("a");
    markInflight("a");
    leaveChat("a");
    claimChat("a");
    expect(getChatSession("a").handedOff).toBe(false);
    expect(getHandedOffChats()).toEqual([]);
    expect(getViewingChat()).toBe("a");
  });

  it("releases an idle runner, and never hands off the chat on screen", () => {
    handoffChat("a");
    expect(getHandedOffChats()).toEqual(["a"]);
    releaseChat("a");
    expect(getHandedOffChats()).toEqual([]);
    claimChat("b");
    handoffChat("b");
    expect(getChatSession("b").handedOff).toBe(false);
  });

  it("only clears `viewing` for the chat that is leaving", () => {
    claimChat("a");
    claimChat("b");
    leaveChat("a");
    expect(getViewingChat()).toBe("b");
  });

  it("returns a stable, sorted list of handed-off chats", () => {
    handoffChat("b");
    handoffChat("a");
    const list = getHandedOffChats();
    expect(list).toEqual(["a", "b"]);
    markInflight("a");
    expect(getHandedOffChats()).toBe(list);
  });
});

describe("finished-in-background events", () => {
  it("fires for a chat that is not on screen, with its conversation + title", () => {
    const seen: ChatFinishedEvent[] = [];
    const off = onChatFinished((e) => seen.push(e));
    bindConversation("a", "conv-a");
    setChatTitle("a", "  Pipeline review  ");
    claimChat("b");
    expect(notifyChatFinished("a", true)).toBe(true);
    expect(seen).toEqual([{ id: "a", conversationId: "conv-a", title: "Pipeline review", ok: true }]);
    off();
    notifyChatFinished("a", false);
    expect(seen).toHaveLength(1);
  });

  it("stays quiet for the chat on screen", () => {
    const listener = vi.fn();
    const off = onChatFinished(listener);
    claimChat("a");
    expect(notifyChatFinished("a", true)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("reports failures too", () => {
    const listener = vi.fn();
    const off = onChatFinished(listener);
    notifyChatFinished("a", false);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: "a", ok: false }));
    off();
  });
});

describe("finished content + usage", () => {
  it("remembers the full text of the chat's last finished answer", () => {
    recordFinished("a", "m-1", "full answer");
    expect(finishedContent("a", "m-1")).toBe("full answer");
    expect(finishedContent("a", "m-2")).toBeNull();
    expect(finishedContent("b", "m-1")).toBeNull();
  });

  it("meters the stream's counts, else estimates from the answer", () => {
    expect(turnUsage("abc", { promptTokens: 1200, completionTokens: 80 })).toEqual({
      promptTokens: 1200,
      completionTokens: 80,
    });
    expect(turnUsage("abc", { promptTokens: 1200, completionTokens: Number.NaN })).toEqual({
      promptTokens: 1200,
      completionTokens: 0,
    });
    expect(turnUsage("x".repeat(40), { promptTokens: Number.NaN, completionTokens: Number.NaN })).toEqual({
      promptTokens: 0,
      completionTokens: 10,
    });
    expect(turnUsage(undefined, undefined)).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});

describe("trackedFetch + abortChat", () => {
  it("is one stable wrapper per chat", () => {
    expect(trackedFetch("a")).toBe(trackedFetch("a"));
    expect(trackedFetch("a")).not.toBe(trackedFetch("b"));
  });

  it("doesn't cache or track anything during a server render", async () => {
    vi.unstubAllGlobals(); // no `window`: the server
    const fetchStub = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchStub);
    const f = trackedFetch("server-chat");
    expect(trackedFetch("server-chat")).not.toBe(f);
    await f("/api/chat", {});
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(abortChat("server-chat")).toBe(false);
  });

  it("lets abortChat stop the request whichever instance started it", () => {
    const { fetchStub, signals } = stubFetch();
    const outer = new AbortController();
    void trackedFetch("a")("/api/chat", { method: "POST", body: "{}", signal: outer.signal });
    expect(fetchStub).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST", body: "{}" }));
    // The real fetch gets the chat's own signal, not useChat's.
    expect(signals[0]).not.toBe(outer.signal);
    expect(signals[0].aborted).toBe(false);
    expect(abortChat("a")).toBe(true);
    expect(signals[0].aborted).toBe(true);
    // Nothing left to stop.
    expect(abortChat("a")).toBe(false);
  });

  it("still honours useChat's own stop() (its signal is linked)", () => {
    const { signals } = stubFetch();
    const outer = new AbortController();
    void trackedFetch("a")("/api/chat", { signal: outer.signal });
    outer.abort();
    expect(signals[0].aborted).toBe(true);
  });

  it("starts already aborted when useChat's signal is", () => {
    const { signals } = stubFetch();
    const outer = new AbortController();
    outer.abort();
    void trackedFetch("a")("/api/chat", { signal: outer.signal });
    expect(signals[0].aborted).toBe(true);
  });

  it("stops only the chat asked, and the latest request of it", () => {
    const { signals } = stubFetch();
    void trackedFetch("a")("/api/chat", {});
    void trackedFetch("b")("/api/chat", {});
    void trackedFetch("a")("/api/chat", {});
    abortChat("a");
    expect(signals.map((s) => s.aborted)).toEqual([false, false, true]);
  });

  it("abortChat without a request is a no-op", () => {
    expect(abortChat("nothing")).toBe(false);
  });
});

describe("discard, reset, owner", () => {
  it("discards a deleted chat by its conversation id: stops it, drops its queue, frees its runner", () => {
    const { signals } = stubFetch();
    bindConversation("key-1", "conv-1");
    expect(chatKeyFor("conv-1")).toBe("key-1");
    void trackedFetch("key-1")("/api/chat", {});
    markInflight("key-1");
    enqueueTurn("key-1", { text: "later" });
    handoffChat("key-1");
    discardChat("conv-1");
    expect(signals[0].aborted).toBe(true);
    const s = getChatSession("key-1");
    expect(s.queue).toEqual([]);
    expect(s.handedOff).toBe(false);
    expect(s.inflight).toBe(false);
    expect(getInflightChats().size).toBe(0);
  });

  it("maps a conversation id to itself when there's no alias", () => {
    expect(chatKeyFor("conv-9")).toBe("conv-9");
    bindConversation("same", "same");
    expect(chatKeyFor("same")).toBe("same");
  });

  it("doesn't reset on the first sign-in of a page load", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/chat-sessions");
    fresh.enqueueTurn("a", { text: "queued before the owner was known" });
    expect(fresh.bindChatSessionsOwner("ana@example.com")).toBe(false);
    expect(fresh.getChatSession("a").queue).toHaveLength(1);
  });

  it("drops the previous user's sessions when someone else signs in on the tab", () => {
    bindChatSessionsOwner("ana@example.com");
    enqueueTurn("a", { text: "Ana's queued turn" });
    handoffChat("a");
    expect(bindChatSessionsOwner("ana@example.com")).toBe(false);
    expect(getChatSession("a").queue).toHaveLength(1);
    expect(bindChatSessionsOwner("ben@example.com")).toBe(true);
    expect(getChatSession("a").queue).toEqual([]);
    expect(getHandedOffChats()).toEqual([]);
  });

  it("drops work left behind by a sign-out when the next user signs in", () => {
    bindChatSessionsOwner("alice@example.com");
    resetChatSessions(); // the sidebar's sign-out
    // A new chat's send resolves while the app is still unmounting: its first
    // turn is queued and handed to a runner.
    enqueueTurn("a", { text: "Alice's first turn" }, { front: true });
    setChatTitle("a", "Alice's chat");
    handoffChat("a");
    expect(bindChatSessionsOwner("bob@example.com")).toBe(true);
    expect(getHandedOffChats()).toEqual([]);
    expect(getChatSession("a").queue).toEqual([]);
    expect(getChatSession("a").title).toBeNull();
  });

  it("drops it too when the same user signs back in (sign-out ends their session)", () => {
    bindChatSessionsOwner("alice@example.com");
    resetChatSessions();
    enqueueTurn("a", { text: "left over" });
    handoffChat("a");
    expect(bindChatSessionsOwner("alice@example.com")).toBe(true);
    expect(getHandedOffChats()).toEqual([]);
  });

  it("reset stops every stream and forgets every session", () => {
    const { signals } = stubFetch();
    void trackedFetch("a")("/api/chat", {});
    void trackedFetch("b")("/api/chat", {});
    markInflight("a");
    claimChat("b");
    resetChatSessions();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(getInflightChats().size).toBe(0);
    expect(getViewingChat()).toBeNull();
  });
});

describe("newChatId", () => {
  it("mints v4 UUIDs (accepted as a conversation id)", () => {
    const a = newChatId();
    expect(a).toMatch(UUID_V4);
    expect(newChatId()).not.toBe(a);
  });

  it("still mints v4 UUIDs without crypto.randomUUID (insecure contexts)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => real.getRandomValues(b) });
    expect(newChatId()).toMatch(UUID_V4);
  });
});

describe("saved copy vs this tab's copy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a chat as having unsaved work while it generates and for the save window after", () => {
    expect(hasUnsavedLocalWork("a")).toBe(false);
    markInflight("a");
    expect(hasUnsavedLocalWork("a")).toBe(true);
    markDone("a"); // the answer settled: the server save may still be on its way
    vi.advanceTimersByTime(SAVE_LAG_MS - 1);
    expect(hasUnsavedLocalWork("a")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hasUnsavedLocalWork("a")).toBe(false);
  });

  it("doesn't start the window when nothing was in flight, but a finished save does", () => {
    markDone("a");
    expect(hasUnsavedLocalWork("a")).toBe(false);
    touchChat("a");
    expect(hasUnsavedLocalWork("a")).toBe(true);
  });

  it("counts turns still waiting to be sent", () => {
    enqueueTurn("a", { text: "later" });
    expect(hasUnsavedLocalWork("a")).toBe(true);
  });

  it("remembers which saved threads this tab has already seen, per chat", () => {
    const thread = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
    ];
    expect(isKnownThread("a", thread)).toBe(false);
    noteSavedThread("a", thread);
    expect(isKnownThread("a", thread)).toBe(true);
    expect(isKnownThread("a", thread.map((r) => ({ ...r })))).toBe(true);
    expect(isKnownThread("b", thread)).toBe(false);
    expect(isKnownThread("a", [thread[0], { role: "assistant", content: "A1 regenerated" }])).toBe(false);
    expect(isKnownThread("a", [{ role: "assistant", content: "q1" }, thread[1]])).toBe(false);
    // Row boundaries count: the same text split differently is another thread.
    expect(isKnownThread("a", [{ role: "user", content: "q1A1" }])).toBe(false);
  });

  it("forgets it all on reset, and a deleted chat's on discard", () => {
    noteSavedThread("a", [{ role: "user", content: "q1" }]);
    touchChat("a");
    discardChat("a");
    expect(isKnownThread("a", [{ role: "user", content: "q1" }])).toBe(false);
    expect(hasUnsavedLocalWork("a")).toBe(false);
    noteSavedThread("b", []);
    resetChatSessions();
    expect(isKnownThread("b", [])).toBe(false);
  });
});

describe("composer focus after opening a chat from a notice", () => {
  it("is a one-shot request for that conversation only", () => {
    requestComposerFocus("conv-1");
    expect(takeComposerFocus(null)).toBe(false);
    expect(takeComposerFocus("conv-2")).toBe(false);
    expect(takeComposerFocus("conv-1")).toBe(true);
    expect(takeComposerFocus("conv-1")).toBe(false);
  });
});

describe("background generating count", () => {
  it("counts chats generating off screen", () => {
    expect(getBackgroundGeneratingCount()).toBe(0);
    markInflight("a");
    enqueueTurn("b", { text: "queued" });
    expect(getBackgroundGeneratingCount()).toBe(2);
    claimChat("a"); // on screen now
    expect(getBackgroundGeneratingCount()).toBe(1);
    setQueuePaused("b", true);
    expect(getBackgroundGeneratingCount()).toBe(0);
    leaveChat("a");
    expect(getBackgroundGeneratingCount()).toBe(1);
  });
});
