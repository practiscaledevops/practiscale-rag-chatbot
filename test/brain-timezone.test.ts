import { afterEach, describe, expect, it, vi } from "vitest";
import { brainChat, brainCompact, brainStartAudit } from "@/lib/brain";

// lib/brain: the asking user's IANA zone travels as body.timeZone on chat,
// deep-audit and compaction requests, so the Brain resolves "today's calls" in
// the user's day (a CEO in New York, not the team's Karachi). An unusable
// value is dropped (the Brain's business zone applies). fetch is stubbed.

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => impl());
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sentBody = (fn: ReturnType<typeof stubFetch>, call = 0) =>
  JSON.parse(String(fn.mock.calls[call][1]?.body)) as Record<string, unknown>;

const messages = [{ role: "user" as const, content: "List all today's calls" }];

describe("brainChat timeZone", () => {
  const chat = (timeZone?: string) =>
    brainChat(messages, "recommended", "auto", undefined, undefined, undefined, undefined, undefined, undefined, timeZone);

  it("sends the user's zone", async () => {
    const fetchFn = stubFetch(() => new Response("ok"));
    await chat("America/New_York");
    expect(sentBody(fetchFn).timeZone).toBe("America/New_York");
  });

  it("normalizes casing and keeps the other fields", async () => {
    const fetchFn = stubFetch(() => new Response("ok"));
    await brainChat(messages, "fast", "auto", { knowledgeScope: "calls" }, undefined, undefined, undefined, undefined, ["chat.call_review"], "america/chicago");
    const body = sentBody(fetchFn);
    expect(body.timeZone).toBe("America/Chicago");
    expect(body.knowledgeScope).toBe("calls");
    expect(body.capabilities).toEqual(["chat.call_review"]);
    expect(body.messages).toEqual(messages);
  });

  it("omits the field when absent or unusable", async () => {
    const fetchFn = stubFetch(() => new Response("ok"));
    await chat();
    await chat("");
    await chat("Not/AZone");
    await chat("+05:00");
    for (let i = 0; i < 4; i++) expect(sentBody(fetchFn, i)).not.toHaveProperty("timeZone");
  });
});

describe("brainStartAudit timeZone", () => {
  const job = { id: "job-1", title: "Deep audit", status: "running", total_tasks: 3 };

  it("sends the requester's zone with the query and history", async () => {
    const fetchFn = stubFetch(() => json({ job }, 201));
    const history = [{ role: "user" as const, content: "today's calls", createdAt: "2026-09-24T14:00:00.000Z" }];
    await expect(brainStartAudit("audit those calls", history, "America/Los_Angeles")).resolves.toEqual(job);
    const body = sentBody(fetchFn);
    expect(body).toEqual({ query: "audit those calls", history, timeZone: "America/Los_Angeles" });
  });

  it("omits the field when absent or unusable", async () => {
    const fetchFn = stubFetch(() => json({ job }, 201));
    await brainStartAudit("audit today's calls");
    await brainStartAudit("audit today's calls", undefined, "Nowhere/Zone");
    expect(sentBody(fetchFn, 0)).toEqual({ query: "audit today's calls" });
    expect(sentBody(fetchFn, 1)).toEqual({ query: "audit today's calls" });
  });
});

describe("brainCompact timeZone", () => {
  it("sends the user's zone alongside the messages", async () => {
    const fetchFn = stubFetch(() => json({ summary: "Recap." }));
    await expect(brainCompact(messages, "Europe/London")).resolves.toBe("Recap.");
    expect(sentBody(fetchFn)).toEqual({ messages, timeZone: "Europe/London" });
  });

  it("omits the field when absent or unusable", async () => {
    const fetchFn = stubFetch(() => json({ summary: "Recap." }));
    await brainCompact(messages);
    await brainCompact(messages, "12345");
    expect(sentBody(fetchFn, 0)).toEqual({ messages });
    expect(sentBody(fetchFn, 1)).toEqual({ messages });
  });
});
