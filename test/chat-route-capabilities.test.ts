import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/chat capability enforcement: "chat.knowledge" to chat at all,
// "chat.source_scope" for collections + the Search-in scope, "app.projects" for
// project context, and the resolved capability set forwarded to the Brain
// (narrow-only). Session, Brain, Supabase and settings are mocked.

const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const COLLECTION_ID = "33333333-3333-4333-8333-333333333333";

const m = vi.hoisted(() => ({
  getSessionProfile: vi.fn(),
  brainChat: vi.fn(),
  fetchBrainKnowledgeScopes: vi.fn(),
  loadProjectContextForConversation: vi.fn(),
  getCeoMemory: vi.fn(),
}));

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/admin", () => ({ getSessionProfile: m.getSessionProfile }));
vi.mock("@/lib/brain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain")>()),
  brainChat: m.brainChat,
  fetchBrainKnowledgeScopes: m.fetchBrainKnowledgeScopes,
}));
vi.mock("@/lib/supabase-server", () => ({
  // ownedConversationId: from("conversations").select("id").eq("id", …).maybeSingle()
  createSupabaseServerClient: async () => {
    const builder = {
      select: () => builder,
      eq: (_col: string, value: unknown) => {
        builder.id = value;
        return builder;
      },
      maybeSingle: async () => ({ data: { id: builder.id }, error: null }),
      id: null as unknown,
    };
    return { from: () => builder };
  },
}));
vi.mock("@/lib/project-context", () => ({ loadProjectContextForConversation: m.loadProjectContextForConversation }));
vi.mock("@/lib/ceo-memory", () => ({ getCeoMemory: m.getCeoMemory }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/models", () => ({ fetchBrainModels: vi.fn(async () => []), isSelectionAllowed: () => true }));
vi.mock("@/lib/settings", async () => {
  const shared = await import("@/lib/attachments-shared");
  return {
    CHAT_LIMIT_BOUNDS: shared.CHAT_LIMIT_BOUNDS,
    loadWorkspaceSettings: vi.fn(async () => ({
      settings: { disabledModels: [], chat: { ...shared.DEFAULT_CHAT_LIMITS, maxFiles: 10 }, pricingOverrides: {} },
      updatedAt: null,
    })),
  };
});
vi.mock("@/lib/usage", () => ({ meterStreamAndRecord: vi.fn(async () => undefined) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/demo/mode", () => ({ isDemo: () => false }));
vi.mock("@/lib/demo/stream", () => ({ demoChatStreamResponse: vi.fn() }));

import { POST } from "@/app/api/chat/route";

const MEMBER = ["chat.knowledge", "modes.general", "data.document"];

function profile(capabilities: string[], role = "user") {
  return {
    userId: "u-1",
    email: null,
    displayName: null,
    role,
    isActive: true,
    permissions: {},
    capabilities,
    canUseAllModels: false,
    team: null,
  };
}

function chatRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "How did last week go?" }], ...body }),
  });
}

/** The arguments of the (single) brainChat call, by name. */
function brainCall() {
  expect(m.brainChat).toHaveBeenCalledTimes(1);
  const [messages, selection, mode, scope, directives, outputType, attachments, allowedModes, capabilities] =
    m.brainChat.mock.calls[0];
  return { messages, selection, mode, scope, directives, outputType, attachments, allowedModes, capabilities };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.brainChat.mockImplementation(
    async () => new Response('0:"ok"\n', { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } })
  );
  m.fetchBrainKnowledgeScopes.mockResolvedValue([]);
  m.getCeoMemory.mockResolvedValue("");
  m.loadProjectContextForConversation.mockResolvedValue({
    name: "Launch",
    instructions: "Keep answers short.",
    files: [{ name: "brief.md", text: "Project brief" }],
  });
});

describe("POST /api/chat capabilities", () => {
  it("requires a signed-in user", async () => {
    m.getSessionProfile.mockResolvedValueOnce(null);
    const res = await POST(chatRequest({}));
    expect(res.status).toBe(401);
    expect(m.brainChat).not.toHaveBeenCalled();
  });

  it("403s a user without chat.knowledge before calling the Brain", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["data.document", "chat.source_scope"]));
    const res = await POST(chatRequest({}));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Chat with the Brain isn't enabled for your account." });
    expect(m.brainChat).not.toHaveBeenCalled();
  });

  it("forwards the user's capability set to the Brain", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(MEMBER));
    const res = await POST(chatRequest({}));
    expect(res.status).toBe(200);
    expect(brainCall().capabilities).toEqual(MEMBER);
  });

  it("ignores collections and the Search-in scope without chat.source_scope", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(MEMBER));
    const res = await POST(chatRequest({ collectionIds: [COLLECTION_ID], knowledgeScope: "playbook" }));
    expect(res.status).toBe(200);
    const { scope } = brainCall();
    // Only the role-based source narrowing survives (a member: company knowledge).
    expect(scope).toEqual({ sourceTypes: ["document"] });
    expect(m.fetchBrainKnowledgeScopes).not.toHaveBeenCalled();
  });

  it("an unknown requested scope is not even looked up without chat.source_scope", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(MEMBER));
    await POST(chatRequest({ knowledgeScope: "future_lane" }));
    expect(m.fetchBrainKnowledgeScopes).not.toHaveBeenCalled();
    expect(brainCall().scope).toEqual({ sourceTypes: ["document"] });
  });

  it("honours collections and the Search-in scope with chat.source_scope", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...MEMBER, "chat.source_scope"]));
    const res = await POST(chatRequest({ collectionIds: [COLLECTION_ID], knowledgeScope: "playbook" }));
    expect(res.status).toBe(200);
    expect(brainCall().scope).toEqual({
      sourceTypes: ["document"],
      collectionIds: [COLLECTION_ID],
      knowledgeScope: "playbook",
    });
  });

  it("skips project context without app.projects", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(MEMBER));
    const res = await POST(chatRequest({ conversationId: CONVERSATION_ID }));
    expect(res.status).toBe(200);
    expect(m.loadProjectContextForConversation).not.toHaveBeenCalled();
    const { directives, attachments } = brainCall();
    expect(directives).toBeUndefined();
    expect(attachments).toBeUndefined();
  });

  it("folds in project context with app.projects", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...MEMBER, "app.projects"]));
    const res = await POST(chatRequest({ conversationId: CONVERSATION_ID }));
    expect(res.status).toBe(200);
    expect(m.loadProjectContextForConversation).toHaveBeenCalledTimes(1);
    const { directives, attachments } = brainCall();
    expect(directives).toContain("Keep answers short.");
    expect(attachments).toEqual([{ name: "Project files", text: "## brief.md\nProject brief" }]);
  });

  it("400s more attachments than the Brain accepts, before calling it", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(MEMBER));
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, text: `file ${i}` }));
    const res = await POST(chatRequest({ attachments: six }));
    expect(res.status).toBe(400);
    expect(m.brainChat).not.toHaveBeenCalled();
  });

  it("folds many project files into one entry and never sends more than 5 attachments", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...MEMBER, "app.projects"]));
    m.loadProjectContextForConversation.mockResolvedValueOnce({
      name: "Launch",
      instructions: "",
      files: Array.from({ length: 8 }, (_, i) => ({ name: `p${i}.md`, text: `project ${i}` })),
    });
    const own = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.txt`, text: `file ${i}` }));
    const res = await POST(chatRequest({ conversationId: CONVERSATION_ID, attachments: own }));
    expect(res.status).toBe(200);
    const { attachments } = brainCall();
    expect(attachments).toHaveLength(4);
    // The user's own files first, then ONE project entry.
    expect(attachments.slice(0, 3).map((a: { name: string }) => a.name)).toEqual(["f0.txt", "f1.txt", "f2.txt"]);
    expect(attachments[3].name).toBe("Project files");
    expect(attachments[3].text).toContain("## p7.md\nproject 7");
  });

  it("a full set of 5 attachments leaves no slot for project files", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...MEMBER, "app.projects"]));
    const own = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, text: `file ${i}` }));
    const res = await POST(chatRequest({ conversationId: CONVERSATION_ID, attachments: own }));
    expect(res.status).toBe(200);
    const { attachments } = brainCall();
    expect(attachments).toHaveLength(5);
    expect(attachments.every((a: { name: string }) => a.name !== "Project files")).toBe(true);
  });

  it("413s attachments too large for one Brain turn, before calling it", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(MEMBER));
    const big = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.txt`, text: "x".repeat(40_000) }));
    const res = await POST(chatRequest({ attachments: big }));
    expect(res.status).toBe(413);
    expect(m.brainChat).not.toHaveBeenCalled();
  });

  it("clips project files to the per-turn budget left after the user's own files", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...MEMBER, "app.projects"]));
    m.loadProjectContextForConversation.mockResolvedValueOnce({
      name: "Launch",
      instructions: "",
      files: [{ name: "huge.md", text: "p".repeat(60_000) }],
    });
    const own = [
      { name: "a.txt", text: "a".repeat(40_000) },
      { name: "b.txt", text: "b".repeat(40_000) },
    ];
    const res = await POST(chatRequest({ conversationId: CONVERSATION_ID, attachments: own }));
    expect(res.status).toBe(200);
    const { attachments } = brainCall();
    const total = attachments.reduce((n: number, a: { text: string }) => n + a.text.length, 0);
    expect(total).toBeLessThanOrEqual(120_000);
    expect(attachments.at(-1).name).toBe("Project files");
  });

  it("an admin without stored grants gets the role defaults (chat + scoping)", async () => {
    // Empty resolved list → accessFromProfile falls back to role + stored permissions.
    m.getSessionProfile.mockResolvedValueOnce(profile([], "admin"));
    const res = await POST(chatRequest({ collectionIds: [COLLECTION_ID] }));
    expect(res.status).toBe(200);
    const { scope, capabilities } = brainCall();
    expect(scope).toEqual({ collectionIds: [COLLECTION_ID] });
    expect(capabilities).toContain("chat.knowledge");
    expect(capabilities).toContain("chat.source_scope");
  });
});
