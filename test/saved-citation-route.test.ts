import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  profile: vi.fn(), owned: vi.fn(), messages: vi.fn(), brain: vi.fn(), from: vi.fn(), filter: vi.fn(),
  allowed: vi.fn(), capabilities: vi.fn(), getSession: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({ getSessionProfile: m.profile }));
vi.mock("@/lib/demo/mode", () => ({ isDemo: () => false }));
vi.mock("@/lib/access", () => ({
  accessFromProfile: (profile: unknown) => profile,
  effectiveCapabilities: m.capabilities,
  allowedSourceTypes: m.allowed,
}));
vi.mock("@/lib/brain", () => ({ brainGetCitation: m.brain }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => ({ from: m.from, auth: { getSession: m.getSession } }) }));

import { GET } from "@/app/api/chat/citations/route";

const conversationId = "3287460b-0ac8-4d28-8285-1c00b6d0ff68";
const chunkId = "61d21651-3fc1-49cc-91df-c07041c0a101";
const source = { id: chunkId, name: "Earlier source", snippet: "A source excerpt." };
const read = () => GET(new Request(`http://local.test/api/chat/citations?conversationId=${conversationId}&id=${chunkId}`));

beforeEach(() => {
  vi.clearAllMocks();
  m.profile.mockResolvedValue({ userId: "owner" });
  m.allowed.mockReturnValue(["document"]);
  m.capabilities.mockReturnValue(["chat.knowledge"]);
  m.getSession.mockResolvedValue({ data: { session: { access_token: "current-user-session" } } });
  m.owned.mockResolvedValue({ data: { id: conversationId } });
  m.messages.mockResolvedValue({ data: [{ content: `An earlier answer [${chunkId}].` }] });
  m.brain.mockImplementation(async () => Response.json(source));
  m.from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { m.filter(...args); return query; },
      ilike: (...args: unknown[]) => { m.filter(...args); return query; },
      like: (...args: unknown[]) => { m.filter(...args); return m.messages(); },
      limit: m.messages,
      maybeSingle: m.owned,
    };
    return query;
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

it("resolves a saved answer citation using current source access and no shared cache", async () => {
  const response = await read();
  expect(await response.json()).toEqual(source);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(m.filter).toHaveBeenCalledWith("user_id", "owner");
  expect(m.filter).toHaveBeenCalledWith("role", "assistant");
  expect(m.filter).toHaveBeenCalledWith("content", `%[${chunkId}]%`);
  expect(m.brain).toHaveBeenCalledWith(chunkId, expect.any(AbortSignal), ["document"], undefined);
});

it("denies a different chat, a missing saved citation or a revoked source grant before reading Brain", async () => {
  m.owned.mockResolvedValueOnce({ data: null });
  expect((await read()).status).toBe(404);
  expect(m.messages).not.toHaveBeenCalled();
  m.messages.mockResolvedValueOnce({ data: [{ content: "A different answer." }] });
  expect((await read()).status).toBe(404);
  m.allowed.mockReturnValueOnce(["transcript"]);
  expect((await read()).status).toBe(404);
  expect(m.brain).not.toHaveBeenCalled();
});

it("passes the current scorecard grant without including transcripts", async () => {
  m.allowed.mockReturnValue(["call_score", "transcript"]);
  m.brain.mockImplementation(async () => Response.json({ ...source, source_type: "call_score" }));
  expect(await (await read()).json()).toMatchObject({ id: chunkId, source_type: "call_score" });
  expect(m.brain).toHaveBeenCalledWith(chunkId, expect.any(AbortSignal), ["call_score"], undefined);
});

it("reopens an older GHL answer with the signed-in user's session and exact opportunity ID", async () => {
  const opportunityId = "Opportunity_AaBb123456";
  const ref = `ghl-opportunity:${opportunityId}`;
  const request = () => GET(new Request(`http://local.test/api/chat/citations?conversationId=${conversationId}&id=${ref}`));
  vi.stubEnv("SOURCE_REPORTS_ENABLED", "true");
  m.capabilities.mockReturnValue(["chat.knowledge", "chat.call_review"]);
  m.allowed.mockReturnValue(["document", "transcript"]);
  m.messages.mockResolvedValueOnce({ data: [{ content: `**Current CRM status: won**\n\nOpportunity: ${opportunityId}\nPipeline: p\nStage: s\n\nSource: GoHighLevel, checked at 2026-11-18.` }] });
  expect((await request()).status).toBe(200);
  expect(m.filter).toHaveBeenCalledWith("content", "%Opportunity\\_AaBb123456%");
  expect(m.brain).toHaveBeenCalledWith(ref, expect.any(AbortSignal), ["document", "transcript"], undefined, "current-user-session");

  m.brain.mockClear();
  m.messages.mockResolvedValueOnce({ data: [{ content: `Other record [${ref.toLowerCase()}]` }] });
  expect((await request()).status).toBe(404);
  m.messages.mockResolvedValueOnce({ data: [{ content: `Record [${ref}]` }] });
  m.getSession.mockResolvedValueOnce({ data: { session: null } });
  expect((await request()).status).toBe(404);
  m.capabilities.mockReturnValue(["chat.knowledge"]);
  expect((await request()).status).toBe(404);
  expect(m.brain).not.toHaveBeenCalled();
});
