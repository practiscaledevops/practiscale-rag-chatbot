import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/jobs and POST /api/compact accept an optional `timeZone` (the
// user's IANA zone from lib/timezone effectiveTimeZone), validate it and
// forward it to the Brain. An unusable value is dropped, never a 400: the
// Brain then applies its business zone. The session and the Brain are mocked.

const m = vi.hoisted(() => ({
  getSessionProfile: vi.fn(),
  brainStartAudit: vi.fn(),
  brainCompact: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getSessionProfile: m.getSessionProfile }));
vi.mock("@/lib/brain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain")>()),
  brainStartAudit: m.brainStartAudit,
  brainCompact: m.brainCompact,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/demo/mode", () => ({ isDemo: () => false }));

import { POST as startJob } from "@/app/api/jobs/route";
import { POST as compact } from "@/app/api/compact/route";

function profile(capabilities: string[]) {
  return {
    userId: "u-1",
    email: null,
    displayName: null,
    role: "user",
    isActive: true,
    permissions: {},
    capabilities,
    canUseAllModels: false,
    team: null,
  };
}

function jsonRequest(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.brainStartAudit.mockResolvedValue({ id: "job-1", title: "Deep audit", status: "running", total_tasks: 3 });
  m.brainCompact.mockResolvedValue("Recap of the chat.");
});

describe("POST /api/jobs timeZone", () => {
  const audit = (body: Record<string, unknown>) => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["chat.knowledge", "data.transcript", "jobs.deep_audit"]));
    return startJob(jsonRequest("/api/jobs", body));
  };

  it("forwards a valid zone", async () => {
    const res = await audit({ query: "audit today's calls", timeZone: "America/New_York" });
    expect(res.status).toBe(201);
    expect(m.brainStartAudit).toHaveBeenCalledWith("audit today's calls", undefined, "America/New_York");
  });

  it("forwards it with the history, casing normalized", async () => {
    const history = [
      { role: "user", content: "list all today's calls", createdAt: "2026-09-24T14:00:00.000Z" },
      { role: "assistant", content: "3 calls today." },
    ];
    const res = await audit({ query: "audit those calls", history, timeZone: "america/chicago" });
    expect(res.status).toBe(201);
    expect(m.brainStartAudit).toHaveBeenCalledWith(
      "audit those calls",
      [
        { role: "user", content: "list all today's calls", createdAt: "2026-09-24T14:00:00.000Z" },
        { role: "assistant", content: "3 calls today.", createdAt: undefined },
      ],
      "America/Chicago"
    );
  });

  it("drops an unusable zone instead of failing the audit", async () => {
    for (const timeZone of ["Not/AZone", "+05:00", 42, null, "x".repeat(200), { tz: "America/New_York" }]) {
      const res = await audit({ query: "audit today's calls", timeZone });
      expect(res.status, JSON.stringify(timeZone)).toBe(201);
    }
    expect(m.brainStartAudit).toHaveBeenCalledTimes(6);
    for (const call of m.brainStartAudit.mock.calls) expect(call).toEqual(["audit today's calls", undefined]);
  });

  it("without a zone the call is unchanged", async () => {
    expect((await audit({ query: "audit today's calls" })).status).toBe(201);
    expect(m.brainStartAudit).toHaveBeenCalledWith("audit today's calls", undefined);
  });
});

describe("POST /api/compact timeZone", () => {
  const messages = [
    { role: "user", content: "List all today's calls" },
    { role: "assistant", content: "3 calls today." },
  ];
  const run = (body: Record<string, unknown>) => {
    m.getSessionProfile.mockResolvedValueOnce(profile(["chat.knowledge", "chat.compaction"]));
    return compact(jsonRequest("/api/compact", body));
  };

  it("forwards a valid zone", async () => {
    const res = await run({ messages, timeZone: "Australia/Sydney" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: "Recap of the chat." });
    expect(m.brainCompact).toHaveBeenCalledWith(messages, "Australia/Sydney");
  });

  it("drops an unusable or missing zone", async () => {
    expect((await run({ messages, timeZone: "Mars/Base" })).status).toBe(200);
    expect((await run({ messages })).status).toBe(200);
    expect(m.brainCompact).toHaveBeenNthCalledWith(1, messages, undefined);
    expect(m.brainCompact).toHaveBeenNthCalledWith(2, messages, undefined);
  });
});
