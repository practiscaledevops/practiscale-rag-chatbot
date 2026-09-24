import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/conversations bulk PATCH / DELETE. Auth + Supabase are mocked with a
// recording query builder, so we can assert every statement is scoped to the
// signed-in user AND the requested ids, and that the single-id paths still work.

const USER_ID = "11111111-1111-4111-8111-111111111111";

const getUser = vi.fn();
const createSupabaseServerClient = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}));

type Filter = [op: "eq" | "in", column: string, value: unknown];
interface Call {
  table: string;
  op: "select" | "update" | "delete";
  payload?: unknown;
  filters: Filter[];
  select?: string;
  single?: boolean;
}
type Result = { data: unknown; error: { message: string } | null };

/** A chainable stand-in for the supabase-js query builder that records calls. */
function fakeSupabase(respond: (call: Call) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const builder = {
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
          call.filters.push(["eq", column, value]);
          return builder;
        },
        in(column: string, values: unknown) {
          call.filters.push(["in", column, values]);
          return builder;
        },
        select(columns: string) {
          call.select = columns;
          return builder;
        },
        maybeSingle() {
          call.single = true;
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
  };
  createSupabaseServerClient.mockResolvedValue(client);
  return calls;
}

/** Echo back every id in the call's `in` filter as an affected row. */
function echoIds(call: Call): Result {
  const ids = (call.filters.find((f) => f[0] === "in")?.[2] as string[]) ?? [];
  return { data: ids.map((id) => ({ id })), error: null };
}

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/conversations", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const uuids = (n: number) => Array.from({ length: n }, () => randomUUID());

/** The handlers' inferred return type admits undefined; they always respond. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("handler returned no response");
  return value;
}

async function loadRoute() {
  return import("@/app/api/conversations/route");
}

beforeEach(() => {
  getUser.mockReset();
  createSupabaseServerClient.mockReset();
  getUser.mockResolvedValue({ id: USER_ID });
});

describe("PATCH /api/conversations — bulk archive", () => {
  it("rejects a signed-out caller before touching the database", async () => {
    getUser.mockResolvedValue(null);
    const calls = fakeSupabase(echoIds);
    const { PATCH } = await loadRoute();
    const res = must(await PATCH(request("PATCH", { ids: uuids(2), archived: true })));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["empty ids", { ids: [], archived: true }],
    ["more than 200 ids", { ids: uuids(201), archived: true }],
    ["a non-uuid id", { ids: [randomUUID(), "not-a-uuid"], archived: true }],
    ["missing archived", { ids: uuids(2) }],
    ["non-boolean archived", { ids: uuids(2), archived: "yes" }],
    ["extra fields", { ids: uuids(2), archived: true, pinned: false }],
    ["mixed single + bulk", { id: randomUUID(), ids: uuids(2), archived: true }],
    ["ids not an array", { ids: randomUUID(), archived: true }],
  ])("returns 400 for %s", async (_name, body) => {
    const calls = fakeSupabase(echoIds);
    const { PATCH } = await loadRoute();
    const res = must(await PATCH(request("PATCH", body)));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("updates only the user's rows among the requested ids and returns counts", async () => {
    const ids = uuids(3);
    // Pretend the third id belongs to someone else: it isn't matched.
    const calls = fakeSupabase((call) => ({
      data: (call.filters.find((f) => f[0] === "in")![2] as string[])
        .filter((id) => id !== ids[2])
        .map((id) => ({ id })),
      error: null,
    }));
    const { PATCH } = await loadRoute();
    const res = must(await PATCH(request("PATCH", { ids, archived: true })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      archived: true,
      requested: 3,
      updated: 2,
      ids: [ids[0], ids[1]],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: "conversations",
      op: "update",
      payload: { archived: true },
      select: "id",
    });
    expect(calls[0].filters).toContainEqual(["eq", "user_id", USER_ID]);
    expect(calls[0].filters).toContainEqual(["in", "id", ids]);
  });

  it("unarchives with archived: false and de-duplicates ids", async () => {
    const [a, b] = uuids(2);
    const calls = fakeSupabase(echoIds);
    const { PATCH } = await loadRoute();
    const res = must(await PATCH(request("PATCH", { ids: [a, b, a], archived: false })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ archived: false, requested: 2, updated: 2 });
    expect(calls[0].payload).toEqual({ archived: false });
    expect(calls[0].filters).toContainEqual(["in", "id", [a, b]]);
  });

  it("splits large requests into user-scoped batches", async () => {
    const ids = uuids(150);
    const calls = fakeSupabase(echoIds);
    const { PATCH } = await loadRoute();
    const res = must(await PATCH(request("PATCH", { ids, archived: true })));
    expect(await res.json()).toMatchObject({ requested: 150, updated: 150 });
    expect(calls.map((c) => (c.filters.find((f) => f[0] === "in")![2] as string[]).length)).toEqual([100, 50]);
    for (const call of calls) expect(call.filters).toContainEqual(["eq", "user_id", USER_ID]);
  });

  it("explains a missing archived column (pre-migration 0005)", async () => {
    fakeSupabase(() => ({ data: null, error: { message: 'column "archived" does not exist' } }));
    const { PATCH } = await loadRoute();
    const res = must(await PATCH(request("PATCH", { ids: uuids(1), archived: true })));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: "Archiving isn't enabled yet (run migration 0005).",
      updated: 0,
    });
  });

  it("keeps the single-id PATCH working", async () => {
    const id = randomUUID();
    const row = { id, title: "t", pinned: true };
    const calls = fakeSupabase(() => ({ data: row, error: null }));
    const { PATCH } = await loadRoute();
    const res = must(await PATCH(request("PATCH", { id, pinned: true })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversation: row });
    expect(calls[0]).toMatchObject({ op: "update", payload: { pinned: true }, single: true });
    expect(calls[0].filters).toEqual([
      ["eq", "id", id],
      ["eq", "user_id", USER_ID],
    ]);
  });
});

describe("DELETE /api/conversations — bulk delete", () => {
  it("rejects a signed-out caller", async () => {
    getUser.mockResolvedValue(null);
    const calls = fakeSupabase(echoIds);
    const { DELETE } = await loadRoute();
    const res = must(await DELETE(request("DELETE", { ids: uuids(2) })));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["empty ids", { ids: [] }],
    ["more than 200 ids", { ids: uuids(201) }],
    ["a non-uuid id", { ids: ["nope"] }],
    ["extra fields", { ids: uuids(1), archived: true }],
    ["mixed single + bulk", { id: randomUUID(), ids: uuids(1) }],
  ])("returns 400 for %s", async (_name, body) => {
    const calls = fakeSupabase(echoIds);
    const { DELETE } = await loadRoute();
    const res = must(await DELETE(request("DELETE", body)));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("deletes only the user's conversations among the ids (messages cascade) and returns counts", async () => {
    const ids = uuids(2);
    const calls = fakeSupabase(echoIds);
    const { DELETE } = await loadRoute();
    const res = must(await DELETE(request("DELETE", { ids })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, requested: 2, deleted: 2, ids });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "conversations", op: "delete", select: "id" });
    expect(calls[0].filters).toContainEqual(["eq", "user_id", USER_ID]);
    expect(calls[0].filters).toContainEqual(["in", "id", ids]);
    // Same as the single delete: messages go via the FK cascade, not a second query.
    expect(calls.every((c) => c.table === "conversations")).toBe(true);
  });

  it("reports what was deleted before a failing batch", async () => {
    const ids = uuids(120);
    let n = 0;
    fakeSupabase((call) => (++n === 1 ? echoIds(call) : { data: null, error: { message: "boom" } }));
    const { DELETE } = await loadRoute();
    const res = must(await DELETE(request("DELETE", { ids })));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "boom", requested: 120, deleted: 100 });
  });

  it("keeps the single-id DELETE working", async () => {
    const id = randomUUID();
    const calls = fakeSupabase(() => ({ data: null, error: null }));
    const { DELETE } = await loadRoute();
    const res = must(await DELETE(request("DELETE", { id })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ table: "conversations", op: "delete" });
    expect(calls[0].filters).toEqual([
      ["eq", "id", id],
      ["eq", "user_id", USER_ID],
    ]);
  });
});
