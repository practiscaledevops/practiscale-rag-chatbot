import { describe, expect, it } from "vitest";
import {
  isStoredAnswer,
  previousTurnIndex,
  storedAnswerIndex,
  storedLeadsTo,
  turnAlreadySaved,
  type StoredTurnRow,
} from "@/lib/turn-capture";

// /api/chat's server-side save of a finished turn (captureAndSaveTurn) skips
// only when the stored thread already holds THIS turn. Before, it skipped
// whenever the thread ended on any assistant row with enough rows — so a
// regenerated/edited answer finishing off screen was never saved.

const u = (content: string) => ({ role: "user", content });
const a = (content: string) => ({ role: "assistant", content });
const sys = (content: string) => ({ role: "system", content });

describe("storedAnswerIndex", () => {
  it("is the row after the posted user/assistant turns", () => {
    expect(storedAnswerIndex(["user", "assistant"], ["user"])).toBe(1);
    expect(storedAnswerIndex(["user", "assistant", "user", "assistant"], ["user", "assistant", "user"])).toBe(3);
  });

  it("is -1 when the stored thread doesn't reach the answer yet", () => {
    expect(storedAnswerIndex(["user"], ["user"])).toBe(-1);
    expect(storedAnswerIndex([], ["user"])).toBe(-1);
  });

  it("skips compaction summaries (system rows) on either side", () => {
    // A summary stored since the turn was posted doesn't shift the answer.
    expect(storedAnswerIndex(["user", "assistant", "system", "user", "assistant"], ["user", "assistant", "user"])).toBe(4);
    // A summary the turn itself carried doesn't count as a turn.
    expect(storedAnswerIndex(["user", "assistant", "system", "user", "assistant"], ["user", "assistant", "system", "user"])).toBe(4);
  });
});

describe("previousTurnIndex", () => {
  it("finds the message the answer replies to, skipping summaries", () => {
    expect(previousTurnIndex(["user", "assistant"], 1)).toBe(0);
    expect(previousTurnIndex(["user", "system", "assistant"], 2)).toBe(0);
    expect(previousTurnIndex(["assistant"], 0)).toBe(-1);
  });
});

describe("isStoredAnswer", () => {
  it("matches an assistant row with the same text (ignoring outer whitespace)", () => {
    expect(isStoredAnswer(a("Answer [c1]"), "Answer [c1]\n")).toBe(true);
    expect(isStoredAnswer(a("Other"), "Answer")).toBe(false);
    expect(isStoredAnswer(u("Answer"), "Answer")).toBe(false);
    expect(isStoredAnswer(null, "Answer")).toBe(false);
  });

  it("never treats an empty answer (or an empty stored row) as stored", () => {
    expect(isStoredAnswer(a(""), "")).toBe(false);
    expect(isStoredAnswer(a("  "), "Answer")).toBe(false);
  });

  it("matches the start of the answer: what the client saved when the user pressed Stop", () => {
    expect(isStoredAnswer(a("The top closers mirror "), "The top closers mirror the customer's priority.")).toBe(true);
    expect(isStoredAnswer(a("Something else"), "The top closers mirror the customer's priority.")).toBe(false);
  });
});

describe("turnAlreadySaved", () => {
  const saved = (stored: StoredTurnRow[], prior: { role: string; content: string }[], answer: string) =>
    turnAlreadySaved(stored, prior, answer);

  it("skips when the client already saved this turn", () => {
    expect(saved([u("q1"), a("A1")], [u("q1")], "A1")).toBe(true);
  });

  it("skips when later turns were saved on top of it", () => {
    const prior = [u("q1"), a("A1"), u("q2")];
    expect(saved([u("q1"), a("A1"), u("q2"), a("A2"), u("q3"), a("A3")], prior, "A2")).toBe(true);
  });

  it("keeps a stopped answer stopped (the server's copy read on past the Stop)", () => {
    expect(saved([u("q1"), a("Partial ans")], [u("q1")], "Partial answer, completed.")).toBe(true);
    // …even once a follow-up was answered and saved on top of it.
    expect(saved([u("q1"), a("Partial ans"), u("q2"), a("A2")], [u("q1")], "Partial answer, completed.")).toBe(true);
  });

  it("skips when a compaction summary was stored after the answer", () => {
    const prior = [u("q1"), a("A1"), u("q2")];
    const stored = [u("q1"), a("A1"), sys("[Conversation summary]"), u("q2"), a("A2")];
    expect(saved(stored, prior, "A2")).toBe(true);
  });

  it("saves a turn nobody saved (navigated away; only the pre-created user turn is stored)", () => {
    expect(saved([u("q1")], [u("q1")], "A1")).toBe(false);
  });

  it("saves a second queued turn that finished in the background", () => {
    // The first answer is stored; this turn's user message and answer are not.
    expect(saved([u("q1"), a("A1")], [u("q1"), a("A1"), u("q2")], "A2")).toBe(false);
  });

  it("saves a queued turn whose answer repeats the previous one (demo answers can)", () => {
    expect(saved([u("q1"), a("Same")], [u("q1"), a("Same"), u("q2")], "Same")).toBe(false);
  });

  it("saves a regenerated answer over the old one", () => {
    expect(saved([u("q1"), a("old answer")], [u("q1")], "new answer")).toBe(false);
  });

  it("saves an edited message's new branch over the old thread", () => {
    const stored = [u("q1"), a("A1"), u("q2"), a("A2")];
    expect(saved(stored, [u("q1 edited")], "A1 edited")).toBe(false);
    // Even when the new answer happens to start with the old one.
    expect(saved(stored, [u("q1 edited")], "A1 and more")).toBe(false);
  });

  it("compares with the message that asked, even when it isn't a user turn", () => {
    expect(saved([u("q1"), a("note"), a("A")], [u("q1"), a("note")], "A")).toBe(true);
  });
});

describe("storedLeadsTo", () => {
  // Checked when the thread was saved since the request started: writing
  // prior + answer is only safe when that save didn't run past or away from
  // the history the request was built on.
  it("accepts the previous turn's own save landing after this request was sent", () => {
    expect(storedLeadsTo([u("q1"), a("A1")], [u("q1"), a("A1"), u("q2")])).toBe(true);
    expect(storedLeadsTo([u("q1")], [u("q1")])).toBe(true);
    expect(storedLeadsTo([], [u("q1")])).toBe(true);
  });

  it("ignores summaries on either side and outer whitespace", () => {
    expect(storedLeadsTo([u("q1"), sys("[Conversation summary]"), a("A1 ")], [u("q1"), a("A1"), u("q2")])).toBe(true);
    expect(storedLeadsTo([u("q1"), a("A1")], [u("q1"), a("A1"), sys("[Conversation summary]"), u("q2")])).toBe(true);
  });

  it("rejects a thread that ran past it (a Stop's partial answer, a regenerate, a newer turn)", () => {
    expect(storedLeadsTo([u("q1"), a("Partial")], [u("q1")])).toBe(false);
    expect(storedLeadsTo([u("q1"), a("A1 regenerated")], [u("q1")])).toBe(false);
    expect(storedLeadsTo([u("q1"), u("q2"), a("A2")], [u("q1")])).toBe(false);
  });

  it("rejects a thread that differs from it (an edit saved since)", () => {
    expect(storedLeadsTo([u("compare")], [u("hello")])).toBe(false);
    expect(storedLeadsTo([u("q1"), a("A1 other")], [u("q1"), a("A1"), u("q2")])).toBe(false);
  });
});
