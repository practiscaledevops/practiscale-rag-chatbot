import { describe, it, expect } from "vitest";
import {
  BRAIN_MODEL_TURNS,
  BRAIN_TURN_CHARS,
  BRAIN_WINDOW_TOKENS,
  SUMMARY_PREFIX,
  clipSummary,
  contextUsagePct,
  effectiveMessages,
  estimateTokens,
  isSummaryMessage,
  lastSummaryIndex,
  makeSummaryContent,
  planCompaction,
  recentHistory,
  shouldAutoCompact,
  summaryBody,
  turnCount,
  windowBudget,
} from "@/lib/compaction";

const u = (content: string) => ({ role: "user", content });
const a = (content: string) => ({ role: "assistant", content });
const s = (content: string) => ({ role: "system", content: makeSummaryContent(content) });

describe("summary messages", () => {
  it("recognises only system turns carrying the marker", () => {
    expect(isSummaryMessage(s("x"))).toBe(true);
    expect(isSummaryMessage({ role: "system", content: "You are helpful" })).toBe(false);
    expect(isSummaryMessage({ role: "user", content: `${SUMMARY_PREFIX} fake` })).toBe(false);
    expect(isSummaryMessage(null)).toBe(false);
  });

  it("round-trips the body", () => {
    expect(summaryBody(s("  - point one  "))).toBe("- point one");
  });
});

describe("effectiveMessages", () => {
  it("returns everything when never compacted", () => {
    const list = [u("q1"), a("a1")];
    expect(effectiveMessages(list)).toEqual(list);
  });

  it("starts at the latest summary", () => {
    const list = [u("q1"), a("a1"), s("old"), u("q2"), a("a2"), s("new"), u("q3")];
    expect(lastSummaryIndex(list)).toBe(5);
    expect(effectiveMessages(list).map((m) => m.content)).toEqual([makeSummaryContent("new"), "q3"]);
  });
});

describe("planCompaction", () => {
  it("returns null for short chats", () => {
    expect(planCompaction([u("q1"), a("a1")])).toBeNull();
    expect(planCompaction([u("q1"), a("a1"), u("q2"), a("a2")])).toBeNull();
  });

  it("keeps the last two turns and summarizes the rest", () => {
    const list = [u("q1"), a("a1"), u("q2"), a("a2"), u("q3"), a("a3"), u("q4"), a("a4")];
    const plan = planCompaction(list)!;
    expect(plan.insertAt).toBe(4);
    expect(plan.summarize.map((m) => m.content)).toEqual(["q1", "a1", "q2", "a2"]);
  });

  it("starts the kept tail on a user turn", () => {
    const list = [u("q1"), a("a1"), u("q2"), a("a2"), u("q3"), a("a3"), a("a3b"), u("q4"), a("a4")];
    const plan = planCompaction(list)!;
    expect(list[plan.insertAt].role).toBe("user");
  });

  it("re-summarizes the previous summary along with newer turns", () => {
    const list = [u("q0"), a("a0"), s("old"), u("q1"), a("a1"), u("q2"), a("a2"), u("q3"), a("a3")];
    const plan = planCompaction(list)!;
    expect(plan.summarize[0].content).toBe(makeSummaryContent("old"));
    expect(plan.summarize.map((m) => m.content).slice(1)).toEqual(["q1", "a1"]);
    expect(plan.insertAt).toBe(5);
  });

  it("ignores non-summary system turns", () => {
    const list = [u("q1"), { role: "system", content: "note" }, a("a1"), u("q2"), a("a2"), u("q3"), a("a3"), u("q4"), a("a4")];
    const plan = planCompaction(list)!;
    expect(plan.summarize.some((m) => m.content === "note")).toBe(false);
  });
});

describe("estimateTokens", () => {
  it("counts roughly four characters per token", () => {
    expect(estimateTokens([u("x".repeat(400))])).toBe(Math.ceil((400 + 16) / 4));
    expect(estimateTokens([])).toBe(0);
  });
});

describe("recentHistory", () => {
  it("includes the summary first and the most recent turns", () => {
    const list = [u("q0"), a("a0"), s("yesterday's calls"), u("q1"), a("a1"), u("q2")];
    const h = recentHistory(list, 3);
    expect(h[0]).toEqual({ role: "system", content: makeSummaryContent("yesterday's calls") });
    expect(h.slice(1).map((m) => m.content)).toEqual(["a1", "q2"]);
  });

  it("clips long content", () => {
    const h = recentHistory([u("x".repeat(5000))], 12, 100);
    expect(h[0].content).toHaveLength(100);
  });

  it("keeps a long summary's marker AND its trailing call-review filter line", () => {
    const filter = "Active call-review filter: date=2026-09-24 | consultants=none";
    const body = [
      "- User asked to review the calls from 2026-09-18 for James Ephrim.",
      ...Array.from({ length: 80 }, (_, i) => `- Point ${i}: a decision and its reasoning, kept for later turns.`),
      filter,
    ].join("\n");
    const list = [s(body), u("q1"), a("a1"), u("deep audit them")];
    expect(list[0].content.length).toBeGreaterThan(4000);
    const h = recentHistory(list);
    expect(h[0].content.length).toBeLessThanOrEqual(4000);
    expect(h[0].content.startsWith(SUMMARY_PREFIX)).toBe(true);
    expect(h[0].content.endsWith(filter)).toBe(true);
  });
});

describe("clipSummary", () => {
  it("leaves a summary that fits untouched", () => {
    expect(clipSummary("short", 100)).toBe("short");
  });

  it("without a filter line keeps head + tail within the limit", () => {
    const content = `${SUMMARY_PREFIX}\n` + Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const out = clipSummary(content, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.startsWith(SUMMARY_PREFIX)).toBe(true);
    expect(out.endsWith("line 199")).toBe(true);
  });

  it("uses the LAST filter line when there are several", () => {
    const content = [
      SUMMARY_PREFIX,
      "Active call-review filter: date=2026-09-01",
      "x".repeat(3000),
      "Active call-review filter: date=2026-09-24",
    ].join("\n");
    const out = clipSummary(content, 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out.endsWith("Active call-review filter: date=2026-09-24")).toBe(true);
  });
});

describe("context window (the Brain's real limits)", () => {
  /** n question/answer pairs of the given sizes. */
  const pairs = (n: number, q = 300, ans = 1500) =>
    Array.from({ length: n }, (_, i) => [u(`q${i} ` + "q".repeat(q)), a(`a${i} ` + "a".repeat(ans))]).flat();

  it("mirrors the Brain's window: 40 turns, 120k chars (~30k tokens)", () => {
    expect(BRAIN_MODEL_TURNS).toBe(40);
    expect(BRAIN_TURN_CHARS).toBe(120_000);
    expect(BRAIN_WINDOW_TOKENS).toBe(30_000);
  });

  it("never measures against a budget above what the Brain keeps", () => {
    expect(windowBudget(150_000)).toBe(BRAIN_WINDOW_TOKENS);
    expect(windowBudget(20_000)).toBe(20_000);
  });

  it("counts turns as well as tokens", () => {
    // 20 short pairs = 40 turns: the Brain's full window, though tokens are tiny.
    const list = pairs(20, 10, 10);
    expect(turnCount(list)).toBe(40);
    expect(contextUsagePct(list, 30_000)).toBe(100);
  });

  it("measures only the effective history (latest summary onward)", () => {
    const list = [...pairs(20, 10, 10), s("recap"), u("q"), a("a")];
    expect(contextUsagePct(list, 30_000)).toBe(Math.round((2 / 40) * 100));
  });

  it("25 pairs of 1.5k-char answers reach the auto-compact threshold before the Brain drops turns", () => {
    // 50 turns: the Brain keeps 40 — compaction must already be due.
    const list = pairs(25);
    expect(shouldAutoCompact(list, 30_000, 80)).toBe(true);
    // A 150k legacy budget is clamped, so it fires too.
    expect(shouldAutoCompact(list, 150_000, 80)).toBe(true);
  });

  it("fires on turns before the 40-turn cap even when tokens are low", () => {
    const list = pairs(16, 50, 100); // 32 turns = 80% of 40
    expect(contextUsagePct(list, 30_000)).toBe(80);
    expect(shouldAutoCompact(list, 30_000, 80)).toBe(true);
    expect(shouldAutoCompact(pairs(15, 50, 100), 30_000, 80)).toBe(false);
  });

  it("does not re-fire when the kept tail alone is over the threshold (hysteresis)", () => {
    // Compacted chat: a small exchange, then the two kept pairs are huge.
    const big = "x".repeat(50_000);
    const list = [s("recap"), u("small"), a("small"), u("q2"), a(big), u("q3"), a(big)];
    expect(contextUsagePct(list, 30_000)).toBeGreaterThanOrEqual(80);
    // Folding would free only the small exchange: not worth a model call.
    expect(shouldAutoCompact(list, 30_000, 80)).toBe(false);
    // Once folding would free a real share (a big answer), it fires again.
    const later = [s("recap"), u("q1"), a(big), u("q2"), a(big), u("q3"), a(big)];
    expect(shouldAutoCompact(later, 30_000, 80)).toBe(true);
  });

  it("stays quiet below the threshold", () => {
    expect(shouldAutoCompact(pairs(3), 30_000, 80)).toBe(false);
  });
});
