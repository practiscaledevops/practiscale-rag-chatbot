import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/chat forwards the asking user's IANA zone (lib/timezone
// effectiveTimeZone) to the Brain as brainChat's 10th argument, so "list all
// today's calls" from the CEO in New York resolves on his calendar, not the
// Brain's Karachi default. Unusable values are dropped (never a 400).
// Session, Brain, Supabase and settings are mocked.

const m = vi.hoisted(() => ({
  getSessionProfile: vi.fn(),
  brainChat: vi.fn(),
  fetchBrainKnowledgeScopes: vi.fn(),
}));

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/admin", () => ({ getSessionProfile: m.getSessionProfile }));
vi.mock("@/lib/brain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain")>()),
  brainChat: m.brainChat,
  fetchBrainKnowledgeScopes: m.fetchBrainKnowledgeScopes,
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return { from: () => builder };
  },
}));
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
vi.mock("@/lib/demo/stream", () => ({ demoChatStreamResponse: vi.fn() }));

import { POST } from "@/app/api/chat/route";

function chatRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "list all today's calls" }], ...body }),
  });
}

/** brainChat's 10th argument: the zone forwarded to the Brain. */
function forwardedZone(): unknown {
  expect(m.brainChat).toHaveBeenCalledTimes(1);
  return m.brainChat.mock.calls[0][9];
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getSessionProfile.mockResolvedValue({
    userId: "u-1",
    email: null,
    displayName: null,
    role: "user",
    isActive: true,
    permissions: {},
    capabilities: ["chat.knowledge", "modes.general"],
    canUseAllModels: false,
    team: null,
  });
  m.brainChat.mockImplementation(
    async () => new Response('0:"ok"\n', { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } })
  );
  m.fetchBrainKnowledgeScopes.mockResolvedValue([]);
});

describe("POST /api/chat timeZone", () => {
  it("forwards the user's zone to the Brain", async () => {
    const res = await POST(chatRequest({ timeZone: "America/New_York" }));
    expect(res.status).toBe(200);
    expect(forwardedZone()).toBe("America/New_York");
  });

  it("normalizes casing", async () => {
    const res = await POST(chatRequest({ timeZone: "america/chicago" }));
    expect(res.status).toBe(200);
    expect(forwardedZone()).toBe("America/Chicago");
  });

  it("drops a missing or unusable zone (the Brain's default applies) without a 400", async () => {
    for (const timeZone of [undefined, "+05:00", "Not/AZone", 42, null, { tz: "America/New_York" }]) {
      m.brainChat.mockClear();
      const res = await POST(chatRequest(timeZone === undefined ? {} : { timeZone }));
      expect(res.status, JSON.stringify(timeZone)).toBe(200);
      expect(forwardedZone(), JSON.stringify(timeZone)).toBeUndefined();
    }
  });
});
