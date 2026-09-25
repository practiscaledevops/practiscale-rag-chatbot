import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/conversations — creating a new chat's row with the id the chat view
// minted for it (so the saved thread and the in-browser stream share a key).
// The client id is validated, only ever INSERTED as the caller's own row, and a
// taken id falls back to a server-generated one. Auth + Supabase are mocked
// with a recording query builder.

const USER_ID = "11111111-1111-4111-8111-111111111111";

const getUser = vi.fn();
const createSupabaseServerClient = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}));

interface Call {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "rpc";
  payload?: unknown;
  filters: [string, unknown][];
}
type Result = { data: unknown; error: { message: string; code?: string } | null };

/** A chainable stand-in for the supabase-js builder that records every statement. */
function fakeSupabase(respond: (call: Call) => Result) {
  const calls: Call[] = [];
  createSupabaseServerClient.mockResolvedValue({
    // A thread's messages are replaced through replace_conversation_messages.
    rpc(fn: string, args: unknown) {
      const call: Call = { table: fn, op: "rpc", payload: args, filters: [] };
      calls.push(call);
      return Promise.resolve(respond(call));
    },
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const builder = {
        insert(payload: unknown) {
          call.op = "insert";
          call.payload = payload;
          return builder;
        },
        update(payload: unknown) {
          call.op = "update";
          call.payload = payload;
          return builder;
        },
        delete() {
          call.op = "delete";
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        select() {
          return builder;
        },
        single() {
          return builder;
        },
        maybeSingle() {
          return builder;
        },
        then<T1 = Result, T2 = never>(
          onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
          onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
        ) {
          return Promise.resolve(respond(call)).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  });
  return calls;
}

/** Echo an inserted conversation back as the created row (id defaulted like the DB). */
function created(generatedId: string) {
  return (call: Call): Result => {
    if (call.table === "conversations" && call.op === "insert") {
      const row = call.payload as Record<string, unknown>;
      return { data: { id: row.id ?? generatedId, title: row.title, pinned: false }, error: null };
    }
    return { data: null, error: null };
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The handler's inferred return type admits undefined; it always responds. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("handler returned no response");
  return value;
}

async function loadRoute() {
  return import("@/app/api/conversations/route");
}

const inserts = (calls: Call[]) =>
  calls.filter((c) => c.table === "conversations" && c.op === "insert").map((c) => c.payload as Record<string, unknown>);

beforeEach(() => {
  getUser.mockReset();
  createSupabaseServerClient.mockReset();
  getUser.mockResolvedValue({ id: USER_ID });
});

describe("POST /api/conversations — client-supplied id", () => {
  it("creates the caller's row with the chat's own id", async () => {
    const id = randomUUID();
    const calls = fakeSupabase(created(randomUUID()));
    const { POST } = await loadRoute();
    const res = must(await POST(post({ id, tier: "recommended", messages: [{ role: "user", content: "Hi" }] })));
    expect(res.status).toBe(201);
    expect((await res.json()).conversationId).toBe(id);
    const rows = inserts(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, user_id: USER_ID, title: "Hi", model_tier: "recommended" });
  });

  it("still creates with a generated id when none is sent", async () => {
    const generated = randomUUID();
    const calls = fakeSupabase(created(generated));
    const { POST } = await loadRoute();
    const res = must(await POST(post({ tier: "fast" })));
    expect(res.status).toBe(201);
    expect((await res.json()).conversationId).toBe(generated);
    expect(inserts(calls)[0]).not.toHaveProperty("id");
  });

  it.each([
    ["a non-uuid id", "not-a-uuid"],
    ["a number", 42],
    ["an empty string", ""],
  ])("rejects %s with 400 before touching the database", async (_name, id) => {
    const calls = fakeSupabase(created(randomUUID()));
    const { POST } = await loadRoute();
    const res = must(await POST(post({ id, tier: "recommended" })));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("falls back to a generated id when the requested one is taken, never touching that row", async () => {
    const id = randomUUID();
    const generated = randomUUID();
    const calls = fakeSupabase((call) => {
      if (call.table === "conversations" && call.op === "insert") {
        const row = call.payload as Record<string, unknown>;
        if (row.id === id) return { data: null, error: { message: "duplicate key value", code: "23505" } };
        return { data: { id: generated, title: row.title }, error: null };
      }
      return { data: null, error: null };
    });
    const { POST } = await loadRoute();
    const res = must(await POST(post({ id, tier: "recommended", messages: [{ role: "user", content: "Hi" }] })));
    expect(res.status).toBe(201);
    expect((await res.json()).conversationId).toBe(generated);
    const rows = inserts(calls);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(id);
    expect(rows[1]).not.toHaveProperty("id");
    expect(rows.every((r) => r.user_id === USER_ID)).toBe(true);
    // Only inserts on conversations: no update/delete aimed at the taken id.
    expect(calls.filter((c) => c.table === "conversations" && c.op !== "insert")).toHaveLength(0);
    // The first turn is written to the conversation actually created.
    const replaces = calls.filter((c) => c.op === "rpc");
    expect(replaces).toHaveLength(1);
    expect(replaces[0]).toMatchObject({
      table: "replace_conversation_messages",
      payload: { p_conversation_id: generated, p_rows: [{ role: "user", content: "Hi" }] },
    });
  });

  it("does not retry other insert errors", async () => {
    const calls = fakeSupabase((call) =>
      call.op === "insert" ? { data: null, error: { message: "boom", code: "XX000" } } : { data: null, error: null }
    );
    const { POST } = await loadRoute();
    const res = must(await POST(post({ id: randomUUID(), tier: "recommended" })));
    expect(res.status).toBe(500);
    expect(inserts(calls)).toHaveLength(1);
  });

  it("ignores the id when persisting into an existing conversation", async () => {
    const existing = randomUUID();
    const calls = fakeSupabase((call) =>
      call.table === "conversations" && call.op === "select"
        ? { data: { id: existing, title: "Existing" }, error: null }
        : { data: { id: existing }, error: null }
    );
    const { POST } = await loadRoute();
    const res = must(
      await POST(post({ conversationId: existing, id: randomUUID(), messages: [{ role: "user", content: "Hi" }] }))
    );
    expect(res.status).toBe(200);
    expect((await res.json()).conversationId).toBe(existing);
    expect(inserts(calls)).toHaveLength(0);
  });

  it("rejects a signed-out caller", async () => {
    getUser.mockResolvedValue(null);
    const calls = fakeSupabase(created(randomUUID()));
    const { POST } = await loadRoute();
    const res = must(await POST(post({ id: randomUUID() })));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
