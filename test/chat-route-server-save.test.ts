import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/chat saves a finished turn server-side (captureAndSaveTurn, run in
// after()) so an answer that finishes with no chat view mounted — navigated
// away, or a queued turn sent in the background — is kept. It must skip only
// when the stored thread already holds THIS answer. Runs the real route +
// after() callbacks against the in-memory Supabase fake used by demo mode.

const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "u-1";

const m = vi.hoisted(() => ({
  afters: [] as (() => unknown)[],
  getSessionProfile: vi.fn(),
  brainChat: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (cb: () => unknown) => m.afters.push(cb) }));
vi.mock("@/lib/admin", () => ({ getSessionProfile: m.getSessionProfile }));
vi.mock("@/lib/brain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain")>()),
  brainChat: m.brainChat,
  fetchBrainKnowledgeScopes: vi.fn(async () => []),
}));
vi.mock("@/lib/supabase-server", async () => {
  const { fakeSupabase } = await import("@/lib/demo/client");
  return { createSupabaseServerClient: async () => fakeSupabase() };
});
vi.mock("@/lib/project-context", () => ({ loadProjectContextForConversation: vi.fn(async () => null) }));
vi.mock("@/lib/ceo-memory", () => ({ getCeoMemory: vi.fn(async () => "") }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/models", () => ({ fetchBrainModels: vi.fn(async () => []), isSelectionAllowed: () => true }));
vi.mock("@/lib/settings", async () => {
  const shared = await import("@/lib/attachments-shared");
  return {
    CHAT_LIMIT_BOUNDS: shared.CHAT_LIMIT_BOUNDS,
    loadWorkspaceSettings: vi.fn(async () => ({
      settings: { disabledModels: [], chat: shared.DEFAULT_CHAT_LIMITS, pricingOverrides: {} },
      updatedAt: null,
    })),
  };
});
vi.mock("@/lib/usage", () => ({ meterStreamAndRecord: vi.fn(async () => undefined) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/demo/mode", () => ({ isDemo: () => false }));

import { POST } from "@/app/api/chat/route";

type Row = Record<string, unknown>;
const store = () => (globalThis as unknown as { __demoStore: Record<string, Row[]> }).__demoStore;

/** Seed the fake database: the user's conversation and its stored turns. */
function seed(turns: { role: string; content: string }[]) {
  (globalThis as unknown as { __demoStore: Record<string, Row[]> }).__demoStore = {
    conversations: [{ id: CONVERSATION_ID, user_id: USER_ID, title: "Pipeline", updated_at: "2026-01-01T00:00:00.000Z" }],
    messages: turns.map((t, i) => ({
      id: `stored-${i}`,
      conversation_id: CONVERSATION_ID,
      user_id: USER_ID,
      role: t.role,
      content: t.content,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    })),
  };
}

/** The stored thread, in order. */
function thread() {
  return store()
    .messages.filter((r) => r.conversation_id === CONVERSATION_ID)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((r) => ({ role: r.role, content: r.content }));
}

/**
 * Post a turn whose answer streams `answer`. Returns `finish`, which runs that
 * request's after() work (the server-side save) to completion — so a test can
 * let other saves land while the request is still "streaming".
 */
async function startTurn(messages: { role: string; content: string }[], answer: string) {
  m.brainChat.mockImplementationOnce(
    async () =>
      new Response(`0:${JSON.stringify(answer)}\nd:{"finishReason":"stop"}\n`, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
  );
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, conversationId: CONVERSATION_ID }),
    })
  );
  expect(res.status).toBe(200);
  const afters = m.afters.splice(0);
  return async () => {
    const work = Promise.all(afters.map((cb) => cb()));
    // captureAndSaveTurn waits 2.5 s for the client's own save first.
    await vi.advanceTimersByTimeAsync(3000);
    await work;
  };
}

/** Post a turn and run its server-side save to completion. */
async function sendTurn(messages: { role: string; content: string }[], answer: string) {
  await (await startTurn(messages, answer))();
}

let saves = 0;
/** A save of the whole thread from elsewhere (the client, another tab): rows replaced, updated_at bumped. */
function clientSave(turns: { role: string; content: string }[]) {
  const s = store();
  s.messages = [
    ...s.messages.filter((r) => r.conversation_id !== CONVERSATION_ID),
    ...turns.map((t, i) => ({
      id: `client-${saves}-${i}`,
      conversation_id: CONVERSATION_ID,
      user_id: USER_ID,
      role: t.role,
      content: t.content,
      created_at: new Date(Date.UTC(2026, 0, 2, 0, saves, i)).toISOString(),
    })),
  ];
  saves++;
  const conv = s.conversations.find((c) => c.id === CONVERSATION_ID)!;
  conv.updated_at = new Date(Date.UTC(2026, 0, 2, 0, saves)).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  m.afters.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  m.getSessionProfile.mockResolvedValue({
    userId: USER_ID,
    email: null,
    displayName: null,
    role: "user",
    isActive: true,
    permissions: {},
    capabilities: ["chat.knowledge", "modes.general", "data.document"],
    canUseAllModels: false,
    team: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/chat — server-side save of a finished turn", () => {
  it("saves a turn nobody saved (the user navigated away mid-answer)", async () => {
    seed([{ role: "user", content: "q1" }]);
    await sendTurn([{ role: "user", content: "q1" }], "A1");
    expect(thread()).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
    ]);
  });

  it("saves a second queued turn that finished in the background", async () => {
    // The first answer is stored; the queued follow-up and its answer are not.
    seed([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
    ]);
    await sendTurn(
      [
        { role: "user", content: "q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "q2" },
      ],
      "A2"
    );
    expect(thread()).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "A2" },
    ]);
  });

  it("leaves the thread alone when the client already saved this turn", async () => {
    seed([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
    ]);
    const before = store().messages.map((r) => r.id);
    await sendTurn([{ role: "user", content: "q1" }], "A1");
    expect(store().messages.map((r) => r.id)).toEqual(before);
  });

  it("keeps an answer the user stopped as the client saved it", async () => {
    seed([
      { role: "user", content: "q1" },
      { role: "assistant", content: "The top closers" },
    ]);
    const before = store().messages.map((r) => r.id);
    await sendTurn([{ role: "user", content: "q1" }], "The top closers mirror the customer's priority.");
    expect(store().messages.map((r) => r.id)).toEqual(before);
  });

  it("replaces the old thread with an edited message's new branch", async () => {
    seed([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "A2" },
    ]);
    await sendTurn([{ role: "user", content: "q1, edited" }], "A1 for the edit");
    expect(thread()).toEqual([
      { role: "user", content: "q1, edited" },
      { role: "assistant", content: "A1 for the edit" },
    ]);
  });

  it("doesn't bring back a stopped answer over the regenerated one saved since", async () => {
    // Stop at 3 s (the client saves the partial answer), then Regenerate: the
    // new answer is saved by the client. The stopped request's copy reads on
    // to the end and finishes last.
    seed([{ role: "user", content: "q1" }]);
    const stopped = await startTurn([{ role: "user", content: "q1" }], "A1, the stopped answer in full");
    clientSave([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1, the stopped" },
    ]);
    const regenerated = await startTurn([{ role: "user", content: "q1" }], "A1 regenerated");
    clientSave([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1 regenerated" },
    ]);
    await regenerated();
    await stopped();
    expect(thread()).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1 regenerated" },
    ]);
  });

  it("doesn't delete a newer turn when a request stopped before its first token finishes late", async () => {
    seed([{ role: "user", content: "q1" }]);
    const stopped = await startTurn([{ role: "user", content: "q1" }], "A1");
    const next = await startTurn(
      [
        { role: "user", content: "q1" },
        { role: "user", content: "q2" },
      ],
      "A2"
    );
    clientSave([
      { role: "user", content: "q1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "A2" },
    ]);
    await next();
    await stopped();
    expect(thread()).toEqual([
      { role: "user", content: "q1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "A2" },
    ]);
  });

  it("doesn't overwrite an edit saved inside the grace window", async () => {
    seed([{ role: "user", content: "hello" }]);
    const first = await startTurn([{ role: "user", content: "hello" }], "Hi there");
    const edited = await startTurn([{ role: "user", content: "compare" }], "Comparison");
    clientSave([
      { role: "user", content: "compare" },
      { role: "assistant", content: "Comparison" },
    ]);
    // The edit's own copy sees its turn saved; the first request's copy ends last.
    await edited();
    await first();
    expect(thread()).toEqual([
      { role: "user", content: "compare" },
      { role: "assistant", content: "Comparison" },
    ]);
  });

  it("saves back-to-back background turns even when the first one's save lands after the second was sent", async () => {
    // A queued turn goes out 250 ms after the first answer settles — before
    // that answer's own server-side save (2.5 s later) bumps the thread.
    seed([{ role: "user", content: "q1" }]);
    const first = await startTurn([{ role: "user", content: "q1" }], "A1");
    const second = await startTurn(
      [
        { role: "user", content: "q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "q2" },
      ],
      "A2"
    );
    await first();
    await second();
    expect(thread()).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "A2" },
    ]);
  });

  it("writes each thread once when two copies finish together (no duplicated rows)", async () => {
    seed([{ role: "user", content: "q1" }]);
    const a = await startTurn([{ role: "user", content: "q1" }], "A1");
    const b = await startTurn([{ role: "user", content: "q1" }], "A1 again");
    await Promise.all([a(), b()]);
    const rows = thread();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ role: "user", content: "q1" });
  });

  it("replaces an older answer with a regenerated one", async () => {
    seed([
      { role: "user", content: "q1" },
      { role: "assistant", content: "old answer" },
    ]);
    await sendTurn([{ role: "user", content: "q1" }], "new answer");
    expect(thread()).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "new answer" },
    ]);
  });
});
