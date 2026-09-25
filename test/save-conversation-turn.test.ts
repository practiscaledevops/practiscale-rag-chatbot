import { beforeEach, describe, expect, it, vi } from "vitest";

// saveConversationTurn (the chat's end-of-turn / compaction / branch save):
// every row gets a strictly increasing created_at (a multi-row insert would
// otherwise stamp them all with one now(), and the created_at-ordered loader
// could rebuild the thread out of order), and its bounds match /api/chat.
// The session and Supabase are mocked.

const CONVERSATION_ID = "55555555-5555-4555-8555-555555555555";

const m = vi.hoisted(() => ({ getUser: vi.fn(), inserted: [] as Record<string, unknown>[][] }));

vi.mock("@/lib/auth", () => ({ getUser: m.getUser }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      update: () => builder,
      delete: () => builder,
      maybeSingle: async () => ({ data: { id: CONVERSATION_ID, title: "Existing" }, error: null }),
      insert: (rows: Record<string, unknown>[] | Record<string, unknown>) => {
        if (Array.isArray(rows)) m.inserted.push(rows);
        return { ...builder, then: (r: (v: unknown) => unknown) => r({ error: null }) };
      },
      then: (r: (v: unknown) => unknown) => r({ error: null }),
    });
    // The thread is replaced in one step (lib/replace-messages → replace_conversation_messages).
    const rpc = async (_fn: string, args: { p_rows: Record<string, unknown>[] }) => {
      m.inserted.push(args.p_rows);
      return { data: null, error: null };
    };
    return { from: () => builder, rpc };
  },
}));

import { saveConversationTurn } from "@/app/(app)/_components/actions";

const turns = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `turn ${i}`,
  }));

beforeEach(() => {
  m.inserted.length = 0;
  m.getUser.mockResolvedValue({ id: "u-1" });
});

describe("saveConversationTurn", () => {
  it("stamps rows with strictly increasing created_at, in list order", async () => {
    const messages = [
      ...turns(4),
      { role: "system" as const, content: "[Conversation summary]\nrecap" },
      ...turns(4),
    ];
    const res = await saveConversationTurn({ conversationId: CONVERSATION_ID, tier: "recommended", messages });
    expect(res.ok).toBe(true);
    expect(m.inserted).toHaveLength(1);
    const rows = m.inserted[0];
    expect(rows.map((r) => r.content)).toEqual(messages.map((x) => x.content));
    const stamps = rows.map((r) => Date.parse(String(r.created_at)));
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
  });

  it("saves threads longer than 500 messages (bounds match /api/chat)", async () => {
    const res = await saveConversationTurn({ conversationId: CONVERSATION_ID, tier: "fast", messages: turns(600) });
    expect(res.ok).toBe(true);
    expect(m.inserted[0]).toHaveLength(600);
  });

  it("still rejects an unbounded payload", async () => {
    const res = await saveConversationTurn({ conversationId: CONVERSATION_ID, tier: "fast", messages: turns(2001) });
    expect(res).toEqual({ ok: false, error: "invalid" });
    const huge = [{ role: "user" as const, content: "x".repeat(100_001) }];
    expect(await saveConversationTurn({ conversationId: CONVERSATION_ID, tier: "fast", messages: huge })).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});
