import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capability narrowing on routes that used to skip it:
//   • POST /api/admin/retrieve (RAG debugger) — the admin's OWN data.* grants
//     narrow the retrieval, exactly like /api/chat;
//   • POST /api/projects/files — the file kind's extract.* capability, the
//     accepted-extension list and the magic-byte sniff (like /api/attachments);
//   • GET /api/brain/knowledge(/[ref]) — "data.document" is required, and a
//     chat-only caller gets no relationships / learning without the grants.
// The session, Supabase and the Brain's extract/knowledge calls are mocked; the
// debugger's Brain call goes through the real brainRetrieveDebug (fetch stubbed).

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

const m = vi.hoisted(() => {
  class AdminError extends Error {
    readonly status: 401 | 403;
    constructor(status: 401 | 403, message?: string) {
      super(message ?? (status === 401 ? "Unauthorized" : "Forbidden"));
      this.status = status;
    }
  }
  return {
    AdminError,
    requireChatbotAdmin: vi.fn(),
    getSessionProfile: vi.fn(),
    getUser: vi.fn(),
    brainExtract: vi.fn(),
    brainListKnowledge: vi.fn(),
    brainGetKnowledge: vi.fn(),
    insert: vi.fn(),
  };
});

vi.mock("@/lib/admin", () => ({
  AdminError: m.AdminError,
  requireChatbotAdmin: m.requireChatbotAdmin,
  getSessionProfile: m.getSessionProfile,
}));
vi.mock("@/lib/auth", () => ({ getUser: m.getUser }));
vi.mock("@/lib/brain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain")>()),
  brainExtract: m.brainExtract,
  brainListKnowledge: m.brainListKnowledge,
  brainGetKnowledge: m.brainGetKnowledge,
}));
vi.mock("@/lib/supabase-server", () => ({
  // ownsProject: from("projects").select().eq().eq().maybeSingle();
  // the insert: from("project_files").insert(row).select().single().
  createSupabaseServerClient: async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: { id: PROJECT_ID }, error: null }),
      insert: (row: unknown) => {
        m.insert(row);
        return builder;
      },
      single: async () => ({ data: { id: "f-1", name: "x", mime: null, size: 1, created_at: "now" }, error: null }),
    };
    return { from: () => builder };
  },
}));
vi.mock("@/lib/project-files", () => ({
  loadProjectFiles: vi.fn(async () => ({ files: [], available: true })),
  isMissingProjectFilesTable: () => false,
}));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/demo/mode", () => ({ isDemo: () => false }));

import { POST as retrieve } from "@/app/api/admin/retrieve/route";
import { POST as uploadProjectFile } from "@/app/api/projects/files/route";
import { GET as listKnowledge } from "@/app/api/brain/knowledge/route";
import { GET as getKnowledge } from "@/app/api/brain/knowledge/[ref]/route";

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

const CHUNKS = [
  { id: "c1", content: "SOP text", source_type: "document", document_id: "d1", score: 0.9 },
  { id: "c2", content: "James: raw call transcript", source_type: "transcript", document_id: "d2", score: 0.8 },
  { id: "c3", content: "Call score 6/10", source_type: "call_score", document_id: "d3", score: 0.7 },
  { id: "c4", content: "untyped", source_type: null, document_id: "d4", score: 0.6 },
];

function jsonRequest(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function projectUpload(name: string, content: BlobPart = "hello world") {
  const fd = new FormData();
  fd.append("projectId", PROJECT_ID);
  fd.append("file", new File([content], name));
  return new Request("http://localhost/api/projects/files", { method: "POST", body: fd });
}

/** POST /api/projects/files (always answers; the route's type allows undefined). */
async function upload(req: Request): Promise<Response> {
  const res = await uploadProjectFile(req);
  if (!res) throw new Error("no response");
  return res;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  m.requireChatbotAdmin.mockResolvedValue({ userId: "u-1", email: null, role: "admin", isSuperAdmin: false });
  m.getUser.mockResolvedValue({ id: "u-1" });
  m.brainExtract.mockResolvedValue({ text: "extracted text" });
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ query: "q", rewritten: false, confidence: 0.5, results: CHUNKS }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The JSON body the debugger sent to the Brain. */
function retrieveBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

describe("POST /api/admin/retrieve (RAG debugger)", () => {
  it("still requires an admin", async () => {
    m.requireChatbotAdmin.mockRejectedValueOnce(new m.AdminError(403));
    const res = await retrieve(jsonRequest("/api/admin/retrieve", { query: "x" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an admin whose call material was switched off gets only company knowledge", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["chat.knowledge", "data.document"], "admin"));
    const res = await retrieve(jsonRequest("/api/admin/retrieve", { query: "James call 2026-09-24 objection" }));
    expect(res.status).toBe(200);
    expect(retrieveBody().sourceTypes).toEqual(["document"]);
    const json = await res.json();
    // Enforced here too, for a Brain that ignores the field.
    expect(json.results.map((r: { id: string }) => r.id)).toEqual(["c1"]);
  });

  it("an admin with no data.* grant gets nothing", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["chat.knowledge"], "admin"));
    const res = await retrieve(jsonRequest("/api/admin/retrieve", { query: "anything" }));
    expect(retrieveBody().sourceTypes).toEqual(["__none__"]);
    expect((await res.json()).results).toEqual([]);
  });

  it("an admin with every source is not narrowed", async () => {
    // Empty resolved list → role defaults (admins hold every data.* source).
    m.getSessionProfile.mockResolvedValueOnce(profile([], "admin"));
    const res = await retrieve(jsonRequest("/api/admin/retrieve", { query: "anything" }));
    expect(retrieveBody()).not.toHaveProperty("sourceTypes");
    expect((await res.json()).results).toHaveLength(CHUNKS.length);
  });
});

describe("POST /api/projects/files", () => {
  const PROJECTS = ["chat.knowledge", "data.document", "app.projects"];

  it("403s a PDF when extract.pdf is denied, before extraction", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...PROJECTS, "extract.text"]));
    const res = await upload(projectUpload("report.pdf", "%PDF-1.7 body"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That file type isn't enabled for your account." });
    expect(m.brainExtract).not.toHaveBeenCalled();
  });

  it("403s audio when extract.audio is denied", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...PROJECTS, "extract.text", "extract.pdf"]));
    const res = await upload(projectUpload("memo.mp3", "ID3 audio"));
    expect(res.status).toBe(403);
    expect(m.brainExtract).not.toHaveBeenCalled();
  });

  it("415s a file with no accepted extension (no MIME fallback)", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...PROJECTS, "extract.audio", "extract.text"]));
    const res = await upload(projectUpload("recording"));
    expect(res.status).toBe(415);
    expect(m.brainExtract).not.toHaveBeenCalled();
  });

  it("415s content that doesn't match its extension", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...PROJECTS, "extract.pdf"]));
    const res = await upload(projectUpload("report.pdf", "MZ not a pdf"));
    expect(res.status).toBe(415);
    expect(m.brainExtract).not.toHaveBeenCalled();
  });

  it("extracts an allowed kind", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...PROJECTS, "extract.pdf"]));
    const res = await upload(projectUpload("report.pdf", "%PDF-1.7 body"));
    expect(res.status).toBe(201);
    expect(m.brainExtract).toHaveBeenCalledTimes(1);
    expect(m.insert).toHaveBeenCalledTimes(1);
  });

  it("still requires app.projects", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["chat.knowledge", "extract.pdf"]));
    const res = await upload(projectUpload("report.pdf", "%PDF-1.7 body"));
    expect(res.status).toBe(403);
    expect(m.brainExtract).not.toHaveBeenCalled();
  });
});

describe("GET /api/brain/knowledge", () => {
  it("403s without data.document even with knowledge.map", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["chat.knowledge", "knowledge.map"]));
    const res = await listKnowledge(new Request("http://localhost/api/brain/knowledge"));
    expect(res.status).toBe(403);
    expect(m.brainListKnowledge).not.toHaveBeenCalled();
  });

  it("lists with knowledge.map + data.document", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["knowledge.map", "data.document"]));
    m.brainListKnowledge.mockResolvedValueOnce({ objects: [], total: 0 });
    const res = await listKnowledge(new Request("http://localhost/api/brain/knowledge"));
    expect(res.status).toBe(200);
    expect(m.brainListKnowledge).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/brain/knowledge/[ref]", () => {
  const DETAIL = {
    object: { ref: "MG-001", title: "Offer" },
    relationships: [{ ref: "MG-002" }],
    learning: [{ ref: "LRN-004" }],
    chunks: 3,
  };
  const call = (ref = "MG-001") =>
    getKnowledge(new Request(`http://localhost/api/brain/knowledge/${ref}`), { params: Promise.resolve({ ref }) });

  it("403s without data.document", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["chat.knowledge", "knowledge.map"]));
    expect((await call()).status).toBe(403);
    expect(m.brainGetKnowledge).not.toHaveBeenCalled();
  });

  it("a chat-only caller gets the object but no relationships or learning", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["chat.knowledge", "data.document"]));
    m.brainGetKnowledge.mockResolvedValueOnce(DETAIL);
    const res = await call();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toEqual(DETAIL.object);
    expect(json.relationships).toEqual([]);
    expect(json.learning).toEqual([]);
  });

  it("the map + learning.read get the full detail", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["knowledge.map", "data.document", "learning.read"]));
    m.brainGetKnowledge.mockResolvedValueOnce(DETAIL);
    const json = await (await call()).json();
    expect(json.relationships).toEqual(DETAIL.relationships);
    expect(json.learning).toEqual(DETAIL.learning);
  });
});
