import { describe, it, expect, vi, afterEach } from "vitest";
import { brainChat, fetchBrainSearchOptions } from "@/lib/brain";

// lib/brain: `knowledgeScope` forwarded to /api/v1/chat, and the scope catalogue
// read from /api/v1/collections with a safe fallback. fetch is stubbed.

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("brainChat knowledgeScope", () => {
  const messages = [{ role: "user" as const, content: "What changed in our offer?" }];

  it("forwards a non-default scope alongside the other narrowing", async () => {
    const fetchFn = stubFetch(async () => new Response("ok"));
    await brainChat(messages, "recommended", "auto", { sourceTypes: ["document"], collectionIds: ["c-1"], knowledgeScope: "playbook" });
    const body = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(body.knowledgeScope).toBe("playbook");
    expect(body.sourceTypes).toEqual(["document"]);
    expect(body.collectionIds).toEqual(["c-1"]);
  });

  it("omits auto / no scope (the Brain's default)", async () => {
    const fetchFn = stubFetch(async () => new Response("ok"));
    await brainChat(messages, "recommended", "auto", { knowledgeScope: "auto" });
    await brainChat(messages, "recommended", "auto");
    for (const call of fetchFn.mock.calls) expect(JSON.parse(String(call[1]?.body))).not.toHaveProperty("knowledgeScope");
  });
});

describe("brainChat capabilities", () => {
  const messages = [{ role: "user" as const, content: "How did the team do?" }];
  const call = (capabilities?: readonly string[]) =>
    brainChat(messages, "recommended", "auto", undefined, undefined, undefined, undefined, undefined, capabilities);

  it("forwards the user's capability ids (de-duplicated, well-formed only)", async () => {
    const fetchFn = stubFetch(async () => new Response("ok"));
    await call(["chat.knowledge", "data.document", "chat.knowledge", "not a capability", "knowledge.conflicts"]);
    const body = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(body.capabilities).toEqual(["chat.knowledge", "data.document", "knowledge.conflicts"]);
  });

  it("sends an empty list as-is (narrows everything) but omits the field when not given", async () => {
    const fetchFn = stubFetch(async () => new Response("ok"));
    await call([]);
    await call();
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body)).capabilities).toEqual([]);
    expect(JSON.parse(String(fetchFn.mock.calls[1][1]?.body))).not.toHaveProperty("capabilities");
  });
});

describe("fetchBrainSearchOptions", () => {
  it("returns the Brain's collections and normalized scopes", async () => {
    stubFetch(async () =>
      json({
        collections: [{ id: "c-1", name: "Brand" }, { id: "", name: "x" }],
        scopes: [
          { id: "auto", label: "Auto", description: "Per question.", sensitive: false },
          { id: "calls", label: "Consultant calls", description: "Call data only.", sensitive: true },
        ],
      })
    );
    const out = await fetchBrainSearchOptions();
    expect(out.collections).toEqual([{ id: "c-1", name: "Brand" }]);
    expect(out.scopes.map((s) => s.id)).toEqual(["auto", "calls"]);
  });

  it("an older Brain without scopes gets the built-in list (no calls)", async () => {
    stubFetch(async () => json({ collections: [{ id: "c-1", name: "Brand" }] }));
    const out = await fetchBrainSearchOptions();
    expect(out.collections).toHaveLength(1);
    expect(out.scopes.map((s) => s.id)).toEqual(["auto", "all", "reality", "playbook", "learning"]);
  });

  it("an unreachable or failing Brain gets the built-in list and no collections", async () => {
    stubFetch(async () => json({ error: "boom" }, 500));
    expect((await fetchBrainSearchOptions()).scopes.map((s) => s.id)).not.toContain("calls");
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const out = await fetchBrainSearchOptions();
    expect(out.collections).toEqual([]);
    expect(out.scopes[0].id).toBe("auto");
  });
});
