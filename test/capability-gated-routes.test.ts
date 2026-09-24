import { beforeEach, describe, expect, it, vi } from "vitest";

// Capability gates on the chat side-routes: POST /api/jobs ("jobs.deep_audit"),
// POST /api/attachments (the file kind's "extract.*") and POST /api/compact
// ("chat.compaction"). The session, the Brain and extraction are mocked.

const m = vi.hoisted(() => ({
  getSessionProfile: vi.fn(),
  brainStartAudit: vi.fn(),
  brainCompact: vi.fn(),
  extractAttachment: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getSessionProfile: m.getSessionProfile }));
vi.mock("@/lib/brain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain")>()),
  brainStartAudit: m.brainStartAudit,
  brainCompact: m.brainCompact,
}));
vi.mock("@/lib/attachments", () => ({ extractAttachment: m.extractAttachment }));
vi.mock("@/lib/settings", async () => {
  const shared = await import("@/lib/attachments-shared");
  return { loadWorkspaceSettings: vi.fn(async () => ({ settings: { chat: shared.DEFAULT_CHAT_LIMITS }, updatedAt: null })) };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/demo/mode", () => ({ isDemo: () => false }));
vi.mock("@/lib/demo/brain", () => ({ demoExtract: vi.fn() }));

import { POST as startJob } from "@/app/api/jobs/route";
import { POST as uploadAttachment } from "@/app/api/attachments/route";
import { POST as compact } from "@/app/api/compact/route";

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

const BASE = ["chat.knowledge", "data.document"];

function jsonRequest(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uploadRequest(name: string, content = "hello world") {
  const fd = new FormData();
  fd.append("file", new File([content], name));
  return new Request("http://localhost/api/attachments", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.brainStartAudit.mockResolvedValue({ id: "job-1", title: "Deep audit", status: "running", total_tasks: 3 });
  m.brainCompact.mockResolvedValue("Recap of the chat.");
  m.extractAttachment.mockResolvedValue({ text: "hello world", truncated: false });
});

describe("POST /api/jobs", () => {
  it("requires a signed-in user", async () => {
    m.getSessionProfile.mockResolvedValueOnce(null);
    expect((await startJob(jsonRequest("/api/jobs", { query: "audit calls" }))).status).toBe(401);
  });

  it("403s without jobs.deep_audit and never reaches the Brain", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...BASE, "data.transcript"]));
    const res = await startJob(jsonRequest("/api/jobs", { query: "audit last week's calls" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Deep audits aren't enabled for your account." });
    expect(m.brainStartAudit).not.toHaveBeenCalled();
  });

  it("a member gets no deep audits by default (sensitive)", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([], "user"));
    expect((await startJob(jsonRequest("/api/jobs", { query: "audit calls" }))).status).toBe(403);
    expect(m.brainStartAudit).not.toHaveBeenCalled();
  });

  it("starts the audit with jobs.deep_audit", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...BASE, "data.transcript", "jobs.deep_audit"]));
    const res = await startJob(jsonRequest("/api/jobs", { query: "audit last week's calls" }));
    expect(res.status).toBe(201);
    expect(m.brainStartAudit).toHaveBeenCalledWith("audit last week's calls", undefined);
  });
});

describe("POST /api/attachments", () => {
  it("requires a signed-in user", async () => {
    m.getSessionProfile.mockResolvedValueOnce(null);
    expect((await uploadAttachment(uploadRequest("notes.txt"))).status).toBe(401);
  });

  it("an unsupported type is still a 415 (checked before the capability)", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(BASE));
    expect((await uploadAttachment(uploadRequest("tool.exe"))).status).toBe(415);
  });

  it("403s a kind the user may not attach, before extraction", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...BASE, "extract.text"]));
    const res = await uploadAttachment(uploadRequest("report.pdf", "%PDF-1.7 body"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That file type isn't enabled for your account." });
    expect(m.extractAttachment).not.toHaveBeenCalled();
  });

  it("403s every kind when no extract.* capability is held", async () => {
    for (const name of ["notes.txt", "data.csv", "sheet.xlsx", "shot.png", "memo.m4a"]) {
      m.getSessionProfile.mockResolvedValueOnce(profile(BASE));
      expect((await uploadAttachment(uploadRequest(name))).status, name).toBe(403);
    }
    expect(m.extractAttachment).not.toHaveBeenCalled();
  });

  it("spreadsheets fall under extract.text", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...BASE, "extract.pdf"]));
    expect((await uploadAttachment(uploadRequest("sheet.xlsx"))).status).toBe(403);
    // With extract.text the upload passes the gate (and then meets the content sniff).
    m.getSessionProfile.mockResolvedValueOnce(profile([...BASE, "extract.text"]));
    expect((await uploadAttachment(uploadRequest("sheet.xlsx", "not a zip"))).status).toBe(415);
  });

  it("extracts a kind the user holds", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...BASE, "extract.text"]));
    const res = await uploadAttachment(uploadRequest("notes.txt"));
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe("hello world");
    expect(m.extractAttachment).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/compact", () => {
  const body = {
    messages: [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
    ],
  };

  it("requires a signed-in user", async () => {
    m.getSessionProfile.mockResolvedValueOnce(null);
    expect((await compact(jsonRequest("/api/compact", body))).status).toBe(401);
  });

  it("403s without chat.compaction and never reaches the Brain", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile(BASE));
    const res = await compact(jsonRequest("/api/compact", body));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Long-chat compaction isn't enabled for your account." });
    expect(m.brainCompact).not.toHaveBeenCalled();
  });

  it("compacts with chat.compaction", async () => {
    m.getSessionProfile.mockResolvedValueOnce(profile([...BASE, "chat.compaction"]));
    const res = await compact(jsonRequest("/api/compact", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: "Recap of the chat." });
  });
});
