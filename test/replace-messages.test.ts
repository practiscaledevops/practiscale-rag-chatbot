import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Every save replaces a thread's rows. lib/replace-messages does it in ONE
// call (replace_conversation_messages, migration 0014) so two saves can't
// interleave into a duplicated thread — and falls back to delete + insert
// until that migration has run.

interface Call {
  op: string;
  args?: unknown;
  filters?: [string, unknown][];
}

/** A recording client whose rpc answers `rpcError`. */
function client(rpcError: { message: string; code?: string } | null) {
  const calls: Call[] = [];
  const db = {
    rpc(fn: string, args: unknown) {
      calls.push({ op: `rpc:${fn}`, args });
      return Promise.resolve({ data: null, error: rpcError });
    },
    from(table: string) {
      return {
        delete() {
          const call: Call = { op: `delete:${table}`, filters: [] };
          calls.push(call);
          const b = {
            eq(col: string, val: unknown) {
              call.filters!.push([col, val]);
              return b;
            },
            then: (r: (v: unknown) => unknown) => r({ error: null }),
          };
          return b;
        },
        insert(rows: unknown) {
          calls.push({ op: `insert:${table}`, args: rows });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const ROW = { role: "user", content: "Hi", citations: [], input_tokens: 1, output_tokens: 0, created_at: "2026-01-01T00:00:00.000Z" };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("replaceConversationMessages", () => {
  it("replaces the thread in one call when the function exists", async () => {
    const { replaceConversationMessages } = await import("@/lib/replace-messages");
    const { db, calls } = client(null);
    expect(await replaceConversationMessages(db, "c-1", "u-1", [ROW])).toBeNull();
    expect(calls).toEqual([{ op: "rpc:replace_conversation_messages", args: { p_conversation_id: "c-1", p_rows: [ROW] } }]);
  });

  it("falls back to delete + insert before migration 0014, re-checking after a minute", async () => {
    const { replaceConversationMessages } = await import("@/lib/replace-messages");
    const { db, calls } = client({ code: "PGRST202", message: "Could not find the function public.replace_conversation_messages" });
    expect(await replaceConversationMessages(db, "c-1", "u-1", [ROW])).toBeNull();
    expect(calls.map((c) => c.op)).toEqual(["rpc:replace_conversation_messages", "delete:messages", "insert:messages"]);
    expect(calls[1].filters).toEqual([
      ["conversation_id", "c-1"],
      ["user_id", "u-1"],
    ]);
    expect(calls[2].args).toEqual([{ conversation_id: "c-1", user_id: "u-1", ...ROW }]);

    calls.length = 0;
    await replaceConversationMessages(db, "c-1", "u-1", []);
    expect(calls.map((c) => c.op)).toEqual(["delete:messages"]);

    calls.length = 0;
    vi.advanceTimersByTime(60_000);
    await replaceConversationMessages(db, "c-1", "u-1", [ROW]);
    expect(calls[0].op).toBe("rpc:replace_conversation_messages");
  });

  it("returns any other error from the function without writing again", async () => {
    const { replaceConversationMessages } = await import("@/lib/replace-messages");
    const { db, calls } = client({ code: "42501", message: "new row violates row-level security policy" });
    expect(await replaceConversationMessages(db, "c-1", "u-1", [ROW])).toMatchObject({ code: "42501" });
    expect(calls).toHaveLength(1);
  });
});
