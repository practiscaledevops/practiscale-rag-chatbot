import { describe, it, expect, vi, beforeEach } from "vitest";

// GET /api/collections: the Brain's scopes filtered per USER (nothing without
// "chat.source_scope"; sensitive scopes only for users who can reach call data).
// The session and the Brain are mocked.
const m = vi.hoisted(() => ({ getSessionProfile: vi.fn(), fetchBrainSearchOptions: vi.fn() }));
vi.mock("@/lib/admin", () => ({ getSessionProfile: m.getSessionProfile }));
vi.mock("@/lib/brain", () => ({ fetchBrainSearchOptions: m.fetchBrainSearchOptions }));

import { GET } from "@/app/api/collections/route";

const SCOPES = [
  { id: "auto", label: "Auto", description: "Per question.", sensitive: false },
  { id: "all", label: "All Brain", description: "Every lane.", sensitive: false },
  { id: "playbook", label: "Playbooks", description: "Frameworks.", sensitive: false },
  { id: "calls", label: "Consultant calls", description: "Call data only.", sensitive: true },
];
const COLLECTIONS = [{ id: "c-1", name: "Brand" }];

function profile(role: string, capabilities: string[] = []) {
  return { userId: "u-1", email: null, displayName: null, role, permissions: {}, capabilities, canUseAllModels: false, team: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.fetchBrainSearchOptions.mockResolvedValue({ collections: COLLECTIONS, scopes: SCOPES });
});

describe("GET /api/collections", () => {
  it("requires a signed-in user", async () => {
    m.getSessionProfile.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(m.fetchBrainSearchOptions).not.toHaveBeenCalled();
  });

  it("offers nothing (and skips the Brain) without chat.source_scope", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile("user", ["chat.knowledge", "data.document", "data.call_score"]));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ collections: [], scopes: [] });
    expect(m.fetchBrainSearchOptions).not.toHaveBeenCalled();
  });

  it("returns collections unchanged and hides calls from a member without call data", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile("user", ["chat.knowledge", "chat.source_scope", "data.document"]));
    const json = await (await GET()).json();
    expect(json.collections).toEqual(COLLECTIONS);
    expect(json.scopes.map((s: { id: string }) => s.id)).toEqual(["auto", "all", "playbook"]);
  });

  it("offers calls to a member granted call scores", async () => {
    m.getSessionProfile.mockResolvedValueOnce(
      profile("user", ["chat.knowledge", "chat.source_scope", "data.document", "data.call_score"])
    );
    const json = await (await GET()).json();
    expect(json.scopes.map((s: { id: string }) => s.id)).toContain("calls");
  });

  it("offers calls to an admin (all source types)", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile("admin"));
    const json = await (await GET()).json();
    expect(json.scopes.map((s: { id: string }) => s.id)).toEqual(["auto", "all", "playbook", "calls"]);
  });
});
