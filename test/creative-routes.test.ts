import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ profile: vi.fn(), improve: vi.fn(), limited: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/admin", () => ({ getSessionProfile: m.profile }));
vi.mock("@/lib/brain", () => ({ brainImprovePrompt: m.improve }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: m.limited }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/usage", () => ({ recordUsageEvent: vi.fn() }));
vi.mock("@/lib/settings", () => ({ loadWorkspaceSettings: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => {
  const q = { select: () => q, eq: (...args: unknown[]) => { m.eq(...args); return q; }, order: () => q, limit: async () => ({ data: [{ id: "own", content: "x".repeat(400), conversation_id: "thread" }], error: null }) };
  return { from: () => q };
} }));
import { POST } from "@/app/api/prompt-improve/route";
import { GET } from "@/app/api/creative-history/route";
const request = (prompt: unknown) => new Request("http://localhost/api/prompt-improve", { method: "POST", body: JSON.stringify({ prompt }) });
beforeEach(() => {
  vi.clearAllMocks(); m.profile.mockResolvedValue({ userId: "owner", capabilities: ["chat.knowledge"] }); m.limited.mockReturnValue(null);
  m.improve.mockResolvedValue(Response.json({ improvedPrompt: "A grounded draft", changes: ["Clarified output"], questions: [] }));
});
describe("creative API boundaries", () => {
  it("rejects signed-out and inactive users before provider/history calls", async () => {
    m.profile.mockResolvedValue(null);
    expect((await POST(request("write a post"))).status).toBe(401); expect((await GET()).status).toBe(401);
    expect(m.improve).not.toHaveBeenCalled(); expect(m.eq).not.toHaveBeenCalled();
  });
  it("requires chat capability and enforces prompt size", async () => {
    m.profile.mockResolvedValue({ userId: "owner", capabilities: [] });
    expect((await POST(request("write a post"))).status).toBe(403); expect((await GET()).status).toBe(403);
    m.profile.mockResolvedValue({ userId: "owner", capabilities: ["chat.knowledge"] });
    expect((await POST(request("x".repeat(6001)))).status).toBe(400); expect(m.improve).not.toHaveBeenCalled();
  });
  it("returns a reviewable prompt without generating a chat response", async () => {
    const res = await POST(request("write a post")); expect(res.status).toBe(200);
    expect((await res.json()).improvedPrompt).toBe("A grounded draft"); expect(m.improve).toHaveBeenCalledWith("write a post");
  });
  it("reads only the caller's answers and returns bounded previews", async () => {
    const res = await GET(); const json = await res.json();
    expect(m.eq).toHaveBeenCalledWith("user_id", "owner"); expect(m.eq).toHaveBeenCalledWith("role", "assistant");
    expect(json.drafts[0].content.length).toBe(320);
  });
});
